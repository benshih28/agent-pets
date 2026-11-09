import * as fs from 'node:fs'
import * as path from 'node:path'
import { renameSyncWithRetry } from './fs-rename.ts'
import { writeJsonAtomic } from './desktop-preferences.ts'
import {
  PANEL_THEME_FITS,
  PANEL_THEME_MODES,
  PANEL_THEME_POSITIONS,
  PANEL_THEME_USER_BLURS,
  type PanelThemeMode,
  type PanelThemeRef,
  type PanelThemeStoreData,
  type PanelThemeStoredUserImage,
  type PanelThemeUserImageOptions,
} from '../src/types/panel-theme.ts'
import { isPanelThemeOwnerId } from '../src/types/panel-theme-user.ts'
import { isRecord } from './value-guards.ts'

// `userData/panel-theme.json`（spec §7.1）：記錄每個模式使用哪個插件主題，
// 以及使用者匯入的背景圖片項目。仿照 PluginPreferencesStore：
// 拒絕 lstat/symlink、O_NOFOLLOW 讀取、大小上限、
// 損毀檔案備份與原子寫入。

export const PANEL_THEME_STORE_FILENAME = 'panel-theme.json'
export const PANEL_THEME_STORE_MAX_BYTES = 64 * 1024
export const PANEL_THEME_MAX_USER_IMAGES = 64

const THEME_ID = /^[a-z0-9-]{1,32}$/
export const PANEL_THEME_USER_IMAGE_FILE = /^[0-9a-f]{64}\.(?:png|jpg|webp)$/
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/** store 檔案是 symlink 或其他不安全狀態時拋出；對應 `preferences_unsafe`。 */
export class PanelThemeStoreFileError extends Error {
  readonly code = 'unsafe_file'

  constructor() {
    super('Panel theme store file is unsafe')
    this.name = 'PanelThemeStoreFileError'
  }
}

export function emptyPanelThemeStoreData(): PanelThemeStoreData {
  return { version: 1, slots: { light: null, dark: null }, userImages: {} }
}

function isErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code)
}

export function isPanelThemeRef(value: unknown): value is PanelThemeRef {
  return isRecord(value) && Object.keys(value).length === 2
    && isPanelThemeOwnerId(value.pluginId)
    && typeof value.themeId === 'string' && THEME_ID.test(value.themeId)
}

/** Dim：最多 2 位小數、落在 [minimum, 0.95] 的數字。 */
export function isPanelThemeDim(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= 0.95
    && /^0\.\d{1,2}$/.test(String(value))
}

export function isPanelThemeUserImageOptions(value: unknown, minimumDim: number): value is PanelThemeUserImageOptions {
  if (!isRecord(value) || Object.keys(value).some(key => !['fit', 'position', 'dim', 'blur'].includes(key))) return false
  return (PANEL_THEME_FITS as readonly unknown[]).includes(value.fit)
    && (PANEL_THEME_POSITIONS as readonly unknown[]).includes(value.position)
    && isPanelThemeDim(value.dim, minimumDim)
    && (PANEL_THEME_USER_BLURS as readonly unknown[]).includes(value.blur)
}

function parseStoredImage(value: unknown): PanelThemeStoredUserImage | null {
  if (!isRecord(value)) return null
  const { file, type, width, height, bytes, importedAt } = value
  if (typeof file !== 'string' || !PANEL_THEME_USER_IMAGE_FILE.test(file)
    || typeof type !== 'string' || !IMAGE_TYPES.has(type)
    || typeof width !== 'number' || !Number.isSafeInteger(width) || width < 1 || width > 8192
    || typeof height !== 'number' || !Number.isSafeInteger(height) || height < 1 || height > 8192
    || typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > 20 * 1024 * 1024
    || typeof importedAt !== 'string' || !ISO_8601.test(importedAt)
    || !isPanelThemeUserImageOptions({ fit: value.fit, position: value.position, dim: value.dim, blur: value.blur }, 0.5)) return null
  return {
    file,
    type: type as PanelThemeStoredUserImage['type'],
    width,
    height,
    bytes,
    importedAt,
    fit: value.fit as PanelThemeStoredUserImage['fit'],
    position: value.position as PanelThemeStoredUserImage['position'],
    dim: value.dim as number,
    blur: value.blur as PanelThemeStoredUserImage['blur'],
  }
}

/** 解析儲存的資料；無效項目會被丟棄，根節點無效時回傳 null（並備份）。 */
export function parsePanelThemeStoreData(value: unknown): PanelThemeStoreData | null {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.slots) || !isRecord(value.userImages)) return null
  const data = emptyPanelThemeStoreData()
  for (const mode of PANEL_THEME_MODES) {
    const slot = value.slots[mode]
    data.slots[mode] = isPanelThemeRef(slot) ? { pluginId: slot.pluginId, themeId: slot.themeId } : null
  }
  let count = 0
  for (const [pluginId, themes] of Object.entries(value.userImages)) {
    if (!isPanelThemeOwnerId(pluginId) || !isRecord(themes)) continue
    for (const [themeId, modes] of Object.entries(themes)) {
      if (!THEME_ID.test(themeId) || !isRecord(modes)) continue
      for (const mode of PANEL_THEME_MODES) {
        const image = parseStoredImage(modes[mode])
        if (!image || count >= PANEL_THEME_MAX_USER_IMAGES) continue
        data.userImages[pluginId] ??= {}
        data.userImages[pluginId]![themeId] ??= {}
        data.userImages[pluginId]![themeId]![mode] = image
        count += 1
      }
    }
  }
  return data
}

