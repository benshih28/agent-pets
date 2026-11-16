import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'

// 總等待約 1.3 秒；只有在第一次 rename 失敗時才會付出這段時間。
export const RENAME_RETRY_DELAYS_MS = [10, 20, 40, 80, 160, 320, 640] as const

const RETRYABLE_WINDOWS_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])
const sleepCell = new Int32Array(new SharedArrayBuffer(4))

// 同步與非同步版共用同一個重試判斷，退避策略不會各改各的。
function nextRenameRetryDelay(error: unknown, attempt: number, platform: NodeJS.Platform): number | null {
  const code = (error as NodeJS.ErrnoException | null)?.code
  if (platform !== 'win32' || !code || !RETRYABLE_WINDOWS_CODES.has(code)
    || attempt >= RENAME_RETRY_DELAYS_MS.length) return null
  return RENAME_RETRY_DELAYS_MS[attempt]!
}

export interface RenameRetryDependencies {
  platform?: NodeJS.Platform
  rename?: (from: string, to: string) => void
  sleep?: (ms: number) => void
}

/**
 * Windows 上 Defender／搜尋索引會短暫握住剛寫入的檔案，rename 會偶發 EPERM
 * （實測剛寫入的目錄約 3%），造成插件安裝或設定儲存隨機失敗；短暫退避後通常就能成功。
 * 其他平台的同類錯誤是真正的權限問題，直接拋出。
 */
export function renameSyncWithRetry(from: string, to: string, dependencies: RenameRetryDependencies = {}): void {
  const platform = dependencies.platform ?? process.platform
  const rename = dependencies.rename ?? fs.renameSync
  const sleep = dependencies.sleep ?? (ms => { Atomics.wait(sleepCell, 0, 0, ms) })
  for (let attempt = 0; ; attempt += 1) {
    try {
      rename(from, to)
      return
    } catch (error) {
      const delay = nextRenameRetryDelay(error, attempt, platform)
      if (delay === null) throw error
      sleep(delay)
    }
  }
}

export interface AsyncRenameRetryDependencies {
  platform?: NodeJS.Platform
  rename?: (from: string, to: string) => Promise<void>
  sleep?: (ms: number) => Promise<void>
}

/** 非同步版：退避期間不佔住主程序事件迴圈（同步版的 Atomics.wait 會整段凍結）。 */
export async function renameWithRetry(from: string, to: string, dependencies: AsyncRenameRetryDependencies = {}): Promise<void> {
  const platform = dependencies.platform ?? process.platform
  const rename = dependencies.rename ?? fsp.rename
  const sleep = dependencies.sleep ?? (ms => new Promise<void>(resolve => { setTimeout(resolve, ms) }))
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      const delay = nextRenameRetryDelay(error, attempt, platform)
      if (delay === null) throw error
      await sleep(delay)
    }
  }
}
