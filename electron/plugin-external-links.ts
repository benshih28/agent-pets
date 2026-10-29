import type { PluginErrorCode } from '../src/types/plugin.ts'
import { validatePluginNetUrl } from './plugin-net.ts'
import { SlidingWindowLimiter } from './sliding-window-limiter.ts'

export const PLUGIN_EXTERNAL_LINKS_PER_MINUTE = 5
export const PLUGIN_EXTERNAL_LINK_WINDOW_MS = 60_000

export interface PluginExternalLinkContext {
  enabled: boolean
  pluginsEnabled: boolean
  hosts: readonly string[]
}

export interface PluginExternalLinkControllerOptions {
  getContext: (pluginId: string) => PluginExternalLinkContext | null
  openExternal: (url: string) => Promise<void>
  now?: () => number
}

export type PluginExternalLinkResult =
  | { ok: true; value: { opened: true } }
  | { ok: false; error: PluginErrorCode }

/** Opens a manifest-approved HTTPS URL in the system browser after a trusted panel gesture. */
export class PluginExternalLinkController {
  private readonly options: PluginExternalLinkControllerOptions
  private readonly limiters = new Map<string, SlidingWindowLimiter>()

  constructor(options: PluginExternalLinkControllerOptions) {
    this.options = options
  }

  async open(pluginId: string, rawUrl: unknown, userActivated: unknown): Promise<PluginExternalLinkResult> {
    if (userActivated !== true) return { ok: false, error: 'denied' }
    const context = this.options.getContext(pluginId)
    if (!context?.pluginsEnabled || !context.enabled) return { ok: false, error: 'disabled' }
    if (context.hosts.length === 0) return { ok: false, error: 'not_permitted' }
    const url = validatePluginNetUrl(rawUrl, context.hosts)
    if (!url) return { ok: false, error: 'host_not_allowed' }

    const limiter = this.limiters.get(pluginId)
      ?? new SlidingWindowLimiter(PLUGIN_EXTERNAL_LINK_WINDOW_MS, PLUGIN_EXTERNAL_LINKS_PER_MINUTE)
    this.limiters.set(pluginId, limiter)
    if (!limiter.consume(this.options.now?.() ?? Date.now(), PLUGIN_EXTERNAL_LINKS_PER_MINUTE).allowed) {
      return { ok: false, error: 'rate_limited' }
    }

    try {
      await this.options.openExternal(url.href)
      return { ok: true, value: { opened: true } }
    } catch {
      return { ok: false, error: 'host_unavailable' }
    }
  }

  clearPlugin(pluginId: string): void {
    this.limiters.delete(pluginId)
  }

  clear(): void {
    this.limiters.clear()
  }
}
