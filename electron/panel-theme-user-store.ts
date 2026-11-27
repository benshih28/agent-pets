import { randomBytes, randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { writeFileAtomicSync } from './atomic-file-write.ts'
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

// 修剪（插槽與背景圖）只能依「磁碟上確定不存在」來刪：目錄不安全、掃描被截斷時什麼都不刪；
// 讀不到、版本較新（降級後）或超過數量上限的檔案仍算「存在」。

export const USER_PANEL_THEMES_DIRECTORY = 'panel-themes-user'
const FILE_NAME = /^(u-[0-9a-f]{12})\.json$/
const TEMPORARY_FILE = /^\.u-[0-9a-f]{12}\.[0-9a-f-]{36}\.tmp$/
const CORRUPT_BACKUP = /^u-[0-9a-f]{12}\.json\.corrupt-(\d{1,16})$/
export const USER_PANEL_THEME_SCAN_LIMIT = USER_PANEL_THEME_MAX_COUNT * 2 + 16
// 含 `.DS_Store`、備份等不相干的檔案；超過就視為掃描被截斷。
export const USER_PANEL_THEME_SCAN_ENTRY_LIMIT = 4096
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
  randomHex?: () => string
  validate?: (definition: unknown) => PanelThemeValidation
}

function isErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code)
}

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
  // 磁碟上存在但沒載入成可編輯記錄的 id（讀取失敗、symlink、較新 schemaVersion、超過上限）：不顯示、不覆寫、不修剪。
  private readonly retained = new Set<string>()
  private unsafe = false
  // 還有沒看到的檔案，所以「不在清單裡」不代表「不存在」。
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

  list(): UserPanelThemeRecord[] {
    return [...this.load().values()].sort(compareRecords).map(record => structuredClone(record))
  }

  get(id: string): UserPanelThemeRecord | null {
    const record = isUserPanelThemeId(id) ? this.load().get(id) : undefined
    return record ? structuredClone(record) : null
  }

  // 背景圖依記錄本身的設定判斷，不看驗證器：驗證規則日後變嚴格也不會讓仍存在的主題失去圖片。
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
    // 唯讀的檔案也佔名額。
    if (records.size + this.retained.size >= USER_PANEL_THEME_MAX_COUNT) throw new UserPanelThemeStoreError('limit_reached')
    const cleanName = this.requireName(name)
    const cleanDefinition = this.requireDefinition(definition)
    let id = `u-${this.randomHex()}`
    // 保證不覆寫既有主題（包括看不懂的較新版本檔案）。
    while (records.has(id) || this.retained.has(id) || !isUserPanelThemeId(id)) id = `u-${randomBytes(6).toString('hex')}`
    const timestamp = new Date(this.now()).toISOString()
    const record: UserPanelThemeRecord = { schemaVersion: USER_PANEL_THEME_SCHEMA_VERSION, id, name: cleanName, createdAt: timestamp, updatedAt: timestamp, definition: cleanDefinition }
    this.write(record)
    return structuredClone(record)
  }

  // 定義與名稱在同一次寫入，不會只套用一半。
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

  delete(id: unknown): boolean {
    if (!isUserPanelThemeId(id)) return false
    const records = this.load()
    if (!records.has(id)) return false
    this.assertDirectory()
    const target = path.join(this.directory, `${id}.json`)
    try {
      const stat = fs.lstatSync(target)
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
        // 暫時讀不到不是損毀，也不能當成已刪除。
        this.retained.add(id)
      }
    }
    loaded.sort(compareRecords)
    for (const record of loaded.slice(0, USER_PANEL_THEME_MAX_COUNT)) records.set(record.id, record)
    for (const record of loaded.slice(USER_PANEL_THEME_MAX_COUNT)) this.retained.add(record.id)
    this.rotateBackups(backups)
    return records
  }

  // 上限算在主題檔與暫存檔上，不相干的檔案不會擠掉真正的主題；原始項目另有較大的硬上限。
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
    // 名稱要符合 TEMPORARY_FILE，下次載入才會清掉中斷寫入留下的暫存檔。
    const temporaryPath = path.join(this.directory, `.${record.id}.${randomUUID()}.tmp`)
    writeFileAtomicSync(target, encoded, { temporaryPath, mode: 0o600, enforceMode: true })
    this.load().set(record.id, structuredClone(record))
  }
}

export function readUserPanelThemeImportFile(filePath: string): { ok: true; value: unknown } | { ok: false } {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) return { ok: false }
  const read = readRegularJson(filePath)
  return read.ok ? { ok: true, value: read.value } : { ok: false }
}

// 暫存檔 + rename：目標若是 symlink 會被取代，不會寫穿到連結指向的檔案。
export function writeUserPanelThemeExportFile(filePath: string, contents: string): void {
  if (!path.isAbsolute(filePath)) throw new TypeError('export path must be absolute')
  if (Buffer.byteLength(contents, 'utf8') > USER_PANEL_THEME_MAX_BYTES) throw new UserPanelThemeStoreError('too_large')
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`)
  writeFileAtomicSync(filePath, contents, { temporaryPath, mode: 0o600 })
}
