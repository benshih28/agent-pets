import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { renameSyncWithRetry, renameWithRetry } from './fs-rename.ts'

// 刻意不做政策決策：symlink、目錄驗證、大小上限、備份都由呼叫端先處理，targetPath 就是被取代的實際路徑。

export interface AtomicFileWriteOptions {
  /** 必須與 targetPath 同目錄（rename 才是原子的）；名稱格式由呼叫端決定，因為啟動清理依賴它。 */
  temporaryPath: string
  mode?: number
  /** umask 會遮掉建立時的權限位元，所以 POSIX 上 rename 後要再 chmod 一次。 */
  enforceMode?: boolean
  /** 斷電後不會看到內容為空的新檔。 */
  fsync?: boolean
}

export interface AsyncAtomicFileWriteOptions extends AtomicFileWriteOptions {
  /** rename 之前呼叫；拋出就放棄寫入並移除暫存檔。 */
  beforeRename?: () => Promise<void>
}

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
