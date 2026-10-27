import { app, BrowserWindow, MessageChannelMain, session } from 'electron'
import type { MessagePortMain } from 'electron'
import { createPluginHostProtocolHandler } from './plugin-protocol.ts'
import { pluginHostAssets } from './plugin-host-assets.ts'
import { PluginHostFailureTracker, pluginHostRetryDelay, shouldRetryPluginHost } from './plugin-host-recovery.ts'
import { dispatchPluginUiMessage, PluginUiMessageGuard, type PluginUiMessageResult } from './plugin-ui-messages.ts'
import { join } from 'node:path'
import { isCurrentPluginRuntimeToken, runPluginRpcForCurrentToken } from './plugin-host-token.ts'

export interface PluginHostDescriptor {
  id: string
  entry: string
  revision?: string
  scheduleEnabled?: boolean
  scheduleMinIntervalSec?: number
  agentStatusEnabled?: boolean
  commandIds?: string[]
}

export interface PluginHostControllerOptions {
  onRpc: (pluginId: string, request: unknown, runtimeToken?: string) => Promise<unknown> | unknown
  onPluginCrash: (pluginId: string, consecutiveCrashes: number, reason: 'host' | 'worker') => void
  onPluginReset?: (pluginId: string) => void
  getMemoryBudgetMb: (activePluginCount: number) => number
  createPluginToken: (pluginId: string) => string
  revokePluginToken: (pluginId: string, token: string) => void
  pluginRootForToken: (token: string) => string | null
  messageGuard: PluginUiMessageGuard
  now?: () => number
}

interface PluginHostRuntime {
  descriptor: PluginHostDescriptor
  lastPongAt: number
  startedAt: number
  token: string
  receivedPong: boolean
  ready: boolean
}

