/** Public Agent Pets Plugin Host API, apiVersion 1. Successful calls return values directly. */
export type PluginErrorCode =
  | 'not_permitted' | 'rate_limited' | 'invalid_request' | 'too_large' | 'timeout'
  | 'host_not_allowed' | 'disabled' | 'queue_full' | 'duplicate' | 'not_found'
  | 'too_many_enabled' | 'host_unavailable' | 'too_many_redirects' | 'secret_unavailable'
  | 'secret_not_found' | 'settings_invalid' | 'schedule_invalid' | 'agent_status_unavailable' | 'denied'

export interface PluginCodedError extends Error {
  code: PluginErrorCode
}

export interface PluginFeedInput {
  title: string
  body: string
  link?: string
  icon?: string
  priority?: 'low' | 'normal'
  ttlMs?: number
  dedupeKey?: string
}

export interface PluginFeedResult {
  itemId: string
  delivery: 'bubble' | 'center'
}

export interface PluginLocalizedText {
  'zh-TW': string
  'en-US': string
}

export interface PluginPanelViewContribution {
  entry: string
  title: PluginLocalizedText
  preferredSize?: {
    width: number
    height: number
  }
}

export interface PluginCommandContribution {
  id: string
  title: PluginLocalizedText
}

export interface PluginSkinContribution {
  id: string
  displayName: PluginLocalizedText
  spritesheet: string
  kind: 'person' | 'animal'
  behaviorManifest?: Partial<Record<'walk' | 'sleep', { row: number; frames?: number; frameDurations?: number[] }>>
}

export type PluginEventSourceState = 'thinking' | 'tool-running' | 'idle' | 'done' | 'error'

export interface PluginEventSourceContribution {
  family: string
  displayName: PluginLocalizedText
}

export interface PluginEventSourceEvent {
  sessionId: string
  state: PluginEventSourceState
}

export interface PluginSettingDefinition {
  type: 'string' | 'number' | 'boolean'
  title?: PluginLocalizedText | string
  enum?: Array<string | number | boolean>
  maxLength?: number
  minimum?: number
  maximum?: number
  format?: 'secret'
  default?: string | number | boolean
}

export interface PluginSettingsSchema {
  type: 'object'
  properties: Record<string, PluginSettingDefinition>
}

export interface PluginContributions {
  feed?: boolean
  reaction?: boolean
  settings?: PluginSettingsSchema
  panelView?: PluginPanelViewContribution
  commands?: PluginCommandContribution[]
  tray?: { commands: string[] }
  badge?: boolean
  skins?: PluginSkinContribution[]
  eventSource?: PluginEventSourceContribution
}

export interface PetStatusChange {
  petId: string
  name: string
  agentFamily: 'codex' | 'claude-code' | 'opencode' | null
  previousState: string
  visibleState: string
  dnd: boolean
  at: number
}

export interface NetRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  headers?: Record<string, string>
  body?: string
}

export interface NetResponse {
  status: number
  headers: Partial<Record<'content-type' | 'etag' | 'last-modified' | 'retry-after', string>>
  body: string
  isBase64Encoded?: true
}

export interface PluginSettings {
  [key: string]: string | number | boolean
}

export type PluginJsonValue = string | number | boolean | null | PluginJsonValue[] | { [key: string]: PluginJsonValue }

