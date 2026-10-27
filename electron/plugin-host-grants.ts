import { isIP } from 'node:net'
import { isValidPluginNetworkHost } from './plugin-manifest.ts'
import { SlidingWindowLimiter } from './sliding-window-limiter.ts'

export const PLUGIN_HOST_REQUEST_LIMIT = 3
export const PLUGIN_HOST_REQUEST_WINDOW_MS = 10 * 60 * 1_000
export const PLUGIN_HOST_DENIAL_COOLDOWN_MS = 24 * 60 * 60 * 1_000

export type PluginHostGrantDecision =
  | { ok: true; host: string; alreadyGranted: boolean }
  | { ok: false; error: 'invalid_request' | 'rate_limited' | 'denied' }

interface PluginHostGrantOptions {
  now?: () => number
}

function normalizeReason(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.normalize('NFKC').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim()
  return normalized.length > 0 && normalized.length <= 120 ? normalized : null
}

export function normalizePluginHostRequest(value: unknown): string | null {
  if (typeof value !== 'string' || value !== value.trim() || value.length > 253
    || !isValidPluginNetworkHost(value, false) || isIP(value) !== 0) return null
  const hostname = new URL(`https://${value}`).hostname.toLowerCase()
  if (hostname !== value.toLowerCase() || hostname.split('.').length < 2) return null
  return hostname
}

export class PluginHostGrantController {
  private readonly now: () => number
  private readonly attempts = new Map<string, SlidingWindowLimiter>()
  private readonly deniedUntil = new Map<string, number>()
  private readonly pending = new Set<string>()

  constructor(options: PluginHostGrantOptions = {}) {
    this.now = options.now ?? Date.now
  }

  begin(pluginId: string, rawHost: unknown, rawReason: unknown, grantedHosts: readonly string[]): PluginHostGrantDecision {
    const host = normalizePluginHostRequest(rawHost)
    if (!/^(?!_host$|_shared$)[a-z0-9-]{3,48}$/.test(pluginId) || !host || !normalizeReason(rawReason)) {
      return { ok: false, error: 'invalid_request' }
    }
    if (grantedHosts.some(item => item.toLowerCase() === host)) return { ok: true, host, alreadyGranted: true }
    const now = this.safeNow()
    if (now === null) return { ok: false, error: 'invalid_request' }
    const key = `${pluginId}\u0000${host}`
    const denied = this.deniedUntil.get(key)
    if (denied !== undefined && denied > now) return { ok: false, error: 'denied' }
    this.deniedUntil.delete(key)
    if (this.pending.has(key)) return { ok: false, error: 'rate_limited' }
    let attempts = this.attempts.get(pluginId)
    if (!attempts) {
      attempts = new SlidingWindowLimiter(PLUGIN_HOST_REQUEST_WINDOW_MS, PLUGIN_HOST_REQUEST_LIMIT)
      this.attempts.set(pluginId, attempts)
    }
    if (!attempts.consume(now, PLUGIN_HOST_REQUEST_LIMIT).allowed) return { ok: false, error: 'rate_limited' }
    this.pending.add(key)
    return { ok: true, host, alreadyGranted: false }
  }

  finish(pluginId: string, host: string, granted: boolean): void {
    const key = `${pluginId}\u0000${host}`
    this.pending.delete(key)
    if (!granted) {
      const now = this.safeNow()
      if (now !== null) this.deniedUntil.set(key, now + PLUGIN_HOST_DENIAL_COOLDOWN_MS)
    }
  }

  clearPlugin(pluginId: string): void {
    this.attempts.delete(pluginId)
    for (const key of this.deniedUntil.keys()) {
      if (key.startsWith(`${pluginId}\u0000`)) this.deniedUntil.delete(key)
    }
    for (const key of this.pending) {
      if (key.startsWith(`${pluginId}\u0000`)) this.pending.delete(key)
    }
  }

  private safeNow(): number | null {
    try {
      const value = this.now()
      return Number.isSafeInteger(value) && value >= 0 ? value : null
    } catch {
      return null
    }
  }
}

export function sanitizePluginHostRequestReason(value: unknown): string | null {
  return normalizeReason(value)
}
