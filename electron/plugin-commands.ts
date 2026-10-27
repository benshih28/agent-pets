import type { PluginErrorCode } from '../src/types/plugin.ts'

export interface PluginCommandContext {
  enabled: boolean
  pluginsEnabled: boolean
  commandIds: readonly string[]
}

export type PluginCommandResult = { ok: true; value: { accepted: true } } | { ok: false; error: PluginErrorCode }

export interface PluginCommandControllerOptions {
  getContext: (pluginId: string) => PluginCommandContext | null
  dispatch: (pluginId: string, commandId: string) => boolean
  now?: () => number
}

const PLUGIN_ID = /^(?!_host$|_shared$)[a-z0-9-]{3,48}$/
const COMMAND_ID = /^[a-z][a-z0-9-]{0,31}$/
const COMMAND_RATE_LIMIT_MS = 1_000

/** Accepts only user-originated command requests that match the current enabled manifest. */
export class PluginCommandController {
  private readonly getContext: PluginCommandControllerOptions['getContext']
  private readonly dispatch: PluginCommandControllerOptions['dispatch']
  private readonly now: () => number
  private readonly lastDispatchAt = new Map<string, number>()

  constructor(options: PluginCommandControllerOptions) {
    this.getContext = options.getContext
    this.dispatch = options.dispatch
    this.now = options.now ?? Date.now
  }

  invoke(pluginId: unknown, commandId: unknown): PluginCommandResult {
    if (typeof pluginId !== 'string' || !PLUGIN_ID.test(pluginId)
      || typeof commandId !== 'string' || !COMMAND_ID.test(commandId)) {
      return { ok: false, error: 'invalid_request' }
    }
    let context: PluginCommandContext | null = null
    try { context = this.getContext(pluginId) } catch {}
    if (!context || !context.pluginsEnabled || !context.enabled) return { ok: false, error: 'disabled' }
    if (!context.commandIds.includes(commandId)) return { ok: false, error: 'not_permitted' }
    let now: number
    try { now = this.now() } catch { return { ok: false, error: 'disabled' } }
    if (!Number.isSafeInteger(now) || now < 0) return { ok: false, error: 'disabled' }
    const key = `${pluginId}:${commandId}`
    const previous = this.lastDispatchAt.get(key)
    if (previous !== undefined && now - previous < COMMAND_RATE_LIMIT_MS) return { ok: false, error: 'rate_limited' }
    this.lastDispatchAt.set(key, now)
    let dispatched = false
    try { dispatched = this.dispatch(pluginId, commandId) } catch {}
    return dispatched ? { ok: true, value: { accepted: true } } : { ok: false, error: 'host_unavailable' }
  }
}
