import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { renameSyncWithRetry, renameWithRetry } from './fs-rename.ts'

// 「同目錄暫存檔 → 寫入 → rename」的底層步驟。刻意不做任何政策決策：
// symlink（追隨或拒絕）、目錄驗證、大小上限、備份都由呼叫端先處理，
// 呼叫端傳進來的 targetPath 就是要被取代的實際路徑。

export interface AtomicFileWriteOptions {
  /**
   * 暫存檔完整路徑，必須與 targetPath 同目錄（rename 才是原子的）。名稱格式由呼叫端決定，
   * 因為啟動清理（例如 `panel-theme-user-store.ts` 的 `TEMPORARY_FILE`）依賴它。
   */
  temporaryPath: string
  /** 建立暫存檔時的權限；省略時沿用 Node 預設（0o666，受 umask 影響）。 */
  mode?: number
  /** rename 後在 POSIX 上再 chmod 一次 `mode`：umask 只會遮掉建立時的位元，例如 0o644 在 umask 077 下會變 0o600。 */
  enforceMode?: boolean
  /** rename 前 fsync 暫存檔，讓斷電後不會看到內容為空的新檔。 */
  fsync?: boolean
}

export interface AsyncAtomicFileWriteOptions extends AtomicFileWriteOptions {
  /**
   * 暫存檔已寫好、rename 之前呼叫；拋出就放棄這次寫入並移除暫存檔。
   * 給「讀到寫之間檔案被別人改過就不覆蓋」這類檢查用，讓檢查離 rename 越近越好。
   */
  beforeRename?: () => Promise<void>
}

/** `.<檔名>.<pid>.<毫秒時間>.tmp`：多數 store 共用的暫存檔名稱。 */
export function pidTimestampTemporaryPath(targetPath: string): string {
  return path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`)
}

function assertSameDirectory(targetPath: string, temporaryPath: string): void {
  if (path.dirname(temporaryPath) !== path.dirname(targetPath)) {
    throw new TypeError('atomic write temporary file must live next to its target')
  }
}

export function writeFileAtomicSync(targetPath: string, data: string | Uint8Array, options: AtomicFileWriteOptions): void {
  const { temporaryPath, mode } = options
  assertSameDirectory(targetPath, temporaryPath)
  // 只清除自己建立的暫存檔：`wx` 遇到同名檔案（EEXIST）時那個檔案不是我們的。
  let created = false
  try {
    const descriptor = fs.openSync(temporaryPath, 'wx', mode)
    created = true
    try {
      fs.writeFileSync(descriptor, data)
      if (options.fsync) fs.fsyncSync(descriptor)
    } finally {
      fs.closeSync(descriptor)
    }
    renameSyncWithRetry(temporaryPath, targetPath)
  } catch (error) {
    if (created) {
      try { fs.rmSync(temporaryPath, { force: true }) } catch {}
    }
    throw error
  }
  if (options.enforceMode && mode !== undefined && process.platform !== 'win32') {
    try { fs.chmodSync(targetPath, mode) } catch {}
  }
}

/** 與 writeFileAtomicSync 規則完全相同的非同步版，給主程序不能被磁碟 I/O 卡住的路徑使用。 */
export async function writeFileAtomic(targetPath: string, data: string | Uint8Array, options: AsyncAtomicFileWriteOptions): Promise<void> {
  const { temporaryPath, mode } = options
  assertSameDirectory(targetPath, temporaryPath)
  let created = false
  try {
    const handle = await fsp.open(temporaryPath, 'wx', mode)
    created = true
    try {
      await handle.writeFile(data)
      if (options.fsync) await handle.sync()
    } finally {
      await handle.close()
    }
    await options.beforeRename?.()
    await renameWithRetry(temporaryPath, targetPath)
  } catch (error) {
    if (created) {
      try { await fsp.rm(temporaryPath, { force: true }) } catch {}
    }
    throw error
  }
  if (options.enforceMode && mode !== undefined && process.platform !== 'win32') {
    try { await fsp.chmod(targetPath, mode) } catch {}
  }
}