function cloneData(data: PanelThemeStoreData): PanelThemeStoreData {
  return structuredClone(data)
}

interface StoredRead { value: unknown; backupRequired: boolean; unsafe: boolean }

function readStored(filePath: string): StoredRead {
  let linkStat: fs.Stats
  try {
    linkStat = fs.lstatSync(filePath)
  } catch (error) {
    return { value: undefined, backupRequired: false, unsafe: !isErrorCode(error, 'ENOENT') }
  }
  if (linkStat.isSymbolicLink() || !linkStat.isFile()) return { value: undefined, backupRequired: false, unsafe: true }
  if (linkStat.size > PANEL_THEME_STORE_MAX_BYTES) return { value: undefined, backupRequired: true, unsafe: false }
  let descriptor: number | null = null
  try {
    const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow)
    const stat = fs.fstatSync(descriptor)
    if (!stat.isFile() || stat.dev !== linkStat.dev || stat.ino !== linkStat.ino) {
      return { value: undefined, backupRequired: false, unsafe: true }
    }
    if (stat.size > PANEL_THEME_STORE_MAX_BYTES) return { value: undefined, backupRequired: true, unsafe: false }
    const contents = fs.readFileSync(descriptor, 'utf8')
    try {
      return { value: JSON.parse(contents) as unknown, backupRequired: false, unsafe: false }
    } catch {
      return { value: undefined, backupRequired: true, unsafe: false }
    }
  } catch (error) {
    return { value: undefined, backupRequired: false, unsafe: !isErrorCode(error, 'ENOENT') }
  } finally {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor) } catch {}
    }
  }
}

function countImages(data: PanelThemeStoreData): number {
  let count = 0
  for (const themes of Object.values(data.userImages)) {
    for (const modes of Object.values(themes)) count += Object.keys(modes).length
  }
  return count
}

export interface PanelThemeStoreValidity {
  /** 主題與模式存在於已安裝（不一定已啟用）的插件中。 */
  modeExists(pluginId: string, themeId: string, mode: PanelThemeMode): boolean
  /** 該主題模式仍宣告 `userImage`。 */
  allowsUserImage(pluginId: string, themeId: string, mode: PanelThemeMode): boolean
  /** 插件仍已安裝。 */
  isInstalled(pluginId: string): boolean
}

export class PanelThemeStore {
  private readonly filePath: string
  private stored: PanelThemeStoreData | null = null
  private corruptBackupRequired = false
  private unsafeFile = false

  constructor(userDataDirectory: string) {
    if (!path.isAbsolute(userDataDirectory)) throw new TypeError('Panel theme store requires an absolute userData directory')
    this.filePath = path.join(userDataDirectory, PANEL_THEME_STORE_FILENAME)
  }

  /** 損毀或不安全的檔案一律視為全部內建。 */
  get(): PanelThemeStoreData {
    return cloneData(this.load())
  }

  isUnsafe(): boolean {
    this.load()
    return this.unsafeFile
  }

  setSlot(mode: PanelThemeMode, ref: PanelThemeRef | null): PanelThemeStoreData {
    const next = cloneData(this.load())
    next.slots[mode] = ref ? { pluginId: ref.pluginId, themeId: ref.themeId } : null
    this.persist(next)
    return cloneData(next)
  }

  getUserImage(ref: PanelThemeRef, mode: PanelThemeMode): PanelThemeStoredUserImage | null {
    const image = this.load().userImages[ref.pluginId]?.[ref.themeId]?.[mode]
    return image ? { ...image } : null
  }

  /** 儲存（或取代）一筆使用者圖片項目。回傳被取代的檔名（若有）。 */
  setUserImage(ref: PanelThemeRef, mode: PanelThemeMode, image: PanelThemeStoredUserImage): string | null {
    const next = cloneData(this.load())
    const previous = next.userImages[ref.pluginId]?.[ref.themeId]?.[mode]
    if (!previous && countImages(next) >= PANEL_THEME_MAX_USER_IMAGES) throw new RangeError('too many stored panel theme images')
    next.userImages[ref.pluginId] ??= {}
    next.userImages[ref.pluginId]![ref.themeId] ??= {}
    next.userImages[ref.pluginId]![ref.themeId]![mode] = { ...image }
    this.persist(next)
    return previous && previous.file !== image.file ? previous.file : null
  }

  updateUserImageOptions(ref: PanelThemeRef, mode: PanelThemeMode, options: PanelThemeUserImageOptions): boolean {
    const next = cloneData(this.load())
    const image = next.userImages[ref.pluginId]?.[ref.themeId]?.[mode]
    if (!image) return false
    Object.assign(image, { fit: options.fit, position: options.position, dim: options.dim, blur: options.blur })
    this.persist(next)
    return true
  }

