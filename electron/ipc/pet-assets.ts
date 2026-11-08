import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import type { SanitizedPetBehaviorManifest } from '../pet-behavior-manifest'
import { t as translate } from '../../src/i18n.ts'
import { PET_IMPORT_TOKEN_PATTERN, parsePetZip, type PetImportStaging } from '../pet-import.ts'
import { SPRITE_ATLAS_WALK_ROW, detectSpriteAtlas, validateSpriteSheet } from '../pet-sprite-validation.ts'
import { IPC_CHANNELS } from './channels.ts'

type OpenDialogResult = { canceled: boolean; filePaths: string[] }
type OpenDialogOptions = {
  title: string
  message?: string
  filters?: Array<{ name: string; extensions: string[] }>
  properties: Array<'openFile'>
}
type FileSystemPort = Pick<typeof import('node:fs/promises'), 'lstat' | 'readFile' | 'writeFile' | 'rm'>
type PathPort = Pick<typeof import('node:path'), 'basename' | 'join'>

export interface PetAssetIpcDependencies {
  ipcMain: Pick<IpcMain, 'handle'>
  assertTrustedIpcSender(event: IpcMainInvokeEvent, requiredWindow?: BrowserWindow | null): void
  getPanelWindow(): BrowserWindow | null
  getPetWindow(): BrowserWindow | null
  setDialogOpen(value: boolean): void
  showOpenDialog(window: BrowserWindow, options: OpenDialogOptions): Promise<OpenDialogResult>
  customPetsRoot(): string
  safeJoin(base: string, ...parts: string[]): string | null
  sanitizePetId(value: string): string | null
  ensureDir(path: string): void | Promise<void>
  writeFileEnsured(path: string, contents: string | Uint8Array): void | Promise<void>
  parsePetBehaviorManifest(value: unknown): SanitizedPetBehaviorManifest | undefined
  isSupportedRasterImage(data: Uint8Array): boolean
  petImport: Pick<PetImportStaging, 'stage' | 'commit' | 'cancel'>
  fs: FileSystemPort
  path: PathPort
  customPetDescription(): string
  maxPetZipBytes: number
  maxPetZipEntries: number
  maxPetUncompressedBytes: number
  maxPetJsonBytes: number
  maxPetImageBytes: number
}

