import { randomBytes, randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { renameSyncWithRetry } from './fs-rename.ts'
import { isFutureUserPanelThemeRecord, parseUserPanelThemeDefinition, parseUserPanelThemeName, parseUserPanelThemeRecord } from './panel-theme-user.ts'
import { userPanelThemeSchemaFailure, validateUserPanelTheme } from './panel-theme-diagnostics.ts'
import {
  USER_PANEL_THEME_MAX_BYTES,
  USER_PANEL_THEME_MAX_COUNT,
  USER_PANEL_THEME_SCHEMA_VERSION,
  isUserPanelThemeId,
  type PanelThemeValidation,
  type UserPanelThemeDefinition,
  type UserPanelThemeRecord,
} from '../src/types/panel-theme-user.ts'
import type { PanelThemeMode } from '../src/types/panel-theme.ts'

// 「我的主題」的儲存（spec R22）：`userData/panel-themes-user/<id>.json`，一個主題一個檔案。
// 目錄 0o700、檔案 0o600，暫存檔 + rename 原子寫入；讀取時拒絕 symlink 與非一般檔案、
// O_NOFOLLOW 開啟並以 fstat 比對 dev/ino，大小有上限。損毀的檔案改名備份後略過（備份輪替，
// 只留最新幾份），不會讓其他主題消失。每次寫入前都以和插件主題相同的驗證器檢查定義。
//
// 修剪（插槽與背景圖）只能依「磁碟上確定不存在」來刪：目錄不安全、掃描被截斷時整個 store
// 視為未知，什麼都不刪；讀不到、版本較新（降級後）或超過數量上限的檔案仍算「存在」。

export const USER_PANEL_THEMES_DIRECTORY = 'panel-themes-user'
const FILE_NAME = /^(u-[0-9a-f]{12})\.json$/
const TEMPORARY_FILE = /^\.u-[0-9a-f]{12}\.[0-9a-f-]{36}\.tmp$/
const CORRUPT_BACKUP = /^u-[0-9a-f]{12}\.json\.corrupt-(\d{1,16})$/
/** 啟動時最多處理的主題檔與暫存檔數（主題上限的兩倍再加一點）。 */
export const USER_PANEL_THEME_SCAN_LIMIT = USER_PANEL_THEME_MAX_COUNT * 2 + 16
/** 目錄項目的原始迭代上限（含 `.DS_Store`、備份等不相干的檔案）；超過就視為掃描被截斷。 */
export const USER_PANEL_THEME_SCAN_ENTRY_LIMIT = 4096
/** 保留的損毀備份數（最新的幾份），更舊的在載入時刪除。 */
export const USER_PANEL_THEME_CORRUPT_BACKUPS_KEPT = 5

export type UserPanelThemeStoreErrorCode = 'unsafe_directory' | 'limit_reached' | 'not_found' | 'too_large' | 'invalid_definition' | 'invalid_name'

export class UserPanelThemeStoreError extends Error {
  readonly code: UserPanelThemeStoreErrorCode
  readonly validation?: PanelThemeValidation

  constructor(code: UserPanelThemeStoreErrorCode, validation?: PanelThemeValidation) {
    super(`User panel theme store: ${code}`)
    this.name = 'UserPanelThemeStoreError'
    this.code = code
    if (validation) this.validation = validation
  }
}

export interface UserPanelThemeStoreOptions {
  now?: () => number
  /** 產生新 id 的 12 個十六進位字元（測試可注入）。 */
  randomHex?: () => string
  /** 驗證器；預設為 validateUserPanelTheme（IPC 傳入有快取的版本）。 */
  validate?: (definition: unknown) => PanelThemeValidation
}

function isErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code)
}

/** 讀取一個一般檔案：不跟隨 symlink、大小有上限、開啟後與 lstat 比對是同一個檔案。 */
function readRegularJson(filePath: string): { ok: true; value: unknown } | { ok: false; corrupt: boolean } {
  let linkStat: fs.Stats
  try {
    linkStat = fs.lstatSync(filePath)
  } catch {
    return { ok: false, corrupt: false }
  }
  if (linkStat.isSymbolicLink() || !linkStat.isFile()) return { ok: false, corrupt: false }
  if (linkStat.size > USER_PANEL_THEME_MAX_BYTES) return { ok: false, corrupt: true }
  let descriptor: number | null = null
  try {
    const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow)
    const stat = fs.fstatSync(descriptor)
    if (!stat.isFile() || stat.dev !== linkStat.dev || stat.ino !== linkStat.ino) return { ok: false, corrupt: false }
    if (stat.size > USER_PANEL_THEME_MAX_BYTES) return { ok: false, corrupt: true }
    try {
      return { ok: true, value: JSON.parse(fs.readFileSync(descriptor, 'utf8')) as unknown }
    } catch {
      return { ok: false, corrupt: true }
    }
  } catch {
    return { ok: false, corrupt: false }
  } finally {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor) } catch {}
    }
  }
}

