export interface ShutdownCoordinatorOptions {
  /** Persist anything debounced (window bounds, shimeji position). Runs before any store is closed. */
  flush: () => void
  /** In-flight work worth waiting for (for example a local usage scan); null when idle. */
  pendingWork: () => Promise<unknown> | null
  /** Clears timers, closes servers/stores. Must be safe to call once. */
  teardown: () => void
  quit: () => void
  waitTimeoutMs?: number
  log?: (message: string, error?: unknown) => void
  setTimer?: (callback: () => void, delay: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export interface ShutdownCoordinator {
  /** Wire to `app.on('before-quit')`. */
  onBeforeQuit(event: { preventDefault(): void }): void
  /** For paths that bypass before-quit (app.exit after relaunch): flush and tear down synchronously. */
  runNow(): void
  state(): 'idle' | 'waiting' | 'done'
}

export function createShutdownCoordinator(options: ShutdownCoordinatorOptions): ShutdownCoordinator {
  const timeoutMs = options.waitTimeoutMs ?? 1_500
  const setTimer = options.setTimer ?? ((cb, delay) => setTimeout(cb, delay))
  const clearTimer = options.clearTimer ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>))
  let state: 'idle' | 'waiting' | 'done' = 'idle'

  const finish = () => {
    if (state === 'done') return
    state = 'done'
    try { options.teardown() } catch (error) { options.log?.('Shutdown teardown failed', error) }
  }
  const flush = () => {
    try { options.flush() } catch (error) { options.log?.('Shutdown flush failed', error) }
  }

  return {
    onBeforeQuit(event) {
      if (state === 'done') return
      if (state === 'waiting') {
        // A second quit request while we wait for work to settle.
        event.preventDefault()
        return
      }
      flush()
      const pending = options.pendingWork()
      if (!pending) {
        finish()
        return
      }
      state = 'waiting'
      event.preventDefault()
      let settled = false
      const proceed = () => {
        if (settled) return
        settled = true
        clearTimer(timer)
        finish()
        options.quit()
      }
      const timer = setTimer(proceed, timeoutMs)
      pending.then(proceed, proceed)
    },
    runNow() {
      if (state === 'done') return
      flush()
      finish()
    },
    state: () => state,
  }
}