export interface AgentPetsPluginApi {
  agent: {
    /**
     * Publish an observe-only status in this plugin's separate status list. Requires contributes.eventSource.
     * Only { sessionId, state } is accepted; session ids cannot be reused after terminal state. This never enters Agent events.
     * Rejects: invalid_request, rate_limited, not_permitted, disabled.
     * Example: `await api.agent.emit({ sessionId: 'build-1', state: 'thinking' })`
     */
    emit(event: PluginEventSourceEvent): Promise<{ accepted: true }>
  }
  feed: {
    /**
     * Show a feed item. Requires contributes.feed. The success value identifies the item and delivery path.
     * Rejects: invalid_request, host_not_allowed, rate_limited, queue_full, duplicate, disabled, not_permitted.
     * Example: `await api.feed.notify({ title: 'Build done', body: 'The build passed.' })`
     */
    notify(item: PluginFeedInput): Promise<PluginFeedResult>
  }
  badge: {
    /**
     * Set or clear the status badge beside this plugin's target pet. Requires contributes.badge.
     * Text is limited to six Unicode code points; updates are limited to once per second.
     * Rejects: invalid_request, rate_limited, disabled, not_permitted.
     * Example: `await api.badge.set({ text: 'OK', tone: 'info' }); await api.badge.set(null)`
     */
    set(badge: { text: string; tone?: 'neutral' | 'info' | 'warning' } | null): Promise<{ set: boolean }>
  }
  pet: {
    /**
     * Ask a pet for a short reaction. Requires contributes.reaction; unavailable during DND.
     * Rejects: invalid_request, rate_limited, queue_full, not_found, disabled, not_permitted.
     * Example: `await api.pet.react('happy', { ttlMs: 4000 })`
     */
    react(reaction: 'happy' | 'curious' | 'thinking' | 'surprised' | 'encouraging', options?: { petId?: string; ttlMs?: number }): Promise<{ accepted: true }>
    /**
     * Read the current sanitized Agent status snapshot. Requires permissions.agentStatus.
     * Rejects: not_permitted, agent_status_unavailable, disabled.
     * Example: `const pets = await api.pet.status()`
     */
    status(): Promise<PetStatusChange[]>
    /**
     * Subscribe to sanitized status changes. Requires permissions.agentStatus; changes are coalesced for one second per pet.
     * Throws coded errors immediately: not_permitted, invalid_request. Returns an unsubscribe function.
     * Example: `const off = api.pet.onStatusChange(change => api.log.info(change.visibleState))`
     */
    onStatusChange(callback: (change: PetStatusChange) => void): () => void
  }
  net: {
    /**
     * Make a bounded HTTPS request to a declared or user-approved public host. Requires permissions.network.
     * Rejects: invalid_request, host_not_allowed, too_many_redirects, timeout, too_large, rate_limited, disabled, not_permitted.
     * Example: `const response = await api.net.fetch('https://api.example.com/status')`
     */
    fetch(url: string, options?: NetRequestOptions): Promise<NetResponse>
    /**
     * Ask the user to add one public DNS host to the plugin's network grant. Requires network.userGranted.
     * Rejects: invalid_request, rate_limited, denied, host_not_allowed, disabled, not_permitted.
     * Example: `await api.net.requestHost('api.example.com', 'Read issue updates')`
     */
    requestHost(host: string, reason: string): Promise<{ granted: true; host: string }>
  }
  secrets: {
    /**
     * Read a secret declared in permissions.secrets and saved by the user in the plugin panel.
     * Rejects: not_permitted, secret_unavailable, secret_not_found, disabled.
     * Example: `const token = await api.secrets.get('githubToken')`
     */
    get(key: string): Promise<string>
  }
  settings: {
    /**
     * Read the user's non-secret settings; secret-format fields are omitted. Requires contributes.settings.
     * Rejects: not_permitted, settings_invalid, disabled.
     * Example: `const settings = await api.settings.get()`
     */
    get(): Promise<PluginSettings>
    /**
     * Subscribe to settings saved by the user in the plugin panel. Secret additions, updates, and clears also trigger
     * the callback, but the callback value contains only non-secret settings. Call api.secrets.get(key) to read a declared secret.
     * Returns an unsubscribe function. Throws coded error immediately: invalid_request.
     * Example: `api.settings.onChange(value => api.log.info(value.repository))`
     */
    onChange(callback: (settings: PluginSettings) => void): () => void
  }
  schedule: {
    /**
     * Run a callback periodically. Requires permissions.schedule. Effective interval is the greatest of the requested,
     * manifest, and user minimums. Throws coded errors immediately: not_permitted, schedule_invalid.
     * Example: `const cancel = api.schedule.every(300, refresh)`
     */
    every(seconds: number, callback: () => void): () => void
  }
  storage: {
    /**
     * Read one JSON-compatible value from this plugin's private storage. Requires permissions.storage.
     * Rejects: invalid_request, too_large, disabled, not_permitted. Example: `const result = await api.storage.get('etag')`
     */
    get(key: string): Promise<{ found: boolean; value: unknown }>
    /**
     * Save one JSON-compatible value in this plugin's private storage. Requires permissions.storage.
     * Rejects: invalid_request, too_large, disabled, not_permitted. Example: `await api.storage.set('etag', 'abc')`
     */
    set(key: string, value: unknown): Promise<{ stored: true }>
    /**
     * Remove one key from this plugin's private storage. Requires permissions.storage.
     * Rejects: invalid_request, disabled, not_permitted. Example: `await api.storage.remove('etag')`
     */
    remove(key: string): Promise<{ removed: boolean }>
  }
  log: {
    /**
     * Write a diagnostic entry visible in the plugin panel. Never log credentials or private user data.
     * Rejects: invalid_request, too_large, disabled. Example: `await api.log.info('Started')`
     */
    info(...values: unknown[]): Promise<{ logged: true }>
    /**
     * Write a warning visible in the plugin panel. Never log credentials or private user data.
     * Rejects: invalid_request, too_large, disabled. Example: `await api.log.warn('Retrying')`
     */
    warn(...values: unknown[]): Promise<{ logged: true }>
    /**
     * Write an error diagnostic visible in the plugin panel. Never log credentials or private user data.
     * Rejects: invalid_request, too_large, disabled. Example: `await api.log.error('Request failed')`
     */
    error(...values: unknown[]): Promise<{ logged: true }>
  }
  commands: {
    /**
     * Subscribe to declared commands triggered by the user from this plugin panel or Tray.
     * Throws invalid_request for an invalid callback. Plugins cannot invoke commands themselves.
     * Example: `const off = api.commands.onInvoke(id => api.log.info('Command', id))`
     */
    onInvoke(callback: (commandId: string) => void): () => void
  }
  ui: {
    /**
     * Send a JSON message to this plugin's open panel page. Requires contributes.panelView.
     * Messages are limited to 256 KB and 20 per second per plugin and direction. When the panel is closed,
     * the message is dropped and the successful result is `{ delivered: false }`.
     * Rejects: invalid_request, too_large, rate_limited, disabled. Example: `await api.ui.postMessage({ type: 'refresh' })`
     */
    postMessage(data: PluginJsonValue): Promise<{ delivered: boolean }>
    /**
     * Receive JSON messages sent by this plugin's open panel page. Returns an unsubscribe function.
     * Example: `const off = api.ui.onMessage(message => api.log.info(message.type))`
     */
    onMessage(callback: (data: PluginJsonValue) => void): () => void
  }
}

