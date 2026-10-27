import { SlidingWindowLimiter } from './sliding-window-limiter.ts'

export const PLUGIN_UI_MESSAGE_MAX_BYTES = 256 * 1024
export const PLUGIN_UI_MESSAGE_LIMIT_PER_SECOND = 20

export type PluginUiMessageDirection = 'panel-to-worker' | 'worker-to-panel'
export type PluginUiMessageError = 'invalid_request' | 'too_large' | 'rate_limited'
export type PluginUiMessageResult =
  | { ok: true; value: { delivered: boolean } }
  | { ok: false; error: PluginUiMessageError | 'disabled' }

export interface PluginUiMessageDispatchOptions {
  pluginId: string
  direction: PluginUiMessageDirection
  value: unknown
  guard: PluginUiMessageGuard
  targetAvailable: boolean
  deliver: (value: unknown) => void
}

function isJsonValue(value: unknown, depth = 0, seen = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object' || depth > 32 || seen.has(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) return false
  seen.add(value)
  const values = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>)
  const valid = values.length <= 50_000 && values.every(item => isJsonValue(item, depth + 1, seen))
  seen.delete(value)
  return valid
}

export class PluginUiMessageGuard {
  private readonly now: () => number
  private readonly sentAt = new Map<string, SlidingWindowLimiter>()

  constructor(now: () => number = Date.now) {
    this.now = now
  }

  consume(pluginId: string, direction: PluginUiMessageDirection, value: unknown): PluginUiMessageError | null {
    if (!/^(?!_host$|_shared$)[a-z0-9-]{3,48}$/.test(pluginId) || !isJsonValue(value)) return 'invalid_request'
    let serialized: string
    try { serialized = JSON.stringify(value) } catch { return 'invalid_request' }
    if (Buffer.byteLength(serialized, 'utf8') > PLUGIN_UI_MESSAGE_MAX_BYTES) return 'too_large'
    const now = this.now()
    if (!Number.isSafeInteger(now) || now < 0) return 'invalid_request'
    const key = `${pluginId}:${direction}`
    let limiter = this.sentAt.get(key)
    if (!limiter) {
      limiter = new SlidingWindowLimiter(1_000, PLUGIN_UI_MESSAGE_LIMIT_PER_SECOND)
      this.sentAt.set(key, limiter)
    }
    return limiter.consume(now, PLUGIN_UI_MESSAGE_LIMIT_PER_SECOND).allowed ? null : 'rate_limited'
  }
}

export function dispatchPluginUiMessage(options: PluginUiMessageDispatchOptions): PluginUiMessageResult {
  if (!options.targetAvailable) {
    return options.direction === 'worker-to-panel'
      ? { ok: true, value: { delivered: false } }
      : { ok: false, error: 'disabled' }
  }
  const error = options.guard.consume(options.pluginId, options.direction, options.value)
  if (error) return { ok: false, error }
  try {
    options.deliver(options.value)
    return { ok: true, value: { delivered: true } }
  } catch {
    return { ok: false, error: 'disabled' }
  }
}