function compareRecords(first: UserPanelThemeRecord, second: UserPanelThemeRecord): number {
  return first.createdAt < second.createdAt ? -1 : first.createdAt > second.createdAt ? 1 : first.id < second.id ? -1 : first.id > second.id ? 1 : 0
}

export class UserPanelThemeStore {
  readonly directory: string
  private records: Map<string, UserPanelThemeRecord> | null = null
  /**
   * 磁碟上存在、但沒有載入成可編輯記錄的 id：讀取失敗（非損毀）、symlink、較新的 schemaVersion、
   * 超過數量上限。它們是唯讀的：不顯示、不覆寫、不修剪。
   */
  private readonly retained = new Set<string>()
  private unsafe = false
  /** 掃描被上限截斷：還有沒看到的檔案，所以「不在清單裡」不代表「不存在」。 */
  private truncated = false
  private readonly now: () => number
  private readonly randomHex: () => string
  private readonly validate: (definition: unknown) => PanelThemeValidation

  constructor(userDataDirectory: string, options: UserPanelThemeStoreOptions = {}) {
    if (!path.isAbsolute(userDataDirectory)) throw new TypeError('User panel theme store requires an absolute userData directory')
    this.directory = path.join(userDataDirectory, USER_PANEL_THEMES_DIRECTORY)
    this.now = options.now ?? Date.now
    this.randomHex = options.randomHex ?? (() => randomBytes(6).toString('hex'))
    this.validate = options.validate ?? validateUserPanelTheme
  }

  /** 依建立時間排序的所有主題（複本）。目錄不安全時為空。 */
  list(): UserPanelThemeRecord[] {
    return [...this.load().values()].sort(compareRecords).map(record => structuredClone(record))
  }

  get(id: string): UserPanelThemeRecord | null {
    const record = isUserPanelThemeId(id) ? this.load().get(id) : undefined
    return record ? structuredClone(record) : null
  }

  /**
   * 修剪是否必須保留這個主題模式的插槽（`needsUserImage` = 背景圖）。只有在目錄完整掃描過、
   * 而且磁碟上確定沒有這個 id 時才回傳 false；背景圖另外依記錄本身的設定（不是驗證器的結果，
   * 驗證規則日後變嚴格也不會讓仍存在的主題失去圖片）。
   */
  retains(id: string, mode: PanelThemeMode, needsUserImage: boolean): boolean {
    const records = this.load()
    if (this.unsafe || this.truncated || this.retained.has(id)) return true
    const record = records.get(id)
    if (!record) return false
    return !needsUserImage || record.definition.modes[mode].image !== null
  }

  isUnsafe(): boolean {
    this.load()
    return this.unsafe
  }

  create(name: unknown, definition: unknown): UserPanelThemeRecord {
    const records = this.load()
    // 唯讀的檔案也佔名額：目錄裡的主題檔總數維持有界。
    if (records.size + this.retained.size >= USER_PANEL_THEME_MAX_COUNT) throw new UserPanelThemeStoreError('limit_reached')
    const cleanName = this.requireName(name)
    const cleanDefinition = this.requireDefinition(definition)
    let id = `u-${this.randomHex()}`
    // 碰撞機率極低；仍保證不覆寫既有主題（包括看不懂的較新版本檔案）。
    while (records.has(id) || this.retained.has(id) || !isUserPanelThemeId(id)) id = `u-${randomBytes(6).toString('hex')}`
    const timestamp = new Date(this.now()).toISOString()
    const record: UserPanelThemeRecord = { schemaVersion: USER_PANEL_THEME_SCHEMA_VERSION, id, name: cleanName, createdAt: timestamp, updatedAt: timestamp, definition: cleanDefinition }
    this.write(record)
    return structuredClone(record)
  }

  /** 儲存定義；有 `name` 時同時改名。兩者在同一次暫存檔 + rename 寫入，不會只套用一半。 */
  update(id: unknown, definition: unknown, name?: unknown): UserPanelThemeRecord {
    const current = this.require(id)
    const cleanName = name === undefined ? current.name : this.requireName(name)
    return this.replace({ ...current, name: cleanName, definition: this.requireDefinition(definition) })
  }

  rename(id: unknown, name: unknown): UserPanelThemeRecord {
    const current = this.require(id)
    return this.replace({ ...current, name: this.requireName(name) })
  }

  duplicate(id: unknown, name: unknown): UserPanelThemeRecord {
    const current = this.require(id)
    return this.create(name, current.definition)
  }