/** API exposed by `window.agentPetsPlugin` inside a contributed panel page. */
export interface AgentPetsPluginPanelApi {
  feed: { notify(item: PluginFeedInput): Promise<PluginFeedResult> }
  pet: { status(): Promise<PetStatusChange[]> }
  storage: {
    get(key: string): Promise<{ found: boolean; value: unknown }>
    set(key: string, value: unknown): Promise<{ stored: true }>
    remove(key: string): Promise<{ removed: boolean }>
  }
  settings: { get(): Promise<PluginSettings> }
  log: {
    info(...values: unknown[]): Promise<{ logged: true }>
    warn(...values: unknown[]): Promise<{ logged: true }>
    error(...values: unknown[]): Promise<{ logged: true }>
  }
  net: { fetch(url: string, options?: NetRequestOptions): Promise<NetResponse> }
  ui: {
    postMessage(data: PluginJsonValue): Promise<{ delivered: boolean }>
    onMessage(callback: (data: PluginJsonValue) => void): () => void
  }
}

declare global {
  /** The API passed to a plugin's `activate(api)` function. */
  type AgentPetsPlugin = AgentPetsPluginApi
  interface Window {
    /** The restricted API exposed inside the plugin's panelView page. */
    agentPetsPlugin: AgentPetsPluginPanelApi
  }
}
