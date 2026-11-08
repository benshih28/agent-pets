export const PLUGIN_HOST_MAX_CONSECUTIVE_FAILURES = 3
export const PLUGIN_HOST_RESTART_BACKOFF_MS = [250, 1_000, 5_000] as const
export const PLUGIN_HOST_HEALTHY_RUNTIME_MS = 60_000
/** Failures older than this no longer count towards giving up on a plugin. */
export const PLUGIN_HOST_FAILURE_DECAY_MS = 10 * 60_000

/** Small deterministic policy surface shared by Host startup retries and worker watchdogs. */
export class PluginHostFailureTracker {
  private readonly failures = new Map<string, number[]>()
  private readonly now: () => number

  constructor(now: () => number = Date.now) {
    this.now = now
  }

  private safeNow(): number {
    try {
      const value = this.now()
      return Number.isFinite(value) ? value : 0
    } catch { return 0 }
  }

  private recent(pluginId: string): number[] {
    const current = this.safeNow()
    // A clock that moved backwards (sleep/NTP) must not keep stale failures alive forever.
    const list = (this.failures.get(pluginId) ?? []).filter(at => at <= current && current - at < PLUGIN_HOST_FAILURE_DECAY_MS)
    if (list.length === 0) this.failures.delete(pluginId)
    else this.failures.set(pluginId, list)
    return list
  }

  record(pluginId: string): number {
    const list = this.recent(pluginId)
    list.push(this.safeNow())
    this.failures.set(pluginId, list)
    return list.length
  }

  count(pluginId: string): number {
    return this.recent(pluginId).length
  }

  resetAfterHealthyRuntime(pluginId: string, startedAt: number, receivedPong: boolean): boolean {
    if (!receivedPong) return false
    let now: number
    try { now = this.now() } catch { return false }
    if (!Number.isSafeInteger(now) || now < startedAt || now - startedAt < PLUGIN_HOST_HEALTHY_RUNTIME_MS) return false
    return this.failures.delete(pluginId)
  }

  clear(pluginId?: string): void {
    if (pluginId === undefined) this.failures.clear()
    else this.failures.delete(pluginId)
  }
}

export function pluginHostRetryDelay(consecutiveFailures: number): number {
  const index = Math.min(Math.max(consecutiveFailures - 1, 0), PLUGIN_HOST_RESTART_BACKOFF_MS.length - 1)
  return PLUGIN_HOST_RESTART_BACKOFF_MS[index] ?? PLUGIN_HOST_RESTART_BACKOFF_MS[0]
}

export function shouldRetryPluginHost(consecutiveFailures: number): boolean {
  return Number.isSafeInteger(consecutiveFailures) && consecutiveFailures > 0
    && consecutiveFailures < PLUGIN_HOST_MAX_CONSECUTIVE_FAILURES
}
