import type { EventEmitter } from 'node:events'

export interface RecoverableWebContents extends Pick<EventEmitter, 'on' | 'off'> {
  isDestroyed(): boolean
}

export interface RendererRecoveryOptions {
  label: string
  /** Reload the page in place. Should be a no-op when the contents are gone. */
  reload: () => void
  log: (level: 'error' | 'warn', message: string) => void
  /** Called once the reload budget is exhausted; the renderer stays down until manual recovery. */
  onGaveUp?: (label: string) => void
  /** Called after every successful load that follows a failure/crash, to re-push main-owned state. */
  onRecovered?: (label: string) => void
  maxReloads?: number
  windowMs?: number
  /** Exponential-ish backoff between attempts; the last value repeats. */
  delaysMs?: readonly number[]
  unresponsiveGraceMs?: number
  now?: () => number
  setTimer?: (callback: () => void, delay: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export interface RendererRecovery {
  /** Resets the budget and reloads immediately (tray rescue / error boundary). */
  manualReload(): void
  dispose(): void
  state(): { reloads: number; gaveUp: boolean }
}

const ERR_ABORTED = -3
const DEFAULT_DELAYS = [250, 1_000, 3_000] as const

export function attachRendererRecovery(
  contents: RecoverableWebContents,
  options: RendererRecoveryOptions,
): RendererRecovery {
  const now = options.now ?? Date.now
  const setTimer = options.setTimer ?? ((cb, delay) => {
    const handle = setTimeout(cb, delay)
    handle.unref?.()
    return handle
  })
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const maxReloads = options.maxReloads ?? 3
  const windowMs = options.windowMs ?? 5 * 60_000
  const delays = options.delaysMs ?? DEFAULT_DELAYS
  const graceMs = options.unresponsiveGraceMs ?? 10_000

  let attempts: number[] = []
  let gaveUp = false
  let pendingReload: unknown = null
  let unresponsiveTimer: unknown = null
  let needsResync = false
  let disposed = false

  const clearPending = () => {
    if (pendingReload) clearTimer(pendingReload)
    pendingReload = null
  }
  const clearUnresponsive = () => {
    if (unresponsiveTimer) clearTimer(unresponsiveTimer)
    unresponsiveTimer = null
  }

  const schedule = (reason: string) => {
    if (disposed || gaveUp || pendingReload) return
    const current = now()
    attempts = attempts.filter(at => current - at < windowMs)
    if (attempts.length >= maxReloads) {
      gaveUp = true
      options.log('error', `${options.label}: renderer recovery gave up after ${attempts.length} reloads (${reason})`)
      options.onGaveUp?.(options.label)
      return
    }
    const delay = delays[Math.min(attempts.length, delays.length - 1)] ?? 0
    attempts.push(current)
    needsResync = true
    options.log('warn', `${options.label}: reloading renderer in ${delay}ms (${reason})`)
    pendingReload = setTimer(() => {
      pendingReload = null
      if (disposed || contents.isDestroyed()) return
      try { options.reload() } catch (error) {
        options.log('error', `${options.label}: reload failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }, delay)
  }

  const onGone = (_event: unknown, details: { reason?: string }) => {
    const reason = typeof details?.reason === 'string' ? details.reason : 'unknown'
    if (reason === 'clean-exit') return
    options.log('error', `${options.label}: render-process-gone (${reason})`)
    schedule(`gone:${reason}`)
  }
  const onUnresponsive = () => {
    options.log('warn', `${options.label}: renderer unresponsive`)
    if (unresponsiveTimer) return
    unresponsiveTimer = setTimer(() => {
      unresponsiveTimer = null
      schedule('unresponsive')
    }, graceMs)
  }
  const onResponsive = () => clearUnresponsive()
  const onFailLoad = (
    _event: unknown,
    errorCode: number,
    errorDescription: string,
    _url: string,
    isMainFrame: boolean,
  ) => {
    if (!isMainFrame || errorCode === ERR_ABORTED) return
    options.log('error', `${options.label}: did-fail-load ${errorCode} ${errorDescription}`)
    schedule(`fail-load:${errorCode}`)
  }
  const onFinishLoad = () => {
    clearUnresponsive()
    if (!needsResync) return
    needsResync = false
    try { options.onRecovered?.(options.label) } catch (error) {
      options.log('error', `${options.label}: resync failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  contents.on('render-process-gone', onGone)
  contents.on('unresponsive', onUnresponsive)
  contents.on('responsive', onResponsive)
  contents.on('did-fail-load', onFailLoad)
  contents.on('did-finish-load', onFinishLoad)

  return {
    manualReload() {
      if (disposed || contents.isDestroyed()) return
      attempts = []
      gaveUp = false
      clearPending()
      needsResync = true
      try { options.reload() } catch (error) {
        options.log('error', `${options.label}: manual reload failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
    dispose() {
      disposed = true
      clearPending()
      clearUnresponsive()
      for (const [event, listener] of [
        ['render-process-gone', onGone], ['unresponsive', onUnresponsive], ['responsive', onResponsive],
        ['did-fail-load', onFailLoad], ['did-finish-load', onFinishLoad],
      ] as const) contents.off(event, listener as never)
    },
    state: () => ({ reloads: attempts.length, gaveUp }),
  }
}
