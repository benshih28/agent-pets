import type { PluginBadgeTone, PluginBadgeView, PluginErrorCode } from '../src/types/plugin.ts'
import { normalizePresentationMessage } from './presentation-controller.ts'
import { PLUGIN_BADGE_MAX_CODE_POINTS } from '../src/utils/plugin-badges.ts'

export const PLUGIN_BADGE_RATE_LIMIT_MS = 1_000
export const PLUGIN_BADGE_MAX_PER_PET = 2

export type PluginBadgeValue = PluginBadgeView

export interface PluginBadgeContext {
  enabled: boolean
  pluginsEnabled: boolean
  contributesBadge: boolean
  pluginName: PluginBadgeView['pluginName']
  targetPetId: string | null
}

export interface PluginBadgeControllerOptions {
  getContext: (pluginId: string) => PluginBadgeContext | null
  onChanged?: (badges: PluginBadgeValue[]) => void
  now?: () => number
}

export type PluginBadgeSetResult =
  | { ok: true; value: { set: boolean } }
  | { ok: false; error: PluginErrorCode }

const PLUGIN_ID = /^(?!_host$|_shared$)[a-z0-9-]{3,48}$/
const VALID_TONES = new Set<PluginBadgeTone>(['neutral', 'info', 'warning'])

function normalizeBadge(value: unknown): { text: string; tone: PluginBadgeTone } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (Object.keys(record).some(key => key !== 'text' && key !== 'tone')) return null
  const text = normalizePresentationMessage(record.text)
  if (!text || Array.from(text).length > PLUGIN_BADGE_MAX_CODE_POINTS) return null
  const tone = record.tone === undefined ? 'neutral' : record.tone
  if (typeof tone !== 'string' || !VALID_TONES.has(tone as PluginBadgeTone)) return null
  return { text, tone: tone as PluginBadgeTone }
}

/** Holds one bounded, host-sanitized status badge per enabled plugin. */
export class PluginBadgeController {
  private readonly getContext: PluginBadgeControllerOptions['getContext']
  private readonly onChanged: NonNullable<PluginBadgeControllerOptions['onChanged']>
  private readonly now: () => number
  private readonly badges = new Map<string, PluginBadgeValue>()
  private readonly lastUpdateAt = new Map<string, number>()

  constructor(options: PluginBadgeControllerOptions) {
    this.getContext = options.getContext
    this.onChanged = options.onChanged ?? (() => {})
    this.now = options.now ?? Date.now
  }

  set(pluginId: string, rawBadge: unknown): PluginBadgeSetResult {
    if (!PLUGIN_ID.test(pluginId)) return { ok: false, error: 'invalid_request' }
    let context: PluginBadgeContext | null = null
    try { context = this.getContext(pluginId) } catch {}
    if (!context || !context.pluginsEnabled || !context.enabled) return { ok: false, error: 'disabled' }
    if (!context.contributesBadge) return { ok: false, error: 'not_permitted' }
    const badge = rawBadge === null ? null : normalizeBadge(rawBadge)
    if (rawBadge !== null && !badge) return { ok: false, error: 'invalid_request' }
    let now: number
    try { now = this.now() } catch { return { ok: false, error: 'disabled' } }
    if (!Number.isSafeInteger(now) || now < 0) return { ok: false, error: 'disabled' }
    const previous = this.lastUpdateAt.get(pluginId)
    if (previous !== undefined && now - previous < PLUGIN_BADGE_RATE_LIMIT_MS) {
      return { ok: false, error: 'rate_limited' }
    }
    this.lastUpdateAt.set(pluginId, now)
    if (badge) {
      this.badges.set(pluginId, {
        pluginId,
        pluginName: { ...context.pluginName },
        targetPetId: context.targetPetId,
        ...badge,
        updatedAt: now,
      })
    } else {
      this.badges.delete(pluginId)
    }
    this.publish()
    return { ok: true, value: { set: Boolean(badge) } }
  }

  /** Remove stale plugin state without consuming the plugin's set rate limit. */
  syncEnabledPlugins(): void {
    let changed = false
    const trackedPluginIds = new Set([...this.badges.keys(), ...this.lastUpdateAt.keys()])
    for (const pluginId of trackedPluginIds) {
      let context: PluginBadgeContext | null = null
      try { context = this.getContext(pluginId) } catch {}
      if (!context?.enabled || !context.pluginsEnabled || !context.contributesBadge) {
        changed = this.badges.delete(pluginId) || changed
        this.lastUpdateAt.delete(pluginId)
        continue
      }
      const current = this.badges.get(pluginId)
      if (current && (current.targetPetId !== context.targetPetId
        || current.pluginName['zh-TW'] !== context.pluginName['zh-TW']
        || current.pluginName['en-US'] !== context.pluginName['en-US'])) {
        this.badges.set(pluginId, {
          ...current,
          pluginName: { ...context.pluginName },
          targetPetId: context.targetPetId,
        })
        changed = true
      }
    }
    if (changed) this.publish()
  }

  clearPlugin(pluginId: string): void {
    const changed = this.badges.delete(pluginId)
    this.lastUpdateAt.delete(pluginId)
    if (changed) this.publish()
  }

  clearAll(): void {
    if (this.badges.size === 0) return
    this.badges.clear()
    this.lastUpdateAt.clear()
    this.publish()
  }

  list(): PluginBadgeValue[] {
    return [...this.badges.values()].map(badge => ({ ...badge, pluginName: { ...badge.pluginName } }))
  }

  private publish(): void {
    try { this.onChanged(this.list()) } catch {}
  }
}
