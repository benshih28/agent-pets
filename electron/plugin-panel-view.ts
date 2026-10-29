import { createPluginPanelProtocolHandler, type PluginProtocolRequestLike } from './plugin-protocol.ts'
import type { PluginPanelApiMethod } from './plugin-panel-view-bridge.ts'
import type { PluginPanelViewClosedEvent, PluginPanelViewCloseReason } from '../src/types/plugin.ts'
import { isIpcErrorCode, PLUGIN_PANEL_IPC_ERROR_CODES } from '../src/types/ipc.ts'
import { dispatchPluginUiMessage, PLUGIN_UI_MESSAGE_MAX_BYTES, PluginUiMessageGuard } from './plugin-ui-messages.ts'
import { layoutPluginPanelView, type PluginPanelInsets, type PluginPanelSize } from './plugin-panel-window.ts'

export const PLUGIN_PANEL_PARTITION_PREFIX = 'plugin-ui-'
export const PLUGIN_PANEL_MESSAGE_MAX_BYTES = PLUGIN_UI_MESSAGE_MAX_BYTES

const PLUGIN_ID = /^(?!_host$|_shared$)[a-z0-9-]{3,48}$/
const UUID_TOKEN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const PANEL_ENTRY_METHODS = new Set<PluginPanelApiMethod>([
  'feed.notify', 'pet.status', 'storage.get', 'storage.set', 'storage.remove',
  'settings.get', 'log.info', 'log.warn', 'log.error', 'net.fetch', 'ui.postMessage',
  'links.openExternal',
])
const PANEL_ERROR_CODES: ReadonlySet<string> = new Set(PLUGIN_PANEL_IPC_ERROR_CODES)

export interface PluginPanelViewDescriptor {
  pluginId: string
  entry: string
  openToken: number
  bounds: { x: number; y: number; width: number; height: number }
}

export interface PluginPanelViewWebPreferences {
  preload: string
  sandbox: true
  contextIsolation: true
  nodeIntegration: false
  webviewTag: false
  webSecurity: true
  partition: string
  devTools: false
}

export interface PluginPanelViewCancelableEvent {
  preventDefault: () => void
}

export interface PluginPanelViewSession {
  protocol: {
    handle: (scheme: string, handler: (request: PluginProtocolRequestLike) => Response | Promise<Response>) => void | Promise<void>
  }
  webRequest: {
    onBeforeRequest: (
      filter: { urls: string[] },
      listener: (details: { url: string; method?: string }, callback: (decision: { cancel: boolean }) => void) => void,
    ) => void
  }
  setPermissionRequestHandler: (handler: (contents: unknown, permission: string, callback: (allowed: boolean) => void) => void) => void
  setPermissionCheckHandler: (handler: (...args: unknown[]) => boolean) => void
  on: (event: 'will-download', listener: (event: PluginPanelViewCancelableEvent) => void) => void
}

export interface PluginPanelViewWebContents {
  setWindowOpenHandler: (handler: () => { action: 'deny' }) => void
  on: (event: string, listener: (event?: PluginPanelViewCancelableEvent) => void) => void
  loadURL: (url: string) => Promise<void>
  send: (channel: string, ...args: unknown[]) => void
  destroy: () => void
  isDestroyed: () => boolean
}

export interface PluginPanelNativeView {
  webContents: PluginPanelViewWebContents
  setBounds: (bounds: { x: number; y: number; width: number; height: number }) => void
  setVisible: (visible: boolean) => void
}

export interface PluginPanelViewParent {
  isDestroyed: () => boolean
  isVisible: () => boolean
  addChildView: (view: PluginPanelNativeView) => void
  removeChildView: (view: PluginPanelNativeView) => void
}

export interface PluginPanelViewControllerOptions {
  preloadPath: string
  tokensCss: string
  getParentWindow: () => PluginPanelViewParent | null
  createSession: (partition: string) => PluginPanelViewSession
  createView: (options: { webPreferences: PluginPanelViewWebPreferences }) => PluginPanelNativeView
  createToken: (pluginId: string) => string
  revokeToken: (pluginId: string, token: string) => void
  pluginRootForToken: (token: string) => string | null
  messageGuard: PluginUiMessageGuard
  onApiRequest: (pluginId: string, request: { id: string; method: string; args: unknown[] }) => unknown | Promise<unknown>
  onClosed?: (event: PluginPanelViewClosedEvent) => void
  onBlockedRequest?: (url: string) => void
  ackTimeoutMs?: number
  loadTimeoutMs?: number
}