const PLUGIN_SCHEME_PREFIX = 'agent-pets://plugin/'
const PING_INTERVAL_MS = 10_000
const PONG_TIMEOUT_MS = 30_000
const MEMORY_POLL_INTERVAL_MS = 30_000
const PLUGIN_ID = /^(?!_host$|_shared$)[a-z0-9-]{3,48}$/
const PLUGIN_ENTRY = /^(?!\/)(?!.*(?:^|\/)\.\.?\/)[^\\:]+\.js$/
const configuredPluginSessions = new WeakSet<object>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export class PluginHostWindowController {
  private readonly onRpc: PluginHostControllerOptions['onRpc']
  private readonly onPluginCrash: PluginHostControllerOptions['onPluginCrash']
  private readonly onPluginReset: NonNullable<PluginHostControllerOptions['onPluginReset']>
  private readonly getMemoryBudgetMb: PluginHostControllerOptions['getMemoryBudgetMb']
  private readonly createPluginToken: PluginHostControllerOptions['createPluginToken']
  private readonly revokePluginToken: PluginHostControllerOptions['revokePluginToken']
  private readonly pluginRootForToken: PluginHostControllerOptions['pluginRootForToken']
  private readonly messageGuard: PluginHostControllerOptions['messageGuard']
  private readonly now: () => number
  private readonly desired = new Map<string, PluginHostDescriptor>()
  private readonly runtime = new Map<string, PluginHostRuntime>()
  private readonly failureTracker: PluginHostFailureTracker
  private hostWindow: BrowserWindow | null = null
  private hostPort: MessagePortMain | null = null
  private portReady = false
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private memoryTimer: ReturnType<typeof setInterval> | null = null
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private closingIntentionally = false

  constructor(options: PluginHostControllerOptions) {
    this.onRpc = options.onRpc
    this.onPluginCrash = options.onPluginCrash
    this.onPluginReset = options.onPluginReset ?? (() => {})
    this.getMemoryBudgetMb = options.getMemoryBudgetMb
    this.createPluginToken = options.createPluginToken
    this.revokePluginToken = options.revokePluginToken
    this.pluginRootForToken = options.pluginRootForToken
    this.messageGuard = options.messageGuard
    this.now = options.now ?? Date.now
    this.failureTracker = new PluginHostFailureTracker(this.now)
  }

  sync(enabledPlugins: readonly PluginHostDescriptor[]): void {
    const next = new Map<string, PluginHostDescriptor>()
    for (const plugin of enabledPlugins) {
      if (!isValidDescriptor(plugin)) continue
      next.set(plugin.id, { ...plugin })
    }
    this.desired.clear()
    for (const [id, descriptor] of next) this.desired.set(id, descriptor)

    if (this.desired.size === 0) {
      this.closeHost()
      return
    }
    if (!this.hostWindow || this.hostWindow.isDestroyed()) {
      this.createHost()
      return
    }
    if (this.portReady) this.syncWorkers()
  }

  notifySettingsChanged(pluginId: string, value: Record<string, unknown>): void {
    if (!this.desired.has(pluginId) || !isRecord(value)) return
    this.post({ type: 'settings-changed', pluginId, value })
  }

  invokeCommand(pluginId: string, commandId: string): boolean {
    const runtime = this.runtime.get(pluginId)
    const descriptor = this.desired.get(pluginId)
    if (!this.portReady || !this.hostPort || !runtime?.ready || !descriptor?.commandIds?.includes(commandId)) return false
    this.post({ type: 'invoke-command', pluginId, commandId })
    return true
  }

  notifyStatusChanged(pluginId: string, value: readonly unknown[]): void {
    if (!this.desired.has(pluginId) || !Array.isArray(value)) return
    this.post({ type: 'status-changed', pluginId, value })
  }

  postUiMessageToWorker(pluginId: string, value: unknown): PluginUiMessageResult {
    const hostPort = this.hostPort
    const available = this.portReady && Boolean(hostPort) && this.desired.has(pluginId) && this.runtime.has(pluginId)
    return dispatchPluginUiMessage({
      pluginId,
      direction: 'panel-to-worker',
      value,
      guard: this.messageGuard,
      targetAvailable: available,
      deliver: message => hostPort!.postMessage({ type: 'ui-message', pluginId, value: message }),
    })
  }

  close(): void {
    this.desired.clear()
    this.closeHost()
  }

  private createHost(): void {
    const pluginSession = session.fromPartition('plugin-host')
    if (!configuredPluginSessions.has(pluginSession)) {
      const handlePluginRequest = createPluginHostProtocolHandler({
        pluginRootForToken: this.pluginRootForToken,
        hostAssets: pluginHostAssets,
      })
      pluginSession.protocol.handle('agent-pets', request => handlePluginRequest(request))
      configuredPluginSessions.add(pluginSession)
    }
    pluginSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
    pluginSession.setPermissionCheckHandler(() => false)
    pluginSession.on('will-download', event => event.preventDefault())
    pluginSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      callback({ cancel: !details.url.startsWith(PLUGIN_SCHEME_PREFIX) })
    })

    const window = new BrowserWindow({
      show: false,
      width: 1,
      height: 1,
      frame: false,
      transparent: true,
      skipTaskbar: true,
      webPreferences: {
        preload: join(__dirname, 'plugin-host-preload.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
        webSecurity: true,
        partition: 'plugin-host',
        devTools: !app.isPackaged,
      },
    })
    this.hostWindow = window
    this.closingIntentionally = false
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => event.preventDefault())
    window.webContents.on('will-redirect', event => event.preventDefault())
    window.webContents.on('will-attach-webview', event => event.preventDefault())
    window.webContents.once('did-finish-load', () => this.attachHostPort(window))
    window.webContents.on('did-start-loading', () => {
      if (this.hostWindow !== window) return
      for (const [pluginId, runtime] of this.runtime) {
        this.revokePluginToken(pluginId, runtime.token)
        this.onPluginReset(pluginId)
      }
      this.runtime.clear()
      this.closePort()
      this.portReady = false
    })
    window.webContents.on('render-process-gone', () => this.handleHostCrash(window))
    window.on('closed', () => {
      if (this.hostWindow !== window) return
      this.hostWindow = null
      this.portReady = false
      this.closePort()
      this.clearTimers()
      const shouldRestart = !this.closingIntentionally && this.desired.size > 0
      if (shouldRestart) {
        const pluginIds = [...this.desired.keys()]
        for (const pluginId of pluginIds) this.recordCrash(pluginId, 'host', false)
        if (this.desired.size > 0) this.scheduleHostRestart(pluginIds)
      }
      this.closingIntentionally = false
    })
    this.startTimers()
    void window.loadURL('agent-pets://plugin/_host/index.html').catch(() => this.handleHostCrash(window))
  }

  private attachHostPort(window: BrowserWindow): void {
    if (this.hostWindow !== window || window.isDestroyed()) return
    this.closePort()
    const channel = new MessageChannelMain()
    this.hostPort = channel.port1
    this.hostPort.on('message', event => this.handleHostMessage(event.data))
    this.hostPort.start()
    window.webContents.postMessage('plugin-host-port', null, [channel.port2])
    this.portReady = true
    this.syncWorkers()
  }

  private syncWorkers(): void {
    if (!this.portReady) return
    for (const [pluginId, state] of this.runtime) {
      if (!this.desired.has(pluginId)) {
        this.post({ type: 'stop', pluginId })
        this.revokePluginToken(pluginId, state.token)
        this.onPluginReset(pluginId)
        this.runtime.delete(pluginId)
        this.failureTracker.clear(pluginId)
      } else {
        const next = this.desired.get(pluginId)!
        if (next.entry === state.descriptor.entry && next.revision === state.descriptor.revision
          && next.scheduleEnabled === state.descriptor.scheduleEnabled
          && next.scheduleMinIntervalSec === state.descriptor.scheduleMinIntervalSec
          && next.agentStatusEnabled === state.descriptor.agentStatusEnabled) continue
        this.post({ type: 'stop', pluginId })
        this.revokePluginToken(pluginId, state.token)
        this.onPluginReset(pluginId)
        this.runtime.delete(pluginId)
      }
    }
    const now = this.readNow()
    if (now === null) return
    for (const [pluginId, descriptor] of this.desired) {
      if (this.runtime.has(pluginId)) continue
      let token: string
      try { token = this.createPluginToken(pluginId) } catch { continue }
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(token)) continue
      this.runtime.set(pluginId, { descriptor, lastPongAt: now, startedAt: now, token, receivedPong: false, ready: false })
      this.post({ type: 'start', pluginId, token, ...descriptor })
    }
  }

  private handleHostMessage(value: unknown): void {
    if (!isRecord(value) || typeof value.type !== 'string' || typeof value.pluginId !== 'string'
      || !this.desired.has(value.pluginId)) return
    const pluginId = value.pluginId
    if (value.type === 'worker-started') return
    if (value.type === 'worker-ready') {
      const runtime = this.runtime.get(pluginId)
      if (runtime) runtime.ready = true
      return
    }
    if (value.type === 'pong') {
      const runtime = this.runtime.get(pluginId)
      const now = this.readNow()
      if (runtime && now !== null) {
        runtime.lastPongAt = now
        runtime.receivedPong = true
      }
      return
    }
    if (value.type === 'worker-crash') {
      this.recordCrash(pluginId, 'worker')
      return
    }
    if (value.type === 'rpc') {
      const runtime = this.runtime.get(pluginId)
      if (!runtime || !isCurrentPluginRuntimeToken(runtime.token, value.token)) return
      const runtimeToken = runtime.token
      const requestId = isRecord(value.request) && typeof value.request.id === 'string' ? value.request.id : ''
      void Promise.resolve()
        .then(() => runPluginRpcForCurrentToken(
          () => this.desired.has(pluginId) ? this.runtime.get(pluginId)?.token : null,
          runtimeToken,
          () => this.onRpc(pluginId, value.request, runtimeToken),
        ))
        .then(dispatch => {
          if (!dispatch.current) return
          const result = dispatch.value
          const normalizedResult = requestId && isRecord(result) && result.id === requestId
            ? result
            : { ...(requestId ? { id: requestId } : {}), ok: false, error: 'invalid_request' }
          this.post({ type: 'rpc-result', pluginId, result: normalizedResult })
        })
        .catch(() => {
          if (!isCurrentPluginRuntimeToken(this.runtime.get(pluginId)?.token, runtimeToken)) return
          this.post({
            type: 'rpc-result',
            pluginId,
            result: { ...(requestId ? { id: requestId } : {}), ok: false, error: 'invalid_request' },
          })
        })
    }
  }

  private startTimers(): void {
    this.clearTimers()
    this.pingTimer = setInterval(() => this.pingWorkers(), PING_INTERVAL_MS)
    this.memoryTimer = setInterval(() => this.checkMemory(), MEMORY_POLL_INTERVAL_MS)
  }

  private pingWorkers(): void {
    if (!this.portReady || this.desired.size === 0) return
    const now = this.readNow()
    if (now === null) return
    this.post({ type: 'ping', at: now })
    for (const [pluginId, runtime] of this.runtime) {
      if (now - runtime.lastPongAt >= PONG_TIMEOUT_MS) {
        this.post({ type: 'terminate', pluginId })
        this.recordCrash(pluginId, 'worker')
      } else if (runtime.receivedPong && now - runtime.startedAt >= 60_000) {
        this.failureTracker.resetAfterHealthyRuntime(pluginId, runtime.startedAt, runtime.receivedPong)
      }
    }
  }

  private checkMemory(): void {
    const window = this.hostWindow
    if (!window || window.isDestroyed() || this.desired.size === 0) return
    const pid = window.webContents.getOSProcessId()
    const metric = app.getAppMetrics().find(item => item.pid === pid)
    const workingSetKb = metric?.memory.workingSetSize
    const budget = this.getMemoryBudgetMb(this.desired.size)
    if (!Number.isFinite(workingSetKb) || !Number.isFinite(budget) || budget <= 0) return
    if ((workingSetKb ?? 0) / 1024 <= budget) return
    const pluginIds = [...this.desired.keys()]
    for (const pluginId of pluginIds) this.recordCrash(pluginId, 'host', false)
    this.closingIntentionally = true
    window.destroy()
    this.hostWindow = null
    this.portReady = false
    this.closePort()
    this.clearTimers()
    if (this.desired.size > 0) this.scheduleHostRestart(pluginIds)
  }

  private handleHostCrash(window: BrowserWindow): void {
    if (this.hostWindow !== window || window.isDestroyed()) return
    window.destroy()
  }

  private recordCrash(pluginId: string, reason: 'host' | 'worker', scheduleWorkerRestart = true): void {
    if (!this.desired.has(pluginId)) return
    const runtime = this.runtime.get(pluginId)
    if (reason === 'worker' && !runtime) return
    if (runtime) this.revokePluginToken(pluginId, runtime.token)
    this.onPluginReset(pluginId)
    const count = this.failureTracker.record(pluginId)
    this.runtime.delete(pluginId)
    this.onPluginCrash(pluginId, count, reason)
    if (!shouldRetryPluginHost(count)) {
      this.desired.delete(pluginId)
      this.post({ type: 'terminate', pluginId })
    } else if (scheduleWorkerRestart && this.portReady && this.desired.has(pluginId)) {
      setTimeout(() => {
        const descriptor = this.desired.get(pluginId)
        if (!descriptor || this.runtime.has(pluginId) || !this.portReady) return
        const now = this.readNow()
        if (now === null) return
        let token: string
        try { token = this.createPluginToken(pluginId) } catch { return }
        if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(token)) return
        this.runtime.set(pluginId, { descriptor, lastPongAt: now, startedAt: now, token, receivedPong: false, ready: false })
        this.post({ type: 'start', pluginId, token, ...descriptor })
      }, pluginHostRetryDelay(count))
    }
  }

  private scheduleHostRestart(pluginIds: readonly string[]): void {
    if (this.restartTimer) clearTimeout(this.restartTimer)
    const maxFailures = pluginIds.reduce((maximum, id) => Math.max(maximum, this.failureTracker.count(id)), 1)
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      if (!this.closingIntentionally && this.desired.size > 0 && !this.hostWindow) this.createHost()
    }, pluginHostRetryDelay(maxFailures))
  }

  private post(message: unknown): void {
    try { this.hostPort?.postMessage(message) } catch {}
  }

  private closePort(): void {
    try { this.hostPort?.close() } catch {}
    this.hostPort = null
  }

  private clearTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer)
    if (this.memoryTimer) clearInterval(this.memoryTimer)
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.pingTimer = null
    this.memoryTimer = null
    this.restartTimer = null
  }

  private closeHost(): void {
    for (const [pluginId, runtime] of this.runtime) {
      this.revokePluginToken(pluginId, runtime.token)
      this.onPluginReset(pluginId)
    }
    this.runtime.clear()
    this.failureTracker.clear()
    this.portReady = false
    this.closePort()
    this.clearTimers()
    const window = this.hostWindow
    if (!window || window.isDestroyed()) {
      this.hostWindow = null
      return
    }
    this.closingIntentionally = true
    window.close()
    if (!window.isDestroyed()) window.destroy()
    this.hostWindow = null
  }

  private readNow(): number | null {
    try {
      const now = this.now()
      return Number.isSafeInteger(now) && now >= 0 ? now : null
    } catch {
      return null
    }
  }
}

function isValidDescriptor(value: unknown): value is PluginHostDescriptor {
  if (!isRecord(value) || typeof value.id !== 'string' || !PLUGIN_ID.test(value.id)
    || typeof value.entry !== 'string' || value.entry.length > 512 || !PLUGIN_ENTRY.test(value.entry)) return false
  if (value.commandIds !== undefined && (!Array.isArray(value.commandIds) || value.commandIds.length > 10
    || value.commandIds.some(id => typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(id))
    || new Set(value.commandIds).size !== value.commandIds.length)) return false
  if (value.revision !== undefined && (typeof value.revision !== 'string' || value.revision.length > 128)) return false
  return !value.entry.split('/').some(segment => !segment || segment === '.' || segment === '..')
}