export function registerPetAssetIpc(deps: PetAssetIpcDependencies): void {
  deps.ipcMain.handle(IPC_CHANNELS.addCustomPet, async (event, petData: unknown) => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    if (!petData || typeof petData !== 'object') return false
    const data = petData as Record<string, unknown>
    const safeId = deps.sanitizePetId(typeof data.id === 'string' ? data.id : '')
    if (!safeId) return false
    const customDir = deps.safeJoin(deps.customPetsRoot(), 'custom', safeId)
    if (!customDir) return false

    await deps.ensureDir(customDir)
    const petJson = {
      id: safeId,
      displayName: String(data.displayName || safeId).slice(0, 64),
      description: deps.customPetDescription(),
      spritesheetPath: 'spritesheet.webp',
      spriteVersionNumber: 2,
      kind: 'person',
    }
    await deps.writeFileEnsured(deps.path.join(customDir, 'pet.json'), JSON.stringify(petJson, null, 2))
    return true
  })

  deps.ipcMain.handle(IPC_CHANNELS.renameCustomPet, async (event, petId: string, newName: string) => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    const safeId = deps.sanitizePetId(petId)
    if (!safeId) return false
    if (typeof newName !== 'string' || newName.trim().length === 0) return false
    const customDir = deps.safeJoin(deps.customPetsRoot(), 'custom', safeId)
    if (!customDir) return false
    const petJsonPath = deps.safeJoin(customDir, 'pet.json')
    if (!petJsonPath) return false
    try {
      const stat = await deps.fs.lstat(petJsonPath)
      if (!stat.isFile() || stat.isSymbolicLink()) return false
      const petData = JSON.parse(await deps.fs.readFile(petJsonPath, 'utf-8'))
      petData.displayName = newName.trim().slice(0, 64)
      await deps.writeFileEnsured(petJsonPath, JSON.stringify(petData, null, 2))
      return true
    } catch {
      return false
    }
  })

  deps.ipcMain.handle(IPC_CHANNELS.removeCustomPet, async (event, petId: string) => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    const safeId = deps.sanitizePetId(petId)
    if (!safeId) return false
    const customDir = deps.safeJoin(deps.customPetsRoot(), 'custom', safeId)
    if (!customDir) return false
    try {
      const stat = await deps.fs.lstat(customDir)
      if (!stat.isDirectory() || stat.isSymbolicLink()) return false
      await deps.fs.rm(customDir, { recursive: true, force: true })
      return true
    } catch { return false }
  })

  deps.ipcMain.handle(IPC_CHANNELS.getCustomPetSprite, async (event, petId: string) => {
    deps.assertTrustedIpcSender(event)
    const safeId = deps.sanitizePetId(petId)
    if (!safeId) return null
    const spritePath = deps.safeJoin(deps.customPetsRoot(), 'custom', safeId, 'spritesheet.webp')
    if (!spritePath) return null
    try {
      const stat = await deps.fs.lstat(spritePath)
      if (stat.isFile() && !stat.isSymbolicLink()) {
        // The modification time versions the URL so a re-import of the same id
        // never serves the previously cached sheet.
        const version = Number.isFinite(stat.mtimeMs) ? `?v=${Math.floor(stat.mtimeMs)}` : ''
        return `agent-pets://custom/${encodeURIComponent(safeId)}/spritesheet.webp${version}`
      }
    } catch {}
    return null
  })

  // Accepts sprite kits from community sites like codex-pets.net: a .zip
  // containing pet.json + a spritesheet image, laid out on the same
  // 192x208-per-frame grid our own built-in pets use (see PetAnimation.vue).
  // Import is two-step: prepare validates and stages the kit and returns a
  // preview (plus any id conflict); commit installs it atomically once the
  // user has seen the preview and chosen how to resolve a conflict.
  deps.ipcMain.handle(IPC_CHANNELS.prepareImportPetZip, async (event) => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    const owner = deps.getPanelWindow() ?? deps.getPetWindow()
    if (!owner) return { ok: false, error: 'No window available' }

    deps.setDialogOpen(true)
    let result: OpenDialogResult
    try {
      result = await deps.showOpenDialog(owner, {
        title: translate('pet.importZipTitle'),
        filters: [{ name: 'Pet sprite kit', extensions: ['zip'] }],
        properties: ['openFile'],
      })
    } finally {
      deps.setDialogOpen(false)
    }
    if (result.canceled || result.filePaths.length === 0) return { ok: false, error: 'cancelled' }

    try {
      const zipPath = result.filePaths[0]
      const zipStat = await deps.fs.lstat(zipPath)
      if (!zipStat.isFile() || zipStat.isSymbolicLink() || zipStat.size > deps.maxPetZipBytes) {
        return { ok: false, error: 'Zip must be a regular file no larger than 10 MB' }
      }
      const zipBuf = await deps.fs.readFile(zipPath)
      const parsed = parsePetZip(new Uint8Array(zipBuf.buffer, zipBuf.byteOffset, zipBuf.byteLength), {
        limits: {
          maxZipBytes: deps.maxPetZipBytes,
          maxEntries: deps.maxPetZipEntries,
          maxUncompressedBytes: deps.maxPetUncompressedBytes,
          maxJsonBytes: deps.maxPetJsonBytes,
          maxImageBytes: deps.maxPetImageBytes,
        },
        sanitizePetId: deps.sanitizePetId,
        parsePetBehaviorManifest: deps.parsePetBehaviorManifest,
        isSupportedRasterImage: deps.isSupportedRasterImage,
      })
      if (!parsed.ok) return parsed
      return { ok: true, preview: await deps.petImport.stage(parsed.pet) }
    } catch {
      return { ok: false, error: 'Could not read this zip' }
    }
  })

  deps.ipcMain.handle(IPC_CHANNELS.commitImportPetZip, async (event, token: unknown, decision: unknown, expectedState: unknown) => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    if (typeof token !== 'string' || !PET_IMPORT_TOKEN_PATTERN.test(token)) {
      return { ok: false, code: 'E_IMPORT_EXPIRED', error: 'This import preview has expired. Choose the zip again.' }
    }
    return deps.petImport.commit(token, decision, typeof expectedState === 'string' ? expectedState.slice(0, 64) : null)
  })

  deps.ipcMain.handle(IPC_CHANNELS.cancelImportPetZip, async (event, token: unknown) => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    if (typeof token !== 'string' || !PET_IMPORT_TOKEN_PATTERN.test(token)) return false
    return deps.petImport.cancel(token)
  })

  deps.ipcMain.handle(IPC_CHANNELS.importPetSprite, async (event, petId: string, displayName: string) => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    const safeId = deps.sanitizePetId(petId)
    const owner = deps.getPanelWindow() ?? deps.getPetWindow()
    if (!safeId || !owner) return null
    deps.setDialogOpen(true)
    const result = await deps.showOpenDialog(owner, {
      title: translate('pet.importSpriteTitle'),
      filters: [{ name: 'Images', extensions: ['webp', 'png', 'jpg'] }],
      properties: ['openFile'],
    })
    deps.setDialogOpen(false)
    if (result.canceled || result.filePaths.length === 0) return null
    const src = result.filePaths[0]
    const sourceStat = await deps.fs.lstat(src)
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || sourceStat.size > deps.maxPetImageBytes) return null
    const sourceData = await deps.fs.readFile(src)
    if (sourceData.length > deps.maxPetImageBytes || !deps.isSupportedRasterImage(sourceData)) return null
    const sheetCheck = validateSpriteSheet(sourceData)
    if (!sheetCheck.ok) return null
    const atlas = detectSpriteAtlas(sheetCheck.size)
    const customDir = deps.safeJoin(deps.customPetsRoot(), 'custom', safeId)
    if (!customDir) return null
    await deps.ensureDir(customDir)
    const dest = deps.path.join(customDir, 'spritesheet.webp')
    await deps.writeFileEnsured(dest, sourceData)
    const petJson = {
      id: safeId,
      displayName: String(displayName || safeId).slice(0, 64),
      description: deps.customPetDescription(),
      spritesheetPath: 'spritesheet.webp',
      spriteVersionNumber: atlas.version,
      kind: 'person',
      // Same atlas contract as zip import: v2 sheets walk on the running-right row.
      ...(atlas.version === 2 ? { behaviorManifest: { walk: { row: SPRITE_ATLAS_WALK_ROW } } } : {}),
    }
    await deps.writeFileEnsured(deps.path.join(customDir, 'pet.json'), JSON.stringify(petJson, null, 2))
    return `agent-pets://custom/${encodeURIComponent(safeId)}/spritesheet.webp`
  })

}