  /** 移除一筆項目。回傳其檔名（若有）。 */
  clearUserImage(ref: PanelThemeRef, mode: PanelThemeMode): string | null {
    const next = cloneData(this.load())
    const themes = next.userImages[ref.pluginId]
    const image = themes?.[ref.themeId]?.[mode]
    if (!themes || !image) return null
    delete themes[ref.themeId]![mode]
    if (Object.keys(themes[ref.themeId]!).length === 0) delete themes[ref.themeId]
    if (Object.keys(themes).length === 0) delete next.userImages[ref.pluginId]
    this.persist(next)
    return image.file
  }

  /** 丟棄已移除插件的所有項目與插槽。 */
  removePlugin(pluginId: string): boolean {
    if (!isPanelThemeOwnerId(pluginId)) throw new TypeError('Plugin id is invalid')
    const current = this.load()
    const next = cloneData(current)
    let changed = false
    for (const mode of PANEL_THEME_MODES) {
      if (next.slots[mode]?.pluginId === pluginId) {
        next.slots[mode] = null
        changed = true
      }
    }
    if (next.userImages[pluginId]) {
      delete next.userImages[pluginId]
      changed = true
    }
    if (changed) this.persist(next)
    return changed
  }

  /**
   * 更新/同步時修剪（spec §4.3）：清除主題或模式已消失的插槽，
   * 丟棄模式不再允許使用者圖片、或插件已不存在的圖片項目。
   * 停用的插件保留一切。回傳不再被引用的 `pluginId/file` 路徑。
   */
  prune(validity: PanelThemeStoreValidity): string[] {
    const current = this.load()
    const next = cloneData(current)
    let changed = false
    for (const mode of PANEL_THEME_MODES) {
      const slot = next.slots[mode]
      if (slot && (!validity.isInstalled(slot.pluginId) || !validity.modeExists(slot.pluginId, slot.themeId, mode))) {
        next.slots[mode] = null
        changed = true
      }
    }
    const removed: string[] = []
    for (const [pluginId, themes] of Object.entries(next.userImages)) {
      for (const [themeId, modes] of Object.entries(themes)) {
        for (const mode of PANEL_THEME_MODES) {
          const image = modes[mode]
          if (!image) continue
          if (validity.isInstalled(pluginId) && validity.allowsUserImage(pluginId, themeId, mode)) continue
          delete modes[mode]
          removed.push(`${pluginId}/${image.file}`)
          changed = true
        }
        if (Object.keys(modes).length === 0) delete themes[themeId]
      }
      if (Object.keys(themes).length === 0) delete next.userImages[pluginId]
    }
    if (changed) this.persist(next)
    const stillReferenced = this.referencedFiles()
    return removed.filter(file => !stillReferenced.has(file))
  }

  /** 每筆已儲存項目的 `pluginId/file`。 */
  referencedFiles(): Set<string> {
    const files = new Set<string>()
    for (const [pluginId, themes] of Object.entries(this.load().userImages)) {
      for (const modes of Object.values(themes)) {
        for (const image of Object.values(modes)) if (image) files.add(`${pluginId}/${image.file}`)
      }
    }
    return files
  }

  private load(): PanelThemeStoreData {
    if (this.stored === null) {
      const read = readStored(this.filePath)
      this.unsafeFile = read.unsafe
      const parsed = read.value === undefined ? null : parsePanelThemeStoreData(read.value)
      this.corruptBackupRequired = read.backupRequired || (read.value !== undefined && parsed === null)
      this.stored = parsed ?? emptyPanelThemeStoreData()
    }
    return this.stored
  }

  private backupCorruptFile(): void {
    if (!this.corruptBackupRequired) return
    let stat: fs.Stats
    try {
      stat = fs.lstatSync(this.filePath)
    } catch (error) {
      if (isErrorCode(error, 'ENOENT')) {
        this.corruptBackupRequired = false
        return
      }
      throw error
    }
    if (stat.isSymbolicLink() || !stat.isFile()) throw new PanelThemeStoreFileError()
    let timestamp = Date.now()
    let backupPath = `${this.filePath}.corrupt-${timestamp}`
    while (fs.existsSync(backupPath)) {
      timestamp += 1
      backupPath = `${this.filePath}.corrupt-${timestamp}`
    }
    renameSyncWithRetry(this.filePath, backupPath)
    this.corruptBackupRequired = false
  }

  private persist(value: PanelThemeStoreData): void {
    if (this.unsafeFile) throw new PanelThemeStoreFileError()
    try {
      const stat = fs.lstatSync(this.filePath)
      if (stat.isSymbolicLink() || !stat.isFile()) throw new PanelThemeStoreFileError()
    } catch (error) {
      if (!isErrorCode(error, 'ENOENT')) throw error
    }
    const encoded = JSON.stringify(value)
    if (Buffer.byteLength(encoded, 'utf8') > PANEL_THEME_STORE_MAX_BYTES) throw new RangeError('panel theme store is too large')
    this.backupCorruptFile()
    writeJsonAtomic(this.filePath, value)
    this.stored = cloneData(value)
  }
}