  /** 刪除一個主題；不存在時回傳 false。 */
  delete(id: unknown): boolean {
    if (!isUserPanelThemeId(id)) return false
    const records = this.load()
    if (!records.has(id)) return false
    this.assertDirectory()
    const target = path.join(this.directory, `${id}.json`)
    try {
      const stat = fs.lstatSync(target)
      // rm 不會跟隨 symlink：連結本身被移除，目標不受影響。
      if (stat.isFile() || stat.isSymbolicLink()) fs.rmSync(target, { force: true })
    } catch (error) {
      if (!isErrorCode(error, 'ENOENT')) throw error
    }
    records.delete(id)
    return true
  }

  private require(id: unknown): UserPanelThemeRecord {
    const record = isUserPanelThemeId(id) ? this.load().get(id) : undefined
    if (!record) throw new UserPanelThemeStoreError('not_found')
    return record
  }

  private requireName(name: unknown): string {
    const clean = parseUserPanelThemeName(name)
    if (!clean) throw new UserPanelThemeStoreError('invalid_name')
    return clean
  }

  /** 結構解析之後再以完整驗證器檢查（只傳入解析後的定義）；任何問題都拒絕寫入。 */
  private requireDefinition(definition: unknown): UserPanelThemeDefinition {
    const parsed = parseUserPanelThemeDefinition(definition)
    if (!parsed.ok) throw new UserPanelThemeStoreError('invalid_definition', userPanelThemeSchemaFailure(parsed))
    const validation = this.validate(parsed.value)
    if (!validation.valid) throw new UserPanelThemeStoreError('invalid_definition', validation)
    return parsed.value
  }

  private replace(record: UserPanelThemeRecord): UserPanelThemeRecord {
    const next: UserPanelThemeRecord = { ...record, updatedAt: new Date(Math.max(this.now(), Date.parse(record.createdAt))).toISOString() }
    this.write(next)
    return structuredClone(next)
  }

  private load(): Map<string, UserPanelThemeRecord> {
    if (this.records) return this.records
    const records = new Map<string, UserPanelThemeRecord>()
    this.records = records
    let stat: fs.Stats
    try {
      stat = fs.lstatSync(this.directory)
    } catch (error) {
      this.unsafe = !isErrorCode(error, 'ENOENT')
      return records
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      this.unsafe = true
      return records
    }
    const scan = this.scan()
    if (!scan) {
      this.unsafe = true
      return records
    }
    const loaded: UserPanelThemeRecord[] = []
    const backups = scan.backups
    for (const [id, name] of scan.themes) {
      const filePath = path.join(this.directory, name)
      const read = readRegularJson(filePath)
      if (read.ok && isFutureUserPanelThemeRecord(read.value)) {
        this.retained.add(id)
        continue
      }
      const record = read.ok ? parseUserPanelThemeRecord(read.value, id) : null
      if (record) {
        loaded.push(record)
      } else if (read.ok || read.corrupt) {
        const backup = this.backupCorrupt(filePath)
        if (backup) backups.push(backup)
      } else {
        // 暫時讀不到（權限、symlink、競態）：不是損毀，也不能當成已刪除。
        this.retained.add(id)
      }
    }
    loaded.sort(compareRecords)
    for (const record of loaded.slice(0, USER_PANEL_THEME_MAX_COUNT)) records.set(record.id, record)
    for (const record of loaded.slice(USER_PANEL_THEME_MAX_COUNT)) this.retained.add(record.id)
    this.rotateBackups(backups)
    return records
  }

  /**
   * 以 opendir 逐項讀取目錄：上限算在主題檔與暫存檔上（不相干的檔案不會擠掉真正的主題），
   * 原始項目另有一個較大的硬上限。任一上限觸發都標記為截斷。目錄讀不到時回傳 null。
   */
  private scan(): { themes: Array<[string, string]>; backups: Array<{ name: string; timestamp: number }> } | null {
    const themes: Array<[string, string]> = []
    const backups: Array<{ name: string; timestamp: number }> = []
    let directory: fs.Dir
    try {
      directory = fs.opendirSync(this.directory)
    } catch {
      return null
    }
    try {
      let matched = 0
      for (let seen = 0; ; seen += 1) {
        const entry = directory.readSync()
        if (!entry) break
        if (seen >= USER_PANEL_THEME_SCAN_ENTRY_LIMIT || matched >= USER_PANEL_THEME_SCAN_LIMIT) {
          this.truncated = true
          break
        }
        if (TEMPORARY_FILE.test(entry.name)) {
          matched += 1
          // 上次寫到一半就結束留下的暫存檔。
          if (entry.isFile()) {
            try { fs.rmSync(path.join(this.directory, entry.name), { force: true }) } catch {}
          }
          continue
        }
        const match = FILE_NAME.exec(entry.name)
        if (match) {
          matched += 1
          themes.push([match[1]!, entry.name])
          continue
        }
        const backup = CORRUPT_BACKUP.exec(entry.name)
        if (backup && entry.isFile()) backups.push({ name: entry.name, timestamp: Number(backup[1]) })
      }
    } catch {
      return null
    } finally {
      try { directory.closeSync() } catch {}
    }
    return { themes, backups }
  }

