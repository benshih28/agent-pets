export const PLUGIN_HOST_MAX_CONSECUTIVE_FAILURES = 3
export const PLUGIN_HOST_RESTART_BACKOFF_MS = [250, 1_000, 5_000] as const
export const PLUGIN_HOST_HEALTHY_RUNTIME_MS = 60_000

/** Small deterministic policy surface shared by Host startup retries and worker watchdogs. */
export class PluginHostFailureTracker {
  private readonly counts = new Map<string, number>()
  private readonly now: () => number

  constructor(now: () => number = Date.now) {
    this.now = now
  }

  record(pluginId: string): number {
    const count = (this.counts.get(pluginId) ?? 0) + 1
    this.counts.set(pluginId, count)
    return count
  }

  count(pluginId: string): number {
    return this.counts.get(pluginId) ?? 0
  }

  resetAfterHealthyRuntime(pluginId: string, startedAt: number, receivedPong: boolean): boolean {
    if (!receivedPong) return false
    let now: number
    try { now = this.now() } catch { return false }
    if (!Number.isSafeInteger(now) || now < startedAt || now - startedAt < PLUGIN_HOST_HEALTHY_RUNTIME_MS) return false
    return this.counts.delete(pluginId)
  }

  clear(pluginId?: string): void {
    if (pluginId === undefined) this.counts.clear()
    else this.counts.delete(pluginId)
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
