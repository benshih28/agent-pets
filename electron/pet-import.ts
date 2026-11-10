// Custom pet (theme) import: parse an untrusted sprite-kit zip, stage it in a
// private directory, let the user preview it and resolve id conflicts, then
// install it with atomic directory renames.
//
// Layout under the trusted root (~/.desktop-pet):
//   custom/<id>/                    installed pets (read by loadPets / agent-pets://custom)
//   .pet-import-staging/stage-<hex> a validated, fsynced pet waiting for commit
//   .pet-import-staging/backup-<hex>-<id>  the previous pet while it is replaced
// Staging lives beside custom/ on the same filesystem so every install step is
// a single rename(2). A crash at any point leaves either the old pet, the new
// pet, or a backup that recoverStale() restores on the next start.

import { constants } from 'node:fs'
import type { BigIntStats, Dirent } from 'node:fs'
import { lstat, mkdir, open, opendir, readdir, rename, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { ensureDirectoryWithin } from './ipc/pet-assets-fs.ts'
import type { SanitizedPetBehaviorManifest } from './pet-behavior-manifest'
import { PET_ATLAS_WALK_ROW, PET_MOTION_NAMES, petMotionFitsAtlas } from '../src/types/pet-atlas.ts'
import {
  SPRITE_ERROR_MESSAGES,
  detectSpriteAtlas,
  validateSpriteSheet,
  type SpriteAtlasInfo,
  type SpriteValidationError,
} from './pet-sprite-validation.ts'
import { extractZipEntry, inspectZipArchive, type ZipInspectError } from './zip-inspect.ts'
import type {
  PetImportCommitResult,
  PetImportConflict,
  PetImportPreview,
  PetImportWarning,
} from '../src/types/pet-import.ts'
import { isRecord } from './value-guards.ts'

export const PET_IMPORT_STAGING_DIRNAME = '.pet-import-staging'
export const PET_IMPORT_TOKEN_PATTERN = /^[0-9a-f]{32}$/
const STAGE_PATTERN = /^stage-[0-9a-f]{32}$/
const BACKUP_PATTERN = /^backup-[0-9a-f]{32}-(.{1,64})$/
const MAX_RECOVERY_ENTRIES = 64
const MAX_RECOVERY_LISTED = 1024
const MAX_SUFFIX = 99
const REPLACED_MARKER = '.replaced'
const RESTORE_FAILED = 'E_RESTORE_FAILED'
const DEFAULT_TTL_MS = 10 * 60 * 1000
const SPRITE_FILE = 'spritesheet.webp'
const PET_JSON_FILE = 'pet.json'
const FORBIDDEN_JSON_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g
/** A sprite kit only needs pet.json and one image; a 100x ratio above 1 MiB is a bomb, not a PNG. */
export const PET_ZIP_MAX_COMPRESSION_RATIO = 100
export const PET_ZIP_RATIO_CHECK_MIN_BYTES = 1024 * 1024

export interface PetZipLimits {
  maxZipBytes: number
  maxEntries: number
  maxUncompressedBytes: number
  maxJsonBytes: number
  maxImageBytes: number
}

export interface ParsedPetKit {
  id: string
  displayName: string
  description: string
  kind: 'person' | 'animal'
  behaviorManifest?: SanitizedPetBehaviorManifest
  /** Behaviours filled from the atlas contract rather than declared by the kit. */
  autoBehaviors: Array<'walk'>
  atlas: SpriteAtlasInfo
  warnings: PetImportWarning[]
  sprite: Uint8Array
}

export type ParsePetZipResult =
  | { ok: true; pet: ParsedPetKit }
  | { ok: false; error: string; code?: SpriteValidationError | 'E_ZIP' | 'E_JSON' }

const ZIP_ERROR_MESSAGES: Record<ZipInspectError, string> = {
  invalid_archive: 'Invalid zip archive',
  unsupported_archive: 'Zip uses an unsupported format (multi-disk, ZIP64 or unknown compression)',
  encrypted_entry: 'Zip contains encrypted entries',
  symlink_entry: 'Zip contains a symbolic link',
  invalid_name: 'Zip contains a file name that is not valid UTF-8',
  unsafe_path: 'Zip contains an unsafe or duplicate path',
  duplicate_path: 'Zip contains an unsafe or duplicate path',
  file_limit_exceeded: 'Zip contains too many entries',
  total_size_exceeded: 'Zip expands beyond the 25 MB safety limit',
  compression_ratio_exceeded: 'Zip compression ratio is too high to be a sprite kit',
  overlapping_entries: 'Invalid zip archive',
  checksum_mismatch: 'Zip entry is corrupted (CRC mismatch)',
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.replace(CONTROL_CHARACTERS, '').trim().slice(0, maxLength) : ''
}

const utf8 = new TextDecoder('utf-8', { fatal: true })

/** JSON.parse with prototype-pollution keys dropped at every depth. */
export function parseUntrustedJson(bytes: Uint8Array): unknown {
  return JSON.parse(utf8.decode(bytes), (key, value) => (FORBIDDEN_JSON_KEYS.has(key) ? undefined : value))
}

function isIgnoredMetadata(path: string): boolean {
  const base = path.slice(path.lastIndexOf('/') + 1)
  return path.split('/').includes('__MACOSX') || base.startsWith('._')
}

const IMAGE_EXTENSION = /\.(webp|png|jpe?g)$/i
const PET_JSON_NAME = /(^|\/)pet\.json$/i

function directoryOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? '' : path.slice(0, slash + 1)
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export interface ParsePetZipOptions {
  limits: PetZipLimits
  sanitizePetId(value: string): string | null
  parsePetBehaviorManifest(value: unknown): SanitizedPetBehaviorManifest | undefined
  isSupportedRasterImage(data: Uint8Array): boolean
  now?: () => number
}

/**
 * Validates a sprite kit without touching the filesystem. Only pet.json and
 * the one selected image are inflated (by zip-inspect, from the same parse
 * that was validated); every other entry is counted but never decompressed.
 */
export function parsePetZip(zipBytes: Uint8Array, options: ParsePetZipOptions): ParsePetZipResult {
  const { limits } = options
  if (zipBytes.byteLength > limits.maxZipBytes) return { ok: false, error: 'Zip must be no larger than 10 MB' }
  const inspected = inspectZipArchive(zipBytes, {
    maxEntries: limits.maxEntries,
    maxTotalUncompressedBytes: limits.maxUncompressedBytes,
    maxCompressionRatio: PET_ZIP_MAX_COMPRESSION_RATIO,
    ratioCheckMinBytes: PET_ZIP_RATIO_CHECK_MIN_BYTES,
  })
  if (!inspected.ok) return { ok: false, code: 'E_ZIP', error: ZIP_ERROR_MESSAGES[inspected.error] }

  const files = inspected.entries.filter(entry => !entry.directory && !isIgnoredMetadata(entry.name))
  const petJsonEntries = files.filter(entry => PET_JSON_NAME.test(entry.name))
  if (petJsonEntries.length === 0) return { ok: false, error: 'No pet.json found in this zip' }
  if (petJsonEntries.length > 1) return { ok: false, error: 'Zip contains more than one pet.json' }
  const petJsonEntry = petJsonEntries[0]
  if (petJsonEntry.uncompressedSize > limits.maxJsonBytes) return { ok: false, error: 'pet.json exceeds the 256 KB safety limit' }

  // Same parser for inspection and extraction: only bytes the pre-scan
  // validated are ever inflated, with exact length and CRC-32 checks.
  const jsonResult = extractZipEntry(zipBytes, petJsonEntry)
  if (!jsonResult.ok) return { ok: false, code: 'E_ZIP', error: ZIP_ERROR_MESSAGES[jsonResult.error] }
  const petJsonBytes = jsonResult.data

  let petData: unknown
  try {
    petData = parseUntrustedJson(petJsonBytes)
  } catch {
    return { ok: false, code: 'E_JSON', error: 'pet.json is not valid UTF-8 JSON' }
  }
  if (!isRecord(petData)) return { ok: false, code: 'E_JSON', error: 'pet.json must contain a JSON object' }

  const now = options.now ?? Date.now
  const declaredName = cleanText(petData.displayName, 64)
  const rawId = cleanText(petData.id, 128) || declaredName || `imported-${now()}`
  const safeId = options.sanitizePetId(rawId) || options.sanitizePetId(`pet-${now()}`)
  if (!safeId) return { ok: false, error: 'Could not derive a valid pet id' }

  const images = files.filter(entry => IMAGE_EXTENSION.test(entry.name))
  const petDirectory = directoryOf(petJsonEntry.name)
  const wantedBase = typeof petData.spritesheetPath === 'string' ? baseName(petData.spritesheetPath).toLowerCase() : null
  const spriteEntry =
    (wantedBase ? images.find(entry => entry.name.toLowerCase() === `${petDirectory}${wantedBase}`.toLowerCase()) : undefined)
    ?? (wantedBase ? images.find(entry => baseName(entry.name).toLowerCase() === wantedBase) : undefined)
    ?? images.find(entry => directoryOf(entry.name) === petDirectory)
    ?? images[0]
  if (!spriteEntry) return { ok: false, error: 'No spritesheet image found in this zip' }
  if (spriteEntry.uncompressedSize > limits.maxImageBytes) return { ok: false, error: 'Spritesheet exceeds the 20 MB safety limit' }

  const spriteResult = extractZipEntry(zipBytes, spriteEntry)
  if (!spriteResult.ok) return { ok: false, code: 'E_ZIP', error: ZIP_ERROR_MESSAGES[spriteResult.error] }
  const sprite = spriteResult.data
  if (!options.isSupportedRasterImage(sprite)) {
    return { ok: false, error: 'Spritesheet content is not a valid PNG, JPEG, or WebP image' }
  }
  // Header-only check: dimensions and pixel count are capped before anything decodes the image.
  const sheetCheck = validateSpriteSheet(sprite)
  if (!sheetCheck.ok) return { ok: false, code: sheetCheck.code, error: SPRITE_ERROR_MESSAGES[sheetCheck.code] }

  const atlas = detectSpriteAtlas(sheetCheck.size, petData.spriteVersionNumber)
  const warnings: PetImportWarning[] = [...atlas.warnings]
  const declared = options.parsePetBehaviorManifest(petData.behaviorManifest)
  const behaviorManifest: SanitizedPetBehaviorManifest = {}
  for (const name of PET_MOTION_NAMES) {
    const definition = declared?.[name]
    if (!definition) continue
    if (!petMotionFitsAtlas(definition, atlas)) {
      if (!warnings.includes('behavior-row-out-of-range')) warnings.push('behavior-row-out-of-range')
      continue
    }
    behaviorManifest[name] = definition
  }
  const autoBehaviors: Array<'walk'> = []
  // v2 素材沒宣告 manifest 也會用 running-right 列走路；v1 維持原本行為（走路回退成閒置）。
  if (atlas.version === 2 && !behaviorManifest.walk) {
    behaviorManifest.walk = { row: PET_ATLAS_WALK_ROW }
    autoBehaviors.push('walk')
  }
  const ignored = files.length - 2
  if (ignored > 0) warnings.push('ignored-entries')

  return {
    ok: true,
    pet: {
      id: safeId,
      displayName: declaredName || cleanText(rawId, 64) || safeId,
      description: cleanText(petData.description, 500) || 'Imported pet',
      kind: petData.kind === 'animal' ? 'animal' : 'person',
      ...(Object.keys(behaviorManifest).length > 0 ? { behaviorManifest } : {}),
      autoBehaviors,
      atlas,
      warnings,
      sprite,
    },
  }
}

export function petJsonFor(pet: Pick<ParsedPetKit, 'description' | 'kind' | 'behaviorManifest' | 'atlas'>, id: string, displayName: string): string {
  return JSON.stringify({
    id,
    displayName,
    description: pet.description,
    spritesheetPath: SPRITE_FILE,
    spriteVersionNumber: pet.atlas.version,
    kind: pet.kind,
    ...(pet.behaviorManifest ? { behaviorManifest: pet.behaviorManifest } : {}),
  }, null, 2)
}

interface PendingImport {
  token: string
  directory: string
  pet: Omit<ParsedPetKit, 'sprite'>
  /** Fingerprint of custom/<id> (or "absent") when the preview was produced. */
  targetFingerprint: string
  conflict: PetImportConflict | null
  expectedState: string
  timer: ReturnType<typeof setTimeout>
}

export interface PetImportStagingOptions {
  /** Trusted root that holds custom/ (the hook deploy directory). */
  root: string
  sanitizePetId(value: string): string | null
  builtinPetIds(): Promise<Iterable<string>>
  ttlMs?: number
  previewUrl?(token: string): string
  /** Test seams for the directory renames that install, replace and roll back a pet. */
  renameDirectory?(from: string, to: string): Promise<void>
  restoreDirectory?(from: string, to: string): Promise<void>
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code
}

async function lstatOrNull(path: string): Promise<BigIntStats | null> {
  try {
    return await lstat(path, { bigint: true })
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null
    throw error
  }
}

async function fsyncDirectory(path: string): Promise<void> {
  // Durable rename on POSIX; Windows cannot open a directory for sync, which is fine there.
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(path, constants.O_RDONLY)
    await handle.sync()
  } catch {} finally {
    try { await handle?.close() } catch {}
  }
}