  /** 損毀的檔案改名成 `<id>.json.corrupt-<時間>`（不再符合檔名規則，之後不會被讀取）。 */
  private backupCorrupt(filePath: string): { name: string; timestamp: number } | null {
    let timestamp = this.now()
    let backup = `${filePath}.corrupt-${timestamp}`
    while (fs.existsSync(backup)) {
      timestamp += 1
      backup = `${filePath}.corrupt-${timestamp}`
    }
    try {
      renameSyncWithRetry(filePath, backup)
    } catch {
      // 改名失敗：檔案還在原位，不能讓修剪把它當成已刪除。
      const match = FILE_NAME.exec(path.basename(filePath))
      if (match) this.retained.add(match[1]!)
      return null
    }
    return { name: path.basename(backup), timestamp }
  }

  /** 只留最新的幾份損毀備份；備份是給使用者手動救回用的，不需要無限累積。 */
  private rotateBackups(backups: Array<{ name: string; timestamp: number }>): void {
    if (backups.length <= USER_PANEL_THEME_CORRUPT_BACKUPS_KEPT) return
    backups.sort((first, second) => second.timestamp - first.timestamp || (first.name < second.name ? -1 : 1))
    for (const { name } of backups.slice(USER_PANEL_THEME_CORRUPT_BACKUPS_KEPT)) {
      try { fs.rmSync(path.join(this.directory, name), { force: true }) } catch {}
    }
  }

  private assertDirectory(): void {
    if (this.unsafe) throw new UserPanelThemeStoreError('unsafe_directory')
    const stat = fs.lstatSync(this.directory)
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new UserPanelThemeStoreError('unsafe_directory')
  }

  private ensureDirectory(): void {
    if (this.unsafe) throw new UserPanelThemeStoreError('unsafe_directory')
    try {
      fs.mkdirSync(this.directory, { mode: 0o700 })
    } catch (error) {
      if (!isErrorCode(error, 'EEXIST')) throw error
    }
    this.assertDirectory()
    if (process.platform !== 'win32') {
      try { fs.chmodSync(this.directory, 0o700) } catch {}
    }
  }

  private write(record: UserPanelThemeRecord): void {
    const encoded = JSON.stringify(record)
    if (Buffer.byteLength(encoded, 'utf8') > USER_PANEL_THEME_MAX_BYTES) throw new UserPanelThemeStoreError('too_large')
    this.ensureDirectory()
    const target = path.join(this.directory, `${record.id}.json`)
    try {
      const existing = fs.lstatSync(target)
      if (existing.isSymbolicLink() || !existing.isFile()) throw new UserPanelThemeStoreError('unsafe_directory')
    } catch (error) {
      if (!isErrorCode(error, 'ENOENT')) throw error
    }
    const temporary = path.join(this.directory, `.${record.id}.${randomUUID()}.tmp`)
    try {
      fs.writeFileSync(temporary, encoded, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      renameSyncWithRetry(temporary, target)
      if (process.platform !== 'win32') {
        try { fs.chmodSync(target, 0o600) } catch {}
      }
    } catch (error) {
      try { fs.rmSync(temporary, { force: true }) } catch {}
      throw error
    }
    this.load().set(record.id, structuredClone(record))
  }
}

/** 讀取使用者選的匯入檔：一般檔案、不跟隨 symlink、≤ 16 KiB、只讀一次；回傳解析後的 JSON。 */
export function readUserPanelThemeImportFile(filePath: string): { ok: true; value: unknown } | { ok: false } {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) return { ok: false }
  const read = readRegularJson(filePath)
  return read.ok ? { ok: true, value: read.value } : { ok: false }
}

/**
 * 寫出匯出檔到使用者在儲存對話框選的位置：同目錄暫存檔（wx、0o600）再 rename，
 * 所以目標若是 symlink 會被取代，而不是寫穿到連結指向的檔案。
 */
export function writeUserPanelThemeExportFile(filePath: string, contents: string): void {
  if (!path.isAbsolute(filePath)) throw new TypeError('export path must be absolute')
  if (Buffer.byteLength(contents, 'utf8') > USER_PANEL_THEME_MAX_BYTES) throw new UserPanelThemeStoreError('too_large')
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`)
  try {
    fs.writeFileSync(temporary, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    renameSyncWithRetry(temporary, filePath)
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }) } catch {}
    throw error
  }
}
