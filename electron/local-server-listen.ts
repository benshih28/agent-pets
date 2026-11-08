import type { Server } from 'node:net'

export const LOCAL_SERVER_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000] as const
/** After this many failed bind attempts the failure is considered persistent and reported once. */
export const LOCAL_SERVER_PERSISTENT_FAILURE_ATTEMPTS = 3

export type LocalServerListenState = 'listening' | 'retrying' | 'failed'

export interface LocalServerListenStatus {
  state: LocalServerListenState
  attempt: number
  code?: string
}

export interface LocalServerListenOptions {
  label: string
  onListening?: () => void
  logError?: (message: string, error?: unknown) => void
  /** Called on every state transition so the app can surface health to the user. */
  onStatus?: (status: LocalServerListenStatus) => void
  /** Called at most once per failure episode (retry budget exhausted or a non-retryable error). */
  onPersistentFailure?: (status: LocalServerListenStatus) => void
}

export interface LocalServerListenHandle {
  status(): LocalServerListenStatus
  /** Cancels any wait and tries to bind immediately. */
  retryNow(): void
}

/**
 * 埠被暫時佔用（舊實例還在結束、測試用的 App、其他程式）時持續重試，
 * 否則 hook 伺服器會整個 App 生命週期都沒有啟動，寵物再也收不到狀態。
 * server 被 close() 後停止重試；未處理的 'error' 會讓整個主行程崩潰，所以一律在這裡接住。
 * 非 EADDRINUSE（例如 EACCES）重試無意義：只回報，不重試，直到使用者手動 retryNow()。
 */
export function listenOnLocalPort(server: Server, port: number, options: LocalServerListenOptions): LocalServerListenHandle {
  const logError = options.logError ?? ((message, error) => console.error(message, ...(error === undefined ? [] : [error])))
  let failedAttempts = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let closed = false
  let reportedPersistent = false
  let current: LocalServerListenStatus = { state: 'retrying', attempt: 0 }

  const setStatus = (status: LocalServerListenStatus) => {
    current = status
    try { options.onStatus?.(status) } catch {}
  }
  const bind = () => {
    if (closed || server.listening) return
    try { server.listen(port, '127.0.0.1') } catch (error) {
      logError(`${options.label} server could not start:`, error)
    }
  }

  server.once('close', () => {
    closed = true
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = null
  })
  server.on('listening', () => {
    if (failedAttempts > 0) logError(`${options.label} port ${port} is free again; listening.`)
    failedAttempts = 0
    reportedPersistent = false
    setStatus({ state: 'listening', attempt: 0 })
    options.onListening?.()
  })
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (closed) return
    const code = typeof error.code === 'string' ? error.code : 'UNKNOWN'
    if (code !== 'EADDRINUSE') {
      logError(`${options.label} server error:`, error)
      failedAttempts += 1
      setStatus({ state: 'failed', attempt: failedAttempts, code })
      if (!reportedPersistent) {
        reportedPersistent = true
        try { options.onPersistentFailure?.(current) } catch {}
      }
      return
    }
    if (failedAttempts === 0) logError(`${options.label} port ${port} is already in use; retrying until it is free.`)
    const delay = LOCAL_SERVER_RETRY_DELAYS_MS[Math.min(failedAttempts, LOCAL_SERVER_RETRY_DELAYS_MS.length - 1)]
    failedAttempts += 1
    setStatus({ state: 'retrying', attempt: failedAttempts, code })
    if (failedAttempts >= LOCAL_SERVER_PERSISTENT_FAILURE_ATTEMPTS && !reportedPersistent) {
      reportedPersistent = true
      try { options.onPersistentFailure?.(current) } catch {}
    }
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = setTimeout(() => {
      retryTimer = null
      bind()
    }, delay)
    retryTimer.unref?.()
  })
  bind()

  return {
    status: () => current,
    retryNow() {
      if (closed || server.listening) return
      if (retryTimer) clearTimeout(retryTimer)
      retryTimer = null
      bind()
    },
  }
}