interface ActivePanelView {
  pluginId: string
  token: string
  parent: PluginPanelViewParent
  view: PluginPanelNativeView
  openToken: number
  attached: boolean
  acknowledged: boolean
  ackTimeout: ReturnType<typeof setTimeout> | null
  insets: PluginPanelInsets | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isPanelEntry(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512 || value.startsWith('/')
    || value.includes('\\') || value.includes(':')) return false
  const segments = value.split('/')
  return segments.every(segment => segment.length > 0 && segment !== '.' && segment !== '..')
    && value.toLowerCase().endsWith('.html')
}

function safePanelUrl(urlValue: string, token: string | null): boolean {
  if (!token || !UUID_TOKEN.test(token)) return false
  try {
    const url = new URL(urlValue)
    if (url.protocol !== 'agent-pets:' || url.hostname !== 'plugin' || url.username || url.password || url.port
      || url.search || url.hash || !url.pathname.startsWith('/')) return false
    const decodedSegments: string[] = []
    for (const segment of url.pathname.slice(1).split('/')) {
      let decoded: string
      try { decoded = decodeURIComponent(segment) } catch { return false }
      if (!decoded || decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\') || decoded.includes('%')) return false
      decodedSegments.push(decoded)
    }
    if (decodedSegments[0] === '_shared') return decodedSegments.length === 2 && decodedSegments[1] === 'tokens.css'
    return decodedSegments[0] === token && decodedSegments.length >= 2
  } catch {
    return false
  }
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

function errorResult(error: string): { ok: false; error: string } {
  return { ok: false, error: isIpcErrorCode(error) && PANEL_ERROR_CODES.has(error) ? error : 'invalid_request' }
}

export function isPluginPanelResourceAllowed(url: string, token: string | null, method = 'GET'): boolean {
  return method === 'GET' && safePanelUrl(url, token)
}

export class PluginPanelViewController {
  private readonly options: PluginPanelViewControllerOptions
  private readonly configuredPartitions = new Set<string>()
  private readonly activeTokens = new Map<string, string>()
  private active: ActivePanelView | null = null
  private lastOpenToken = 0
  private requestSequence = 0

  constructor(options: PluginPanelViewControllerOptions) {
    this.options = options
  }

  async open(descriptor: PluginPanelViewDescriptor): Promise<{ ok: true; value: { opened: true; openToken: number } } | { ok: false; error: string }> {
    if (!isRecord(descriptor) || typeof descriptor.pluginId !== 'string' || !PLUGIN_ID.test(descriptor.pluginId)
      || !isPanelEntry(descriptor.entry) || !Number.isSafeInteger(descriptor.openToken)
      || (descriptor.openToken as number) <= this.lastOpenToken || !isValidBounds(descriptor.bounds)) return errorResult('invalid_request')
    const parent = this.options.getParentWindow()
    if (!parent || parent.isDestroyed()) return errorResult('disabled')
    if (!parent.isVisible()) return errorResult('panel_unavailable')
    const openToken = descriptor.openToken as number
    this.lastOpenToken = openToken
    this.close('replaced')

    const pluginId = descriptor.pluginId
    let token: string
    try { token = this.options.createToken(pluginId) } catch { return errorResult('disabled') }
    if (!UUID_TOKEN.test(token)) {
      try { this.options.revokeToken(pluginId, token) } catch {}
      return errorResult('disabled')
    }

    const partition = `${PLUGIN_PANEL_PARTITION_PREFIX}${pluginId}`
    let view: PluginPanelNativeView | null = null
    try {
      const pluginSession = this.options.createSession(partition)
      this.configureSession(pluginId, pluginSession)
      this.activeTokens.set(pluginId, token)
      view = this.options.createView({
        webPreferences: {
          preload: this.options.preloadPath,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webviewTag: false,
          webSecurity: true,
          partition,
          devTools: false,
        },
      })
      const active: ActivePanelView = {
        pluginId, token, parent, view, openToken, attached: false, acknowledged: false, ackTimeout: null, insets: null,
      }
      this.active = active
      view.setBounds(descriptor.bounds)
      view.setVisible(false)
      parent.addChildView(view)
      active.attached = true
      this.configureWebContents(active)
      // 宿主要等 open() 回傳後才會送 bounds，所以載入期間另外計時；
      // 載入完成才開始等握手，避免主程序忙碌時把正常載入的面板誤關。
      this.armAckTimeout(active, this.options.loadTimeoutMs ?? 15_000)
      const entry = descriptor.entry.split('/').map(segment => encodeURIComponent(segment)).join('/')
      await view.webContents.loadURL(`agent-pets://plugin/${token}/${entry}`)
      if (this.active !== active) return errorResult('disabled')
      if (!active.acknowledged) this.armAckTimeout(active, this.options.ackTimeoutMs ?? 2_000)
      return { ok: true, value: { opened: true, openToken } }
    } catch {
      const active = this.active
      if (active?.view === view) {
        this.close('load_failed', openToken)
        return errorResult('panel_load_failed')
      }
      if (view && !view.webContents.isDestroyed()) {
        try { view.webContents.destroy() } catch {}
      }
      try { this.options.revokeToken(pluginId, token) } catch {}
      return errorResult('disabled')
    }
  }

  close(reason: PluginPanelViewCloseReason = 'closed', openToken?: number): void {
    const active = this.active
    if (!active || (openToken !== undefined && active.openToken !== openToken)) return
    this.active = null
    if (active.ackTimeout) clearTimeout(active.ackTimeout)
    active.ackTimeout = null
    this.activeTokens.delete(active.pluginId)
    try { this.options.revokeToken(active.pluginId, active.token) } catch {}
    try { active.view.setVisible(false) } catch {}
    if (active.attached) {
      try { active.parent.removeChildView(active.view) } catch {}
      active.attached = false
    }
    try {
      if (!active.view.webContents.isDestroyed()) active.view.webContents.destroy()
    } catch {}
    try { this.options.onClosed?.({ pluginId: active.pluginId, openToken: active.openToken, reason }) } catch {}
  }

  setBounds(openToken: number, bounds: { x: number; y: number; width: number; height: number }): boolean {
    const active = this.active
    if (!active || active.openToken !== openToken || !isValidBounds(bounds)) return false
    if (active.parent.isDestroyed() || !active.parent.isVisible()) {
      this.close('renderer_unavailable', openToken)
      return false
    }
    active.view.setBounds({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    })
    if (!active.acknowledged) {
      active.acknowledged = true
      if (active.ackTimeout) clearTimeout(active.ackTimeout)
      active.ackTimeout = null
    }
    active.view.setVisible(true)
    return true
  }

  setLayout(openToken: number, insets: PluginPanelInsets, windowSize: PluginPanelSize): boolean {
    const active = this.active
    if (!active || active.openToken !== openToken) return false
    active.insets = insets
    return this.applyLayout(active, windowSize)
  }

  relayout(windowSize: PluginPanelSize): void {
    const active = this.active
    if (active?.insets) this.applyLayout(active, windowSize)
  }

  // 尺寸暫時不合法（例如視窗縮到比邊距還小）只隱藏內容、保留插件狀態；
  // 真正無法顯示時交給 ack timeout 與視窗隱藏事件關閉。
  private applyLayout(active: ActivePanelView, windowSize: PluginPanelSize): boolean {
    const bounds = active.insets ? layoutPluginPanelView(active.insets, windowSize) : null
    if (!bounds) {
      try { active.view.setVisible(false) } catch {}
      return false
    }
    return this.setBounds(active.openToken, bounds)
  }

  onPanelWindowHidden(): void {
    this.close('hidden')
  }

  onPanelRendererReload(): void {
    this.close('renderer_unavailable')
  }

  closeIfNotAllowed(isAllowed: (pluginId: string) => boolean): void {
    if (this.active && !isAllowed(this.active.pluginId)) this.close('disabled')
  }

  closeForPlugin(pluginId: string): void {
    if (this.active?.pluginId === pluginId) this.close('disabled')
  }

  canOpenToken(openToken: number): boolean {
    return Number.isSafeInteger(openToken) && openToken > this.lastOpenToken
  }

  postMessage(pluginId: string, data: unknown): { ok: true; value: { delivered: boolean } } | { ok: false; error: string } {
    const active = this.active
    const available = Boolean(active && active.pluginId === pluginId && !active.view.webContents.isDestroyed())
    return dispatchPluginUiMessage({
      pluginId,
      direction: 'worker-to-panel',
      value: data,
      guard: this.options.messageGuard,
      targetAvailable: available,
      deliver: value => active!.view.webContents.send('plugin-panel-ui-message', value),
    })
  }

  activePluginId(): string | null {
    return this.active?.pluginId ?? null
  }

  async handleApiRequest(sender: unknown, method: unknown, args: unknown): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
    const active = this.active
    if (!active || active.view.webContents !== sender || active.view.webContents.isDestroyed()) return errorResult('not_permitted')
    if (typeof method !== 'string' || !PANEL_ENTRY_METHODS.has(method as PluginPanelApiMethod)
      || !Array.isArray(args) || args.length > 32 || !isJsonValue(args)) return errorResult('not_permitted')
    if (method === 'ui.postMessage' && args.length !== 1) return errorResult('invalid_request')
    if (method === 'links.openExternal' && args.length !== 2) return errorResult('invalid_request')
    let serialized: string
    try { serialized = JSON.stringify(method === 'ui.postMessage' ? args[0] : args) } catch { return errorResult('invalid_request') }
    if (Buffer.byteLength(serialized, 'utf8') > PLUGIN_PANEL_MESSAGE_MAX_BYTES) return errorResult('too_large')
    const id = `panel-${++this.requestSequence}`
    try {
      const response = await this.options.onApiRequest(active.pluginId, { id, method, args })
      if (!isRecord(response) || typeof response.ok !== 'boolean') return errorResult('invalid_request')
      if (!response.ok) return errorResult(typeof response.error === 'string' ? response.error : 'invalid_request')
      return { ok: true, value: response.value }
    } catch {
      return errorResult('disabled')
    }
  }

  private armAckTimeout(active: ActivePanelView, timeoutMs: number): void {
    if (active.ackTimeout) clearTimeout(active.ackTimeout)
    active.ackTimeout = setTimeout(() => {
      if (this.active === active && !active.acknowledged) this.close('renderer_unavailable', active.openToken)
    }, timeoutMs)
  }

  private configureSession(pluginId: string, pluginSession: PluginPanelViewSession): void {
    if (this.configuredPartitions.has(pluginId)) return
    const protocolHandler = createPluginPanelProtocolHandler({
      pluginRootForToken: this.options.pluginRootForToken,
      tokensCss: this.options.tokensCss,
    })
    const protocolResult = pluginSession.protocol.handle('agent-pets', request => protocolHandler(request))
    if (protocolResult && typeof (protocolResult as Promise<void>).catch === 'function') {
      void (protocolResult as Promise<void>).catch(() => {})
    }
    pluginSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    pluginSession.setPermissionCheckHandler(() => false)
    pluginSession.on('will-download', event => event.preventDefault())
    pluginSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      const blocked = !isPluginPanelResourceAllowed(details.url, this.activeTokens.get(pluginId) ?? null, details.method ?? 'GET')
      if (blocked) {
        try { this.options.onBlockedRequest?.(details.url) } catch {}
      }
      callback({ cancel: blocked })
    })
    this.configuredPartitions.add(pluginId)
  }

  private configureWebContents(active: ActivePanelView): void {
    const contents = active.view.webContents
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    for (const eventName of ['will-navigate', 'will-redirect', 'will-attach-webview'] as const) {
      contents.on(eventName, event => event?.preventDefault())
    }
    contents.on('render-process-gone', () => {
      if (this.active === active) this.close('renderer_crashed', active.openToken)
    })
    contents.on('destroyed', () => {
      if (this.active === active) this.close('destroyed', active.openToken)
    })
  }
}

function isValidBounds(value: unknown): value is { x: number; y: number; width: number; height: number } {
  if (!isRecord(value)) return false
  const { x, y, width, height } = value
  if (typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number' || typeof height !== 'number'
    || ![x, y, width, height].every(Number.isFinite)) return false
  return width >= 1 && height >= 1 && width <= 4_000 && height <= 4_000
}