const NO_FOLLOW = (constants as typeof constants & { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0

async function writeNewFileDurably(path: string, contents: string | Uint8Array): Promise<void> {
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NO_FOLLOW, 0o600)
  try {
    // Uint8Array is written as-is: no extra Buffer copy of a large sprite.
    await handle.writeFile(contents)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

function fingerprintOf(stats: BigIntStats | null, children: Array<BigIntStats | null>): string {
  if (!stats) return 'absent'
  if (!stats.isDirectory() || stats.isSymbolicLink()) return `other:${stats.mode}`
  const parts = [`dir:${stats.dev}:${stats.ino}:${stats.mtimeNs}`]
  for (const child of children) parts.push(child ? `${child.ino}:${child.size}:${child.mtimeNs}` : '-')
  return parts.join('|')
}

export class PetImportStaging {
  private readonly root: string
  private readonly customRoot: string
  private readonly stagingRoot: string
  private readonly pending = new Map<string, PendingImport>()
  private readonly ttlMs: number
  private queue: Promise<unknown> = Promise.resolve()

  private readonly options: PetImportStagingOptions

  constructor(options: PetImportStagingOptions) {
    this.options = options
    this.root = resolve(options.root)
    this.customRoot = join(this.root, 'custom')
    this.stagingRoot = join(this.root, PET_IMPORT_STAGING_DIRNAME)
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  }

  /** Serializes stage/commit/cancel/recovery so two imports never interleave renames. */
  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.catch(() => undefined)
    return run
  }

  private previewUrl(token: string): string {
    return this.options.previewUrl?.(token) ?? `agent-pets://import-preview/${token}/spritesheet`
  }

  /** Staging directory for a live preview token, used only by the agent-pets:// protocol. */
  previewDirectory(token: string): string | null {
    if (typeof token !== 'string' || !PET_IMPORT_TOKEN_PATTERN.test(token)) return null
    return this.pending.get(token)?.directory ?? null
  }

  private async targetFingerprint(folder: string): Promise<string> {
    const directory = join(this.customRoot, folder)
    const stats = await lstatOrNull(directory)
    if (!stats || !stats.isDirectory() || stats.isSymbolicLink()) return fingerprintOf(stats, [])
    return fingerprintOf(stats, [
      await lstatOrNull(join(directory, PET_JSON_FILE)),
      await lstatOrNull(join(directory, SPRITE_FILE)),
    ])
  }

  private async takenIds(): Promise<{ folders: Map<string, string>; builtIn: Set<string> }> {
    // Case-insensitive on purpose: macOS and Windows file systems are.
    const folders = new Map<string, string>()
    try {
      for (const entry of await readdir(this.customRoot, { withFileTypes: true })) {
        folders.set(entry.name.toLowerCase(), entry.name)
      }
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error
    }
    const builtIn = new Set<string>()
    for (const id of await this.options.builtinPetIds()) builtIn.add(String(id).toLowerCase())
    return { folders, builtIn }
  }

  private async describe(pending: Omit<PendingImport, 'targetFingerprint' | 'conflict' | 'expectedState'>): Promise<Pick<PendingImport, 'targetFingerprint' | 'conflict' | 'expectedState'>> {
    const { folders, builtIn } = await this.takenIds()
    const key = pending.pet.id.toLowerCase()
    const existingFolder = folders.get(key)
    const isBuiltIn = builtIn.has(key)
    let conflict: PetImportConflict | null = null
    if (existingFolder || isBuiltIn) {
      let suggestedId = ''
      let suffix = 0
      for (let n = 2; n <= MAX_SUFFIX && !suggestedId; n += 1) {
        const tail = `-${n}`
        const candidate = this.options.sanitizePetId(`${pending.pet.id.slice(0, 64 - tail.length)}${tail}`)
        if (candidate && !folders.has(candidate.toLowerCase()) && !builtIn.has(candidate.toLowerCase())) {
          suggestedId = candidate
          suffix = n
        }
      }
      if (!suggestedId) throw new Error('Could not find a free pet id')
      conflict = {
        id: existingFolder ?? pending.pet.id,
        builtIn: isBuiltIn,
        suggestedId,
        suggestedDisplayName: `${pending.pet.displayName.slice(0, 58)} (${suffix})`,
      }
    }
    const targetFingerprint = existingFolder ? await this.targetFingerprint(existingFolder) : 'absent'
    const expectedState = createHash('sha256')
      .update(`${pending.token}\0${pending.pet.id}\0${targetFingerprint}\0${conflict?.suggestedId ?? ''}\0${conflict?.builtIn ?? ''}`)
      .digest('hex')
      .slice(0, 32)
    return { targetFingerprint, conflict, expectedState }
  }

  private preview(pending: PendingImport): PetImportPreview {
    const { warnings: _atlasWarnings, ...atlas } = pending.pet.atlas
    return {
      token: pending.token,
      expectedState: pending.expectedState,
      id: pending.pet.id,
      displayName: pending.pet.displayName,
      kind: pending.pet.kind,
      atlas,
      warnings: [...pending.pet.warnings],
      autoBehaviors: [...pending.pet.autoBehaviors],
      conflict: pending.conflict ? { ...pending.conflict } : null,
      previewUrl: this.previewUrl(pending.token),
    }
  }

  /** Writes a validated kit into a fresh private staging directory and returns its preview. */
  stage(parsed: ParsedPetKit): Promise<PetImportPreview> {
    return this.exclusive(async () => {
      // One import at a time: a new pick discards any preview the user walked away from.
      for (const token of [...this.pending.keys()]) await this.discard(token)
      await ensureDirectoryWithin(this.root, this.stagingRoot)
      const token = randomBytes(16).toString('hex')
      const directory = join(this.stagingRoot, `stage-${token}`)
      await mkdir(directory, { mode: 0o700 })
      try {
        const { sprite, ...pet } = parsed
        await writeNewFileDurably(join(directory, SPRITE_FILE), sprite)
        await writeNewFileDurably(join(directory, PET_JSON_FILE), petJsonFor(pet, pet.id, pet.displayName))
        await fsyncDirectory(directory)
        const base = { token, directory, pet, timer: setTimeout(() => { void this.cancel(token) }, this.ttlMs) }
        base.timer.unref?.()
        const pending: PendingImport = { ...base, ...(await this.describe(base)) }
        this.pending.set(token, pending)
        return this.preview(pending)
      } catch (error) {
        await rm(directory, { recursive: true, force: true }).catch(() => undefined)
        throw error
      }
    })
  }

  cancel(token: unknown): Promise<boolean> {
    return this.exclusive(() => this.discard(token))
  }

  private async discard(token: unknown): Promise<boolean> {
    if (typeof token !== 'string') return false
    const pending = this.pending.get(token)
    if (!pending) return false
    this.pending.delete(token)
    clearTimeout(pending.timer)
    await rm(pending.directory, { recursive: true, force: true }).catch(() => undefined)
    return true
  }

  /**
   * Installs a staged kit. The renderer passes back the expectedState it was
   * shown; the main process re-reads the destination and refuses (with a
   * refreshed preview) if anything changed since, so a stale dialog can never
   * overwrite a pet the user did not see.
   */
  commit(token: unknown, decision: unknown, expectedState: unknown): Promise<PetImportCommitResult> {
    return this.exclusive(async () => {
      const pending = typeof token === 'string' ? this.pending.get(token) : undefined
      if (!pending) return { ok: false, code: 'E_IMPORT_EXPIRED', error: 'This import preview has expired. Choose the zip again.' }
      if (decision !== 'install' && decision !== 'replace' && decision !== 'keep-both') {
        return { ok: false, code: 'E_IMPORT_DECISION', error: 'Unknown import decision' }
      }
      if (typeof expectedState !== 'string' || expectedState !== pending.expectedState) {
        return { ok: false, code: 'E_IMPORT_STATE_CHANGED', error: 'The pet list changed. Review the import again.', preview: this.preview(pending) }
      }
      const valid = pending.conflict
        ? decision === 'keep-both' || (decision === 'replace' && !pending.conflict.builtIn)
        : decision === 'install'
      if (!valid) return { ok: false, code: 'E_IMPORT_DECISION', error: 'Unknown import decision' }

      const fresh = await this.describe(pending)
      if (fresh.expectedState !== pending.expectedState) {
        Object.assign(pending, fresh)
        return { ok: false, code: 'E_IMPORT_STATE_CHANGED', error: 'The pet list changed. Review the import again.', preview: this.preview(pending) }
      }

      try {
        await ensureDirectoryWithin(this.root, this.customRoot)
        const keepBoth = decision === 'keep-both' && pending.conflict
        const id = keepBoth ? pending.conflict!.suggestedId : pending.pet.id
        const displayName = keepBoth ? pending.conflict!.suggestedDisplayName : pending.pet.displayName
        // pet.json is rewritten for every decision so an earlier keep-both
        // attempt that hit a changed state can never leak its suffixed id.
        const temporary = join(pending.directory, `${PET_JSON_FILE}.tmp`)
        await rm(temporary, { force: true })
        await writeNewFileDurably(temporary, petJsonFor(pending.pet, id, displayName))
        await rename(temporary, join(pending.directory, PET_JSON_FILE))
        await fsyncDirectory(pending.directory)
        const target = join(this.customRoot, id)
        if (decision === 'replace' && pending.conflict) {
          await this.replaceDirectory(pending.conflict.id, target, pending)
        } else {
          if (await lstatOrNull(target)) throw Object.assign(new Error('Destination appeared'), { code: 'EEXIST' })
          await rename(pending.directory, target)
          await fsyncDirectory(this.customRoot)
        }
        this.pending.delete(pending.token)
        clearTimeout(pending.timer)
        await fsyncDirectory(this.stagingRoot)
        return { ok: true, id, displayName }
      } catch (error) {
        if (errorCode(error) === RESTORE_FAILED) {
          await this.discard(pending.token)
          return { ok: false, code: 'E_IMPORT_FAILED', error: 'Could not install the imported pet' }
        }
        // A destination that appeared or changed underneath us is a state
        // change the user must review; anything else is a real failure.
        const refreshed = await this.describe(pending).catch(() => null)
        if (refreshed && refreshed.expectedState !== pending.expectedState && this.pending.has(pending.token)) {
          Object.assign(pending, refreshed)
          return { ok: false, code: 'E_IMPORT_STATE_CHANGED', error: 'The pet list changed. Review the import again.', preview: this.preview(pending) }
        }
        await this.discard(pending.token)
        return { ok: false, code: 'E_IMPORT_FAILED', error: 'Could not install the imported pet' }
      }
    })
  }

  private async replaceDirectory(existingFolder: string, target: string, pending: PendingImport): Promise<void> {
    const existing = join(this.customRoot, existingFolder)
    const stats = await lstatOrNull(existing)
    if (!stats || !stats.isDirectory() || stats.isSymbolicLink()) throw Object.assign(new Error('Existing pet is not a directory'), { code: 'ENOTDIR' })
    // The backup name records the original folder so recoverStale() can put it back after a crash.
    const backup = join(this.stagingRoot, `backup-${randomBytes(16).toString('hex')}-${existingFolder}`)
    const renameDirectory = this.options.renameDirectory ?? rename
    await renameDirectory(existing, backup)
    try {
      await renameDirectory(pending.directory, target)
    } catch (error) {
      // Put the previous pet back exactly where it was before reporting failure.
      try {
        await (this.options.restoreDirectory ?? rename)(backup, existing)
      } catch {
        // The old pet now exists only as the backup. Never re-preview (the
        // destination looks free) and leave the backup for recoverStale().
        throw Object.assign(new Error('Could not restore the previous pet'), { code: RESTORE_FAILED })
      }
      throw error
    }
    await fsyncDirectory(this.customRoot)
    // Only a backup carrying this marker belongs to a verified install and may be deleted.
    await writeNewFileDurably(join(backup, REPLACED_MARKER), '').catch(() => undefined)
    await fsyncDirectory(this.stagingRoot)
    await rm(backup, { recursive: true, force: true }).catch(() => undefined)
  }

  /**
   * Startup cleanup after a crash: removes our own stage-* directories,
   * deletes backup-* directories marked as replaced, and restores (when the
   * pet folder is free) or keeps every other backup. Bounded, prefix-matched,
   * and never follows a symlink.
   */
  recoverStale(): Promise<{ removed: number; restored: number; kept: number }> {
    return this.exclusive(async () => {
      const result = { removed: 0, restored: 0, kept: 0 }
      const rootStats = await lstatOrNull(this.stagingRoot)
      if (!rootStats || !rootStats.isDirectory() || rootStats.isSymbolicLink()) return result
      let examined = 0
      let listed = 0
      const directory = await opendir(this.stagingRoot)
      const entries: Dirent[] = []
      try {
        // Lazy iteration: a directory flooded with foreign entries costs at most MAX_RECOVERY_LISTED reads.
        for await (const entry of directory) {
          entries.push(entry)
          listed += 1
          if (listed >= MAX_RECOVERY_LISTED) break
        }
      } catch {}
      for (const entry of entries) {
        if (examined >= MAX_RECOVERY_ENTRIES) break
        const isStage = STAGE_PATTERN.test(entry.name)
        const backupMatch = BACKUP_PATTERN.exec(entry.name)
        if (!isStage && !backupMatch) continue
        examined += 1
        const path = join(this.stagingRoot, entry.name)
        const stats = await lstatOrNull(path)
        if (!stats || !stats.isDirectory() || stats.isSymbolicLink()) continue
        if ([...this.pending.values()].some(pending => pending.directory === path)) continue
        if (backupMatch && !(await lstatOrNull(join(path, REPLACED_MARKER)))) {
          // An unverified backup is the only copy of a pet: restore it when
          // its folder is free, otherwise keep it rather than delete it.
          const id = this.options.sanitizePetId(backupMatch[1])
          const target = id === backupMatch[1] ? join(this.customRoot, id) : null
          if (target && !(await lstatOrNull(target))) {
            try {
              await ensureDirectoryWithin(this.root, this.customRoot)
              await rename(path, target)
              result.restored += 1
              continue
            } catch {}
          }
          result.kept += 1
          continue
        }
        await rm(path, { recursive: true, force: true }).then(() => { result.removed += 1 }, () => undefined)
      }
      return result
    })
  }

  /** Drops every pending preview (app quit). */
  async dispose(): Promise<void> {
    await this.exclusive(async () => {
      for (const token of [...this.pending.keys()]) await this.discard(token)
    })
  }
}
