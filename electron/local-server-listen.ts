import type { Server } from 'node:net'

export const LOCAL_SERVER_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000] as const

export interface LocalServerListenOptions {
  label: string
  onListening?: () => void
  logError?: (message: string, error?: unknown) => void
}

/**
 * 埠被暫時佔用（舊實例還在結束、測試用的 App、其他程式）時持續重試，
 * 否則 hook 伺服器會整個 App 生命週期都沒有啟動，寵物再也收不到狀態。
 * server 被 close() 後停止重試；未處理的 'error' 會讓整個主行程崩潰，所以一律在這裡接住。
 */
export function listenOnLocalPort(server: Server, port: number, options: LocalServerListenOptions): void {
  const logError = options.logError ?? ((message, error) => console.error(message, ...(error === undefined ? [] : [error])))
  let failedAttempts = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let closed = false

  server.once('close', () => {
    closed = true
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = null
  })
  server.on('listening', () => {
    if (failedAttempts > 0) logError(`${options.label} port ${port} is free again; listening.`)
    failedAttempts = 0
    options.onListening?.()
  })
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EADDRINUSE') {
      logError(`${options.label} server error:`, error)
      return
    }
    if (closed) return
    if (failedAttempts === 0) logError(`${options.label} port ${port} is already in use; retrying until it is free.`)
    const delay = LOCAL_SERVER_RETRY_DELAYS_MS[Math.min(failedAttempts, LOCAL_SERVER_RETRY_DELAYS_MS.length - 1)]
    failedAttempts += 1
    retryTimer = setTimeout(() => {
      retryTimer = null
      if (!closed && !server.listening) server.listen(port, '127.0.0.1')
    }, delay)
    retryTimer.unref?.()
  })
  server.listen(port, '127.0.0.1')
}
