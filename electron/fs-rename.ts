import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'

export const RENAME_RETRY_DELAYS_MS = [10, 20, 40, 80, 160, 320, 640] as const

const RETRYABLE_WINDOWS_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])
const sleepCell = new Int32Array(new SharedArrayBuffer(4))

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

// Windows 上 Defender／搜尋索引會短暫握住剛寫入的檔案，rename 偶發 EPERM，退避後通常成功。
// 其他平台的同類錯誤是真正的權限問題，直接拋出。
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
