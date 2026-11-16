import { IPC_CHANNELS } from '../ipc/channels'
import { sanitizePetId } from '../pet-id.ts'
import { rasterContentType } from '../pet-sprite-validation.ts'
import { app, BrowserWindow, WebContentsView, screen, ipcMain, dialog, net, session, protocol, globalShortcut, powerMonitor, shell, safeStorage, Notification, nativeTheme } from 'electron'
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { attachRendererRecovery, type RendererRecovery } from './renderer-recovery'
import { logMain, mainLogger } from '../diagnostics/main-log'
import { buildDiagnosticsReport, registerDiagnosticsSection } from '../diagnostics/report'
import { eventPipelineStats } from '../event-stats'
import { resolveLocalPorts } from './ports'
import { LOCAL_WIRE_HEADERS, LOCAL_WIRE_HOST, LOCAL_WIRE_PATHS } from '../../src/types/local-wire.ts'
import { createServerHealthTracker, type ServerHealthTracker } from './server-health'
import { createSessionJumpService, withSessionJumpContext } from './session-jump-runtime'
import { join, resolve } from 'path'
import { request as httpRequest } from 'node:http'
import { Readable } from 'node:stream'
import * as fs from 'fs'
import * as path from 'path'

import { DesktopPreferencesStore } from '../desktop-preferences'
import { createLoginItemAdapter } from '../login-item'
import { DesktopNotificationService } from '../desktop-notifications'
import { DesktopTrayController } from '../desktop-tray'
import type { PluginTrayCommandItem } from '../plugin-tray'
import { desktopVisibilityCapabilitiesForPlatform, macVisibleOnFullScreen } from '../desktop-visibility'
import { PermissionBroker } from '../permission-broker'
import { appendPermissionAudit, clearPermissionAudit, readPermissionAudit, trimPermissionAuditOnStartup } from '../permission-audit'
import type { PermissionAuditEntry } from '../../src/types/permission'
import { familySourceSet } from '../../src/types/agent'
import { CLAUDE_PERMISSION_WAIT_DEFAULT_SECONDS } from '../../src/types/permission'
import { ProgressionStore } from '../progression'
import { AchievementStore } from '../achievements'
import { HistoryStore } from '../history'
import { LocalUsageReader } from '../local-usage'
import { createPresentationMcpServer } from '../presentation-mcp'
import { listenOnLocalPort } from '../local-server-listen'
import { normalizePresentationStatus, PresentationController } from '../presentation-controller'

import { ProjectRoutingStore } from '../project-routing'
import { PLUGIN_ARCHIVE_SKIN_IMAGE_MAX_BYTES } from '../plugin-registry'
import { PanelSizeStore } from '../panel-size-store'
import { PluginPreferencesStore } from '../plugin-preferences'
import { PluginHostWindowController, type PluginHostDescriptor } from '../plugin-host-window'
import { selectEnabledPluginDescriptors } from '../plugin-host-selection'
import type { PluginBrokerContext } from '../plugin-broker.ts'
import { effectivePluginScheduleMinimum } from '../plugin-schedule.ts'

import { shouldRecordUserPanelSize, validatePluginPanelViewBounds, type PluginPanelRect } from '../plugin-panel-window.ts'
import { isPluginPanelPluginId, pluginPanelErrorCode } from '../plugin-panel-validation.ts'
import { handlePluginProtocolRequest } from '../plugin-protocol'
import { pluginHostAssets } from '../plugin-host-assets'
import { parsePluginManifest } from '../plugin-manifest'
import { createPermissionAdapterServer, PERMISSION_ADAPTER_SOURCES, PermissionAdapterRelay } from '../permission-adapter-server'
import type { DesktopPreferences } from '../../src/types/desktop'
import { CLAUDE_ANSWERABLE_GRACE_MS, withAnswerableClaudeNotice } from '../claude-permission-notice'
import { locale, setLocale, t } from '../../src/i18n'
import tokensCss from '../../src/styles/tokens.css?raw'
import type { HistorySummary } from '../../src/types/history'
import type { PresentationIntent } from '../../src/types/presentation'
import type { PluginEventSourceStatusView, PluginPanelPlugin, PluginPanelResult, PluginPanelSnapshot } from '../../src/types/plugin'
import type { IpcErrorCode } from '../../src/types/ipc'

import { createPluginSkinPetId, DEFAULT_PET_ID, isValidPetId, isValidRegularPetId } from '../../src/utils/pet-id.ts'
import { availablePluginSkinPetIds } from '../plugin-skins.ts'
import { IS_MAC, hookScriptDeployPath, readWindowState, syncClaudePermissionRespondOptIn, writeWindowState } from '../setup'

import { createWindowsFullscreenDetector, nativeWindowHandleToPointer, type WindowsFullscreenState } from '../windows-fullscreen-detector'

import { createLatestValueCoalescer } from '../ipc/broadcast-coalescer.ts'
import { createVisibleSender } from '../ipc/progression-broadcast-gate.ts'
import { createDbMaintenanceService } from './db-maintenance-service.ts'
import { createGrowthService } from './growth-service.ts'

import { type IntegrationTestSource } from '../ipc/integrations'


import { mainState, type PluginSkinFallbackInfo } from './state'
import { appUserDataPaths } from './app-user-data'
import { createPanelGeometry } from './panel-geometry'
import { createPetWindowModeService } from './pet-window-mode-service'
import { createHistoryRuntimeService } from './history-runtime-service'
import { createPluginCatalogRuntime, decodeCatalogBase64 } from './plugin-catalog-runtime'
import { createAppUpdateRuntime } from './app-update-runtime'
import { createPluginRuntime } from './plugin-runtime'
import { EMPTY_ATTENTION } from '../attention-tracker'
import { attachHotkeyInfo, PermissionHotkeys } from '../permission-hotkeys'
import { clamp } from '../../src/utils/number'
import { initialPetWindowSize } from '../../src/utils/pet-window-size'
import { PANEL_GAP, PANEL_WIDTH, PANEL_BLUR_HIDE_DELAY_MS, shouldHidePanelOnBlur } from '../../src/utils/panel-layout'
import { currentAgentConfigDirs } from '../agent-config-dirs.ts'
import { asRecord } from '../value-guards.ts'

let permissionHotkeys: PermissionHotkeys | null = null

function getPermissionHotkeys(): PermissionHotkeys {
  permissionHotkeys ??= new PermissionHotkeys({
    platform: process.platform,
    shortcuts: {
      register: (accelerator, callback) => globalShortcut.register(accelerator, callback),
      unregister: (accelerator) => globalShortcut.unregister(accelerator),
      isRegistered: (accelerator) => globalShortcut.isRegistered(accelerator),
    },
    decide: (requestId, decision) => {
      void mainState.permissionBroker?.decide(requestId, decision, 'hotkey')
    },
  })
  return permissionHotkeys
}

export { PANEL_GAP, PANEL_WIDTH }
export const MAX_PET_ZIP_BYTES = 10 * 1024 * 1024
export const MAX_PET_ZIP_ENTRIES = 64
export const MAX_PET_UNCOMPRESSED_BYTES = 25 * 1024 * 1024
export const MAX_PET_JSON_BYTES = 256 * 1024
export const MAX_PET_IMAGE_BYTES = 20 * 1024 * 1024

export function sendIntegrationTestEvent(
  source: IntegrationTestSource,
  sessionId: string,
  state: 'thinking' | 'offline',
): Promise<void> {
  const body = JSON.stringify({
    source,
    sessionId,
    project: 'Agent Pets Test',
    state,
    originalEvent: 'AgentPetsIntegrationTest',
    timestamp: Date.now(),
  })

  return new Promise((resolvePromise, reject) => {
    const request = httpRequest({
      hostname: LOCAL_WIRE_HOST,
      // 與事件伺服器實際監聽的埠相同（開發或 e2e 執行可能不是 17373）。
      port: localPorts().event,
      path: LOCAL_WIRE_PATHS.events,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        [LOCAL_WIRE_HEADERS.eventToken]: mainState.eventToken,
      },
    }, (response) => {
      response.resume()
      response.on('end', () => {
        if (response.statusCode === 204) {
          resolvePromise()
        } else {
          reject(new Error(`Event server returned ${response.statusCode ?? 'no status'}`))
        }
      })
    })

    request.setTimeout(1_500, () => {
      request.destroy(new Error('Event server timed out'))
    })
    request.on('error', reject)
    request.end(body)
  })
}

export function waitForIntegrationTestReceipt(sessionId: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      mainState.pendingIntegrationTests.delete(sessionId)
      reject(new Error('Live event was not received by this Agent Pets instance'))
    }, 1_500)

    mainState.pendingIntegrationTests.set(sessionId, () => {
      clearTimeout(timeout)
      mainState.pendingIntegrationTests.delete(sessionId)
      resolvePromise()
    })
  })
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

// Panel open/close animates its own content over 200ms (see StatusPanel.vue's
// .panel-enter-active transition). Without this, setBounds() would snap the
// native window to its new size instantly while the content fades in after —
// a visible, jarring mismatch. Tweening bounds keeps the two in sync.
export function animateBounds(target: { x: number; y: number; width: number; height: number }, duration = 200) {
  if (!mainState.petWindow) return
  if (mainState.resizeAnimHandle) {
    clearInterval(mainState.resizeAnimHandle)
    mainState.resizeAnimHandle = null
  }

  // A hidden window has nothing to animate; jump straight to the end state.
  if (!mainState.petWindow.isVisible()) {
    mainState.petWindow.setBounds({ x: Math.round(target.x), y: Math.round(target.y), width: Math.round(target.width), height: Math.round(target.height) })
    repositionVisiblePanel()
    return
  }

  const start = mainState.petWindow.getBounds()
  const startTime = Date.now()

  mainState.resizeAnimHandle = setInterval(() => {
    if (!mainState.petWindow) {
      if (mainState.resizeAnimHandle) clearInterval(mainState.resizeAnimHandle)
      mainState.resizeAnimHandle = null
      return
    }

    const t = Math.min(1, (Date.now() - startTime) / duration)
    const eased = easeOutCubic(t)

    mainState.petWindow.setBounds({
      x: Math.round(start.x + (target.x - start.x) * eased),
      y: Math.round(start.y + (target.y - start.y) * eased),
      width: Math.round(start.width + (target.width - start.width) * eased),
      height: Math.round(start.height + (target.height - start.height) * eased),
    })
    repositionVisiblePanel()

    if (t >= 1 && mainState.resizeAnimHandle) {
      clearInterval(mainState.resizeAnimHandle)
      mainState.resizeAnimHandle = null
    }
  }, 16)
}

export function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function readPluginPanelRect(value: unknown): PluginPanelRect | null {
  const rect = asRecord(value)
  if (!rect) return null
  const x = finiteNumber(rect.x)
  const y = finiteNumber(rect.y)
  const width = finiteNumber(rect.width)
  const height = finiteNumber(rect.height)
  return x === null || y === null || width === null || height === null ? null : { x, y, width, height }
}

export function isTrustedRendererUrl(rawUrl: string): boolean {
  try {
    const candidate = new URL(rawUrl)
    if (process.env.VITE_DEV_SERVER_URL && !app.isPackaged) {
      return candidate.origin === new URL(process.env.VITE_DEV_SERVER_URL).origin
    }
    return candidate.protocol === 'agent-pets:'
      && candidate.hostname === 'app'
      && candidate.pathname === '/index.html'
  } catch {
    return false
  }
}

export function secureRendererWindow(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault()
  })
  window.webContents.on('will-redirect', (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault()
  })
  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })
}

export function isTrustedIpcSender(
  event: IpcMainEvent | IpcMainInvokeEvent,
  requiredWindow?: BrowserWindow | null,
): boolean {
  const frame = event.senderFrame
  if (!frame || frame !== event.sender.mainFrame || !isTrustedRendererUrl(frame.url)) return false
  if (requiredWindow) return event.sender === requiredWindow.webContents
  return [mainState.petWindow, mainState.panelWindow].some((window) => window?.webContents === event.sender)
}

export function assertTrustedIpcSender(
  event: IpcMainEvent | IpcMainInvokeEvent,
  requiredWindow?: BrowserWindow | null,
): void {
  if (!isTrustedIpcSender(event, requiredWindow)) {
    throw new Error('Unauthorized IPC sender')
  }
}

export function assertPluginPanelSender(event: IpcMainEvent | IpcMainInvokeEvent): void {
  if (!mainState.panelWindow || mainState.panelWindow.isDestroyed() || event.sender !== mainState.panelWindow.webContents) {
    throw new Error('Unauthorized plugin panel IPC sender')
  }
  assertTrustedIpcSender(event, mainState.panelWindow)
}

export function pluginPanelError(error: unknown): IpcErrorCode {
  return pluginPanelErrorCode(error)
}

export async function pluginPanelSnapshot(): Promise<PluginPanelResult<PluginPanelSnapshot>> {
  if (!mainState.pluginRegistry || !mainState.pluginPreferences) return { ok: false, error: 'plugin_service_unavailable' }
  try {
    const preferences = mainState.pluginPreferences.get()
    const plugins: PluginPanelPlugin[] = await Promise.all(mainState.pluginRegistry.list().map(async entry => {
      const root = appUserDataPaths().pluginVersionRoot(entry.id, entry.currentVersion)
      const source = await readRegularFileWithin(root, 'plugin.json', 256 * 1024)
      let manifest: PluginPanelPlugin['manifest'] = null
      if (source) {
        try {
          const parsed = parsePluginManifest(JSON.parse(source.toString('utf8')) as unknown)
          if (parsed.ok && parsed.manifest.id === entry.id) manifest = parsed.manifest
        } catch {}
      }
      return {
        id: entry.id,
        currentVersion: entry.currentVersion,
        status: entry.status,
        installedAt: entry.installedAt,
        grantedPermissions: entry.grantedPermissions,
        signatureStatus: entry.signatureStatus,
        ...(entry.signatureFingerprint ? { signatureFingerprint: entry.signatureFingerprint } : {}),
        manifest,
        development: mainState.developerSourceFolders.has(entry.id),
        preference: preferences.plugins[entry.id] ?? mainState.pluginPreferences!.getPlugin(entry.id),
      }
    }))
    return { ok: true, value: { preferences, plugins } }
  } catch (error) {
    return { ok: false, error: pluginPanelError(error) }
  }
}

export { sanitizePetId }

export function safeJoin(base: string, ...parts: string[]): string | null {
  const root = resolve(base)
  const resolvedPath = resolve(root, ...parts)
  const relative = path.relative(root, resolvedPath)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null
  return resolvedPath
}

export function contentTypeFor(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8'
    case '.js': return 'text/javascript; charset=utf-8'
    case '.css': return 'text/css; charset=utf-8'
    case '.json': return 'application/json; charset=utf-8'
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.woff2': return 'font/woff2'
    default: return 'application/octet-stream'
  }
}

export async function readRegularFileWithin(root: string, relativePath: string, maxBytes: number): Promise<Buffer | null> {
  const candidate = safeJoin(root, relativePath)
  if (!candidate) return null
  let handle: Awaited<ReturnType<typeof fs.promises.open>> | null = null
  try {
    const rootReal = await fs.promises.realpath(root)
    const candidateStat = await fs.promises.lstat(candidate)
    if (!candidateStat.isFile() || candidateStat.isSymbolicLink() || candidateStat.size > maxBytes) return null
    const candidateReal = await fs.promises.realpath(candidate)
    const relative = path.relative(rootReal, candidateReal)
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null
    const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0
    handle = await fs.promises.open(candidateReal, fs.constants.O_RDONLY | noFollow)
    const opened = await handle.stat()
    if (!opened.isFile() || opened.size > maxBytes) return null
    const data = await handle.readFile()
    return data.length <= maxBytes ? data : null
  } catch {
    return null
  } finally {
    try { await handle?.close() } catch {}
  }
}

// Hands the file buffer to the Response as-is. Uint8Array.from() walked the
// iterator and copied up to 20 MB per sprite or preview request.
function responseBody(data: Buffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength)
}

export function configureSecureProtocol(): void {
  protocol.handle('agent-pets', async (request) => {
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 })
    try {
      const url = new URL(request.url)
      const pathname = decodeURIComponent(url.pathname)
      switch (url.hostname) {
        case 'plugin': {
          return await handlePluginProtocolRequest(request.url, {
            pluginRootForId: enabledPluginRoot,
            hostAssets: pluginHostAssets,
            pluginSkinAssetForId: async (pluginId, relativePath) => {
              const context = mainState.pluginRuntimeContexts.get(pluginId)
              const skin = context?.manifest.contributes.skins?.find(candidate => candidate.spritesheet === relativePath)
              if (!skin) return undefined
              const root = enabledPluginRoot(pluginId)
              if (!root) return null
              const data = await readRegularFileWithin(root, relativePath, PLUGIN_ARCHIVE_SKIN_IMAGE_MAX_BYTES)
              const type = data ? rasterContentType(data) : null
              return data && type ? { data, contentType: type } : null
            },
          })
        }
        case 'panel-theme': {
          return mainState.panelThemeRuntime
            ? await mainState.panelThemeRuntime.handleRequest(request.url, request.method)
            : new Response('Not found', { status: 404 })
        }
        case 'app': {
          const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
          const data = await readRegularFileWithin(resolve(join(__dirname, '../dist')), relativePath, 25 * 1024 * 1024)
          if (!data) return new Response('Not found', { status: 404 })
          return new Response(responseBody(data), {
            status: 200,
            headers: {
              'content-type': contentTypeFor(relativePath),
              'x-content-type-options': 'nosniff',
            },
          })
        }
        case 'import-preview': {
          // Staged (not yet installed) import, addressed by an unguessable
          // per-import token; anything else 404s.
          const match = pathname.match(/^\/([0-9a-f]{32})\/spritesheet$/)
          const directory = match ? mainState.petImport?.previewDirectory(match[1]) : null
          const data = directory ? await readRegularFileWithin(directory, 'spritesheet.webp', MAX_PET_IMAGE_BYTES) : null
          const contentType = data ? rasterContentType(data) : null
          if (!data || !contentType) return new Response('Not found', { status: 404 })
          return new Response(responseBody(data), {
            status: 200,
            headers: { 'content-type': contentType, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' },
          })
        }
        case 'custom': {
          const match = pathname.match(/^\/([a-zA-Z0-9_.-]{1,64})\/spritesheet\.webp$/)
          const safeId = match ? sanitizePetId(match[1]) : null
          if (!safeId) return new Response('Not found', { status: 404 })
          const customRoot = resolve(hookScriptDeployPath(), 'custom')
          const data = await readRegularFileWithin(customRoot, join(safeId, 'spritesheet.webp'), MAX_PET_IMAGE_BYTES)
          const contentType = data ? rasterContentType(data) : null
          if (!data || !contentType) return new Response('Not found', { status: 404 })
          return new Response(responseBody(data), {
            status: 200,
            headers: { 'content-type': contentType, 'x-content-type-options': 'nosniff' },
          })
        }
      }
    } catch {}
    return new Response('Not found', { status: 404 })
  })
}

export function enabledPluginRoot(pluginId: string): string | null {
  const context = mainState.pluginRuntimeContexts.get(pluginId)
  if (!context?.pluginsEnabled || !context.enabled) return null
  const entry = mainState.pluginRegistry?.list().find(plugin => plugin.id === pluginId)
  if (!entry || (entry.status !== 'installed' && entry.status !== 'enabled')) return null
  return appUserDataPaths().pluginVersionRoot(entry.id, entry.currentVersion)
}

export async function refreshPluginRuntimeContexts(): Promise<void> {
  let preferences: ReturnType<PluginPreferencesStore['get']> | null = null
  try { preferences = mainState.pluginPreferences?.get() ?? null } catch {}
  mainState.pluginPreferencesSnapshot = preferences
  const next = new Map<string, PluginBrokerContext & { muted: boolean; rateLimitPer10Min: number; targetPetId: string | null; grantedHosts: string[] }>()
  for (const entry of mainState.pluginRegistry?.list() ?? []) {
    if (entry.status !== 'installed' && entry.status !== 'enabled') continue
    const preference = preferences?.plugins[entry.id]
    if (!preference) continue
    const root = appUserDataPaths().pluginVersionRoot(entry.id, entry.currentVersion)
    const source = await readRegularFileWithin(root, 'plugin.json', 256 * 1024)
    if (!source) continue
    try {
      const parsed = parsePluginManifest(JSON.parse(source.toString('utf8')) as unknown)
      if (!parsed.ok || parsed.manifest.id !== entry.id) continue
      next.set(entry.id, {
        manifest: parsed.manifest,
        enabled: preference.enabled,
        pluginsEnabled: preferences?.pluginsEnabled === true,
        dndEnabled: currentDesktopPreferences().dndEnabled,
        storageBytesPerPlugin: preferences?.resources.storageBytesPerPlugin ?? 0,
        netLimits: {
          maxResponseBytes: preferences?.resources.netMaxResponseBytes ?? 0,
          timeoutMs: (preferences?.resources.netTimeoutSeconds ?? 0) * 1_000,
          requestsPerMinute: preferences?.resources.netRequestsPerMinute ?? 0,
        },
        muted: preference.muted,
        rateLimitPer10Min: preference.rateLimitPer10Min,
        targetPetId: preference.targetPetId,
        grantedHosts: [...(parsed.manifest.permissions.network?.hosts ?? []), ...preference.grantedHosts],
      })
    } catch {
      // A malformed manifest remains unavailable to the runtime until reinstalled.
    }
  }
  mainState.pluginRuntimeContexts = next
}

export function enabledPluginDescriptors(): PluginHostDescriptor[] {
  const preferences = mainState.pluginPreferencesSnapshot
  if (!preferences?.pluginsEnabled) return []
  const registryById = new Map((mainState.pluginRegistry?.list() ?? []).map(entry => [entry.id, entry] as const))
  const candidates = [...mainState.pluginRuntimeContexts.entries()]
    .filter(([, context]) => context.enabled && typeof context.manifest.entry === 'string')
    .map(([id, context]) => {
      const registryEntry = registryById.get(id)
      return {
        id,
        entry: context.manifest.entry!,
        commandIds: (context.manifest.contributes.commands ?? []).map(command => command.id),
        scheduleEnabled: context.manifest.permissions.schedule !== undefined,
        scheduleMinIntervalSec: effectivePluginScheduleMinimum(
          context.manifest.permissions.schedule?.minIntervalSec ?? preferences.resources.scheduleMinIntervalSeconds,
          preferences.resources.scheduleMinIntervalSeconds,
        ),
        agentStatusEnabled: context.manifest.permissions.agentStatus === true,
        ...(registryEntry ? { revision: `${registryEntry.currentVersion}:${registryEntry.installedAt}` } : {}),
      }
    })
  for (const descriptor of candidates) {
    if (!mainState.pluginEnableOrder.has(descriptor.id)) mainState.pluginEnableOrder.set(descriptor.id, mainState.nextPluginEnableOrder++)
  }
  candidates.sort((left, right) => (mainState.pluginEnableOrder.get(left.id) ?? 0) - (mainState.pluginEnableOrder.get(right.id) ?? 0))
  const selection = selectEnabledPluginDescriptors(candidates, preferences.resources.maxEnabledPlugins)
  for (const plugin of selection.skipped) {
    if (mainState.diagnosedPluginLimitIds.has(plugin.id)) continue
    mainState.diagnosedPluginLimitIds.add(plugin.id)
    mainState.pluginBroker?.recordSystemDiagnostic(plugin.id, 'too_many_enabled', 'plugin.limit')
  }
  if (selection.skipped.length === 0) mainState.diagnosedPluginLimitIds.clear()
  return selection.selected
}

export async function reloadDeveloperPlugin(pluginId: string, sourceFolder: string): Promise<void> {
  if (mainState.developerReloadsInFlight.has(pluginId)) return
  if (!mainState.pluginRegistry || !mainState.pluginPreferences || mainState.developerSourceFolders.get(pluginId) !== sourceFolder
    || mainState.pluginPreferencesSnapshot?.developerMode !== true) return
  mainState.developerReloadsInFlight.add(pluginId)
  try {
    const planned = await mainState.pluginRegistry.planInstallDirectory(sourceFolder)
    if (!planned.ok) {
      mainState.pluginBroker?.recordSystemDiagnostic(pluginId, 'invalid_request', 'developer.reload')
      return
    }
    if (planned.value.pluginId !== pluginId || planned.value.kind === 'incompatible') {
      mainState.pluginRegistry.discardPlan(planned.value.token)
      mainState.pluginBroker?.recordSystemDiagnostic(pluginId, 'invalid_request', 'developer.reload')
      return
    }
    if (planned.value.requiresReconsent) {
      mainState.pluginRegistry.discardPlan(planned.value.token)
      mainState.pluginBroker?.recordSystemDiagnostic(pluginId, 'not_permitted', 'developer.reload')
      return
    }
    const installed = mainState.pluginRegistry.install(planned.value.token, false)
    if (!installed.ok) {
      mainState.pluginRegistry.discardPlan(planned.value.token)
      mainState.pluginBroker?.recordSystemDiagnostic(pluginId, 'invalid_request', 'developer.reload')
      return
    }
    await syncPluginHost()
  } catch {
    mainState.pluginBroker?.recordSystemDiagnostic(pluginId, 'invalid_request', 'developer.reload')
  } finally {
    mainState.developerReloadsInFlight.delete(pluginId)
  }
}

export function syncDeveloperWatchers(): void {
  if (!mainState.pluginDeveloperModeWatcher) return
  if (mainState.pluginPreferencesSnapshot?.developerMode !== true) {
    mainState.pluginDeveloperModeWatcher.clear()
    return
  }
  for (const [pluginId, folder] of mainState.developerSourceFolders) {
    if (mainState.pluginDeveloperModeWatcher.isWatching(pluginId, folder)) continue
    mainState.pluginDeveloperModeWatcher.watch(pluginId, folder, () => reloadDeveloperPlugin(pluginId, folder))
  }
}

export function enabledPluginSkinRecords(): Map<string, PluginSkinFallbackInfo & { spritesheet: string; version: string }> {
  const records = new Map<string, PluginSkinFallbackInfo & { spritesheet: string; version: string }>()
  if (!mainState.pluginPreferencesSnapshot?.pluginsEnabled) return records
  const versions = new Map((mainState.pluginRegistry?.list() ?? []).map(entry => [entry.id, entry.currentVersion] as const))
  for (const [pluginId, context] of mainState.pluginRuntimeContexts) {
    if (!context.enabled) continue
    for (const skin of context.manifest.contributes.skins ?? []) {
      const petId = createPluginSkinPetId(pluginId, skin.id)
      if (!petId) continue
      records.set(petId, {
        pluginId,
        pluginName: { ...context.manifest.name },
        skinName: { ...skin.displayName },
        spritesheet: skin.spritesheet,
        version: versions.get(pluginId) ?? '',
      })
    }
  }
  return records
}

export function broadcastPluginSkinsChanged(removedPetIds: string[]): void {
  const petIds = [...new Set(removedPetIds)]
  for (const window of [mainState.petWindow, mainState.panelWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send(IPC_CHANNELS.pluginSkinsChanged, petIds)
  }
}

export function syncPanelThemes(): void {
  mainState.panelThemeRuntime?.sync({
    registry: mainState.pluginRegistry?.list() ?? [],
    contexts: mainState.pluginRuntimeContexts,
    pluginsEnabled: mainState.pluginPreferencesSnapshot?.pluginsEnabled === true,
  })
}

/** 受信任的面板渲染端來源（字型會從 agent-pets://panel-theme 跨來源抓取）。 */
function panelRendererOrigin(): string | null {
  try {
    if (process.env.VITE_DEV_SERVER_URL && !app.isPackaged) return new URL(process.env.VITE_DEV_SERVER_URL).origin
  } catch {
    return null
  }
  return 'agent-pets://app'
}

export async function syncPluginHost(): Promise<void> {
  const previousSkins = enabledPluginSkinRecords()
  await refreshPluginRuntimeContexts()
  syncPanelThemes()
  const currentSkins = enabledPluginSkinRecords()
  const removedPetIds: string[] = []
  for (const [petId, info] of previousSkins) {
    if (currentSkins.has(petId)) continue
    mainState.pendingPluginSkinFallbacks.set(petId, info)
    removedPetIds.push(petId)
  }
  for (const petId of currentSkins.keys()) mainState.pendingPluginSkinFallbacks.delete(petId)
  while (mainState.pendingPluginSkinFallbacks.size > 250) {
    const oldest = mainState.pendingPluginSkinFallbacks.keys().next().value as string | undefined
    if (!oldest) break
    mainState.pendingPluginSkinFallbacks.delete(oldest)
  }
  const catalogChanged = previousSkins.size !== currentSkins.size
    || [...previousSkins].some(([petId, previous]) => {
      const current = currentSkins.get(petId)
      return !current || current.spritesheet !== previous.spritesheet || current.version !== previous.version
        || current.pluginName['zh-TW'] !== previous.pluginName['zh-TW']
        || current.pluginName['en-US'] !== previous.pluginName['en-US']
        || current.skinName['zh-TW'] !== previous.skinName['zh-TW']
        || current.skinName['en-US'] !== previous.skinName['en-US']
    })
  if (catalogChanged) {
    mainState.availablePetIdsCache = null
    availablePetIdsLoad = null
    broadcastPluginSkinsChanged(removedPetIds)
  }
  mainState.pluginBadgeController?.syncEnabledPlugins()
  syncDeveloperWatchers()
  mainState.pluginPanelViewController?.closeIfNotAllowed(pluginId => {
    const context = mainState.pluginRuntimeContexts.get(pluginId)
    return Boolean(context?.pluginsEnabled && context.enabled && context.manifest.contributes.panelView && enabledPluginRoot(pluginId))
  })
  mainState.pluginHostWindow?.sync(enabledPluginDescriptors())
  mainState.desktopTray?.rebuild()
}

export function pluginTrayCommands(): PluginTrayCommandItem[] {
  if (!mainState.pluginPreferencesSnapshot?.pluginsEnabled) return []
  const enabledIds = new Set(enabledPluginDescriptors().map(plugin => plugin.id))
  const candidates: PluginTrayCommandItem[] = []
  for (const [pluginId, context] of mainState.pluginRuntimeContexts) {
    if (!enabledIds.has(pluginId) || !context.manifest.contributes.tray) continue
    const commands = new Map((context.manifest.contributes.commands ?? []).map(command => [command.id, command] as const))
    for (const commandId of context.manifest.contributes.tray.commands) {
      const command = commands.get(commandId)
      if (!command) continue
      candidates.push({
        pluginId,
        pluginName: context.manifest.name,
        commandId,
        title: command.title,
      })
    }
  }
  candidates.sort((left, right) => (mainState.pluginEnableOrder.get(left.pluginId) ?? 0) - (mainState.pluginEnableOrder.get(right.pluginId) ?? 0))
  const omitted = new Set(candidates.slice(30).map(command => command.pluginId))
  for (const pluginId of omitted) {
    if (mainState.diagnosedPluginTrayOverflowIds.has(pluginId)) continue
    mainState.diagnosedPluginTrayOverflowIds.add(pluginId)
    mainState.pluginBroker?.recordSystemDiagnostic(pluginId, 'too_many_enabled', 'plugin.tray')
  }
  if (omitted.size === 0) mainState.diagnosedPluginTrayOverflowIds.clear()
  return candidates
}

export function broadcastPluginFeedUnreadCount(count = mainState.pluginFeedController?.unreadCount() ?? 0): void {
  queuePluginFeedUnreadCountBroadcast(count)
}

const queuePluginFeedUnreadCountBroadcast = createLatestValueCoalescer((count: number) => {
  for (const window of [mainState.petWindow, mainState.panelWindow]) {
    if (window && !window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.pluginFeedUnreadCount, count)
      window.webContents.send(IPC_CHANNELS.pluginNotificationsChanged)
    }
  }
})

const queuePluginEventSourceBroadcast = createLatestValueCoalescer((statuses: PluginEventSourceStatusView[]) => {
  if (mainState.panelWindow && !mainState.panelWindow.isDestroyed()) {
    mainState.panelWindow.webContents.send(IPC_CHANNELS.pluginEventSourceUpdated, statuses)
  }
})

export function broadcastPluginBadges(badges = mainState.pluginBadgeController?.list() ?? []): void {
  if (mainState.petWindow && !mainState.petWindow.isDestroyed()) mainState.petWindow.webContents.send(IPC_CHANNELS.pluginBadgesUpdated, badges)
}

export function isPluginFeedVisible(): boolean {
  return Boolean(mainState.petWindow && !mainState.petWindow.isDestroyed() && mainState.petWindow.isVisible()
    && mainState.petWindowMode === 'normal' && !mainState.windowsFullscreenAutoHiddenPet
    && !mainState.windowsFullscreenState.petDisplayFullscreen)
}

export function isPluginLinkHostAllowed(pluginId: string, host: string): boolean {
  const context = mainState.pluginRuntimeContexts.get(pluginId)
  if (!context) return false
  return context.grantedHosts.some((allowedHost) => {
    const normalized = allowedHost.toLowerCase()
    if (normalized.startsWith('*.')) {
      const suffix = normalized.slice(2)
      return host !== suffix && host.endsWith(`.${suffix}`)
    }
    return host === normalized
  })
}

export function requestPluginNetwork(
  networkSession: Electron.Session,
  url: string,
  init: RequestInit,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const headers = Object.fromEntries(new Headers(init.headers).entries())
    const request = net.request({
      url,
      method: init.method ?? 'GET',
      headers,
      session: networkSession,
      useSessionCookies: false,
      credentials: 'omit',
      redirect: 'manual',
      cache: 'no-store',
    })
    let settled = false
    const signal = init.signal
    let onAbort = () => {}
    const cleanup = () => signal?.removeEventListener('abort', onAbort)
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      callback()
    }
    onAbort = () => {
      try { request.abort() } catch {}
      finish(() => reject(new Error('Plugin network request aborted')))
    }

    request.removeHeader('Cookie')
    request.removeHeader('Accept-Language')
    request.setHeader('User-Agent', 'AgentPetsPlugin/1')
    request.on('redirect', (status, _method, redirectUrl) => {
      try { request.abort() } catch {}
      finish(() => resolve(new Response(null, { status, headers: { location: redirectUrl } })))
    })
    request.on('response', response => {
      const responseHeaders = new Headers()
      for (const [name, rawValue] of Object.entries(response.headers)) {
        if (name.toLowerCase() === 'set-cookie' || name.toLowerCase() === 'set-cookie2') continue
        const values = Array.isArray(rawValue) ? rawValue : typeof rawValue === 'string' ? [rawValue] : []
        for (const value of values) {
          try { responseHeaders.append(name, value) } catch {}
        }
      }
      const status = response.statusCode || 200
      // Node's bundled declarations model IncomingMessage as a different Readable/ReadableStream version than Response accepts; at runtime IncomingMessage is a Node Readable and toWeb produces the corresponding web stream.
      const body = status === 204 || status === 205 || status === 304
        ? null
        : Readable.toWeb(response as unknown as Readable) as unknown as ReadableStream<Uint8Array>
      try {
        const result = new Response(body, { status, headers: responseHeaders })
        finish(() => resolve(result))
      } catch (error) {
        finish(() => reject(error))
      }
    })
    request.on('error', error => finish(() => reject(error)))
    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    if (typeof init.body === 'string') request.write(init.body)
    request.end()
  })
}

// Plugin catalog（閘道與每日自動檢查）由獨立服務負責；保留這些匯出名稱，IPC registrar 與 main.ts 的接線不變。
export const pluginCatalogRuntime = createPluginCatalogRuntime({
  state: mainState,
  appVersion: () => app.getVersion(),
  translate: (key, params) => t(key, params),
})
export const createMainPluginCatalogGateway = pluginCatalogRuntime.gateway
export const checkPluginCatalogUpdates = pluginCatalogRuntime.checkUpdates
export const initializePluginCatalogAutoCheck = pluginCatalogRuntime.initializeAutoCheck
export { decodeCatalogBase64 }

// App 新版檢查（只提示、不下載安裝）由獨立服務負責；網路沿用 plugin 的 pluginNetworkClient。
export const appUpdateRuntime = createAppUpdateRuntime({
  state: mainState,
  userDataDirectory: () => appUserDataPaths().root,
  appVersion: () => app.getVersion(),
  translate: (key, params) => t(key, params),
  openExternal: url => shell.openExternal(url),
})

// Plugin runtime 組裝由獨立服務負責：`start()` 建立所有 plugin 服務，`dispose()` 依固定順序釋放。
// 保留 `createPluginServices` 這個匯出名稱，main.ts 的啟動步驟不變。
export const pluginRuntime = createPluginRuntime({
  state: mainState,
  userDataPaths: appUserDataPaths,
  pluginUiPreloadPath: join(__dirname, 'plugin-ui-preload.js'),
  tokensCss,
  electron: { ipcMain, session, safeStorage, nativeTheme, dialog, shell, app },
  createWebContentsView: options => new WebContentsView(options),
  createPluginHostWindow: options => new PluginHostWindowController(options),
  translate: (key, params) => t(key, params),
  locale,
  logMain,
  createMainPluginCatalogGateway,
  refreshPluginRuntimeContexts: () => refreshPluginRuntimeContexts(),
  syncPluginHost: () => syncPluginHost(),
  syncPanelThemes: () => syncPanelThemes(),
  enabledPluginRoot: pluginId => enabledPluginRoot(pluginId),
  enabledPluginSkinRecords: () => enabledPluginSkinRecords(),
  currentDesktopPreferences: () => currentDesktopPreferences(),
  isPluginFeedVisible: () => isPluginFeedVisible(),
  isPluginLinkHostAllowed: (pluginId, host) => isPluginLinkHostAllowed(pluginId, host),
  broadcastPluginBadges: badges => broadcastPluginBadges(badges),
  broadcastPluginFeedUnreadCount: count => broadcastPluginFeedUnreadCount(count),
  queuePluginEventSourceBroadcast: statuses => queuePluginEventSourceBroadcast(statuses),
  requestPluginNetwork: (networkSession, url, init) => requestPluginNetwork(networkSession, url, init),
  readRegularFileWithin: (root, relativePath, maxBytes) => readRegularFileWithin(root, relativePath, maxBytes),
  panelRendererOrigin: () => panelRendererOrigin(),
  assertTrustedIpcSender: (event, requiredWindow) => assertTrustedIpcSender(event, requiredWindow),
  assertPluginPanelSender: event => assertPluginPanelSender(event),
  isTrustedIpcSender: (event, requiredWindow) => isTrustedIpcSender(event, requiredWindow),
  pluginPanelError: error => pluginPanelError(error),
  pluginPanelSnapshot: () => pluginPanelSnapshot(),
  openPluginPanelViewForPlugin: (pluginId, openToken, frame, content) => openPluginPanelViewForPlugin(pluginId, openToken, frame, content),
  showPanelWindow: (view, pluginViewPluginId) => showPanelWindow(view, pluginViewPluginId),
  finiteNumber: value => finiteNumber(value),
  readPluginPanelRect: value => readPluginPanelRect(value),
})
export const createPluginServices = pluginRuntime.start

// 寵物視窗模式由獨立服務負責；保留這些匯出名稱，IPC registrar、托盤與建立視窗的接線不變。
export const petWindowModes = createPetWindowModeService({
  state: mainState,
  // 延後綁定：Electron 的 screen 模組要等 app ready 後才能使用。
  screen: {
    getDisplayMatching: rect => screen.getDisplayMatching(rect),
    getAllDisplays: () => screen.getAllDisplays(),
    getPrimaryDisplay: () => screen.getPrimaryDisplay(),
    getCursorScreenPoint: () => screen.getCursorScreenPoint(),
  },
  writeWindowState,
  edgeModeEnabled: () => currentDesktopPreferences().edgeModeEnabled,
  hasActivePermissionRequests: () => mainState.permissionBroker?.hasActiveRequests() ?? false,
  repositionPanel: () => repositionVisiblePanel(),
  onVisibilityChanged: () => mainState.pluginFeedController?.onVisibilityChanged(),
  onModeApplied: () => mainState.desktopTray?.rebuild(),
})

export const {
  clearEdgeDwell,
  cancelEdgeRedock,
  displayForBounds,
  displayForSavedState,
  scheduleShimejiPositionPersist,
  scheduleEdgeRedock,
  scheduleEdgeDwell,
} = petWindowModes
export const petModeState = petWindowModes.modeState
export const broadcastPetWindowMode = petWindowModes.broadcastMode
export const persistCurrentPetWindowState = petWindowModes.persistCurrentState
export const applyNormalPetBounds = petWindowModes.applyNormalBounds
export const setPetWindowMode = petWindowModes.setMode
export const toggleMiniMode = petWindowModes.toggleMini
export const rehomePetWindowForDisplayChange = petWindowModes.rehomeForDisplayChange

export function applyPetCaptureProtection(): void {
  if (!mainState.petWindow || mainState.petWindow.isDestroyed()) return
  const preferences = currentDesktopPreferences()
  if (!preferences.visibilityCapabilities.captureExclusion.supported) {
    mainState.petCaptureProtectionApplied = null
    return
  }
  if (typeof mainState.petWindow.setContentProtection !== 'function') return
  const enabled = preferences.captureExclusionEnabled
  // A newly-created window is unprotected by default. Avoid a redundant
  // `setContentProtection(false)` call when the preference is already off;
  // disabling still calls the native API once after an earlier enable.
  if (mainState.petCaptureProtectionApplied === enabled
    || (mainState.petCaptureProtectionApplied === null && !enabled)) return
  try {
    // Only the pet window is excluded. The settings/panel window remains
    // capturable so users can include their configuration or status view.
    mainState.petWindow.setContentProtection(enabled)
    mainState.petCaptureProtectionApplied = enabled
  } catch (error) {
    console.error('Failed to apply pet capture protection', error)
  }
}

export function applyMacFullscreenVisibilityPolicy(): void {
  if (!IS_MAC) return
  const preferences = currentDesktopPreferences()
  if (!preferences.visibilityCapabilities.fullscreenAutoHide.supported) return
  const visibleOnFullScreen = macVisibleOnFullScreen(
    preferences.fullscreenAutoHideEnabled,
    mainState.permissionAttentionCount > 0,
  )
  for (const window of [mainState.petWindow, mainState.panelWindow]) {
    if (!window || window.isDestroyed()) continue
    try {
      // macOS Spaces owns the transition for another app's fullscreen window;
      // Electron has no trustworthy cross-app fullscreen event to proxy here.
      // Keep Electron's default process-type handling. skipTransformProcessType
      // is only safe when the app is already known to be an UIElement app;
      // Agent Pets is not configured that way, and the original window path
      // relied on Electron performing the required transform.
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen })
    } catch (error) {
      console.error('Failed to apply macOS fullscreen visibility policy', error)
    }
  }
}

export function localPorts() {
  return resolveLocalPorts(process.env, app.isPackaged)
}

export function serverHealthTracker(): ServerHealthTracker {
  if (!mainState.serverHealth) {
    mainState.serverHealth = createServerHealthTracker({
      onChange: snapshot => {
        for (const window of [mainState.petWindow, mainState.panelWindow]) {
          if (window && !window.isDestroyed()) window.webContents.send(IPC_CHANNELS.serverHealthChanged, snapshot)
        }
      },
      onPersistentFailure: health => {
        try {
          if (!Notification.isSupported()) return
          new Notification({
            title: t('reliability.server.offlineTitle'),
            body: t(health.code === 'EADDRINUSE' ? 'reliability.server.portBusyBody' : 'reliability.server.failedBody', { port: health.port }),
          }).show()
        } catch {}
      },
    })
  }
  return mainState.serverHealth
}

const rendererRecoveries = new Map<'pet' | 'panel', RendererRecovery>()

// Re-pushes main-owned state after a renderer crash/reload. Initial load
// broadcasts only run once, so a recovered renderer would otherwise sit with
// stale defaults (power-save, window mode, badges, progression, permissions).
function resyncRendererState(): void {
  broadcastPetWindowMode()
  broadcastPowerSaveState()
  broadcastPluginBadges()
  broadcastPluginFeedUnreadCount()
  broadcastProgression()
  broadcastAchievements()
  broadcastHistoryUpdated()
  schedulePermissionUiSync()
  try { broadcastDesktopPreferences(currentDesktopPreferences()) } catch {}
}

function attachWindowRecovery(label: 'pet' | 'panel', window: BrowserWindow): void {
  rendererRecoveries.get(label)?.dispose()
  const contents = window.webContents
  const recovery = attachRendererRecovery(contents, {
    label,
    reload: () => { if (!contents.isDestroyed()) contents.reload() },
    log: (level, message) => (level === 'error' ? console.error(message) : console.warn(message)),
    onRecovered: resyncRendererState,
    onGaveUp: () => {
      try {
        if (!Notification.isSupported()) return
        new Notification({
          title: t('reliability.renderer.gaveUpTitle'),
          body: t('reliability.renderer.gaveUpBody'),
        }).show()
      } catch {}
    },
  })
  rendererRecoveries.set(label, recovery)
  window.once('closed', () => {
    recovery.dispose()
    if (rendererRecoveries.get(label) === recovery) rendererRecoveries.delete(label)
  })
}

/** Tray / error-boundary rescue: reloads pet and panel renderers, rebuilding a window that is gone. */
export function reloadPetRenderers(): void {
  if (!ensureDesktopWindows()) return
  for (const recovery of rendererRecoveries.values()) recovery.manualReload()
}

export function createPetWindow() {
  if (mainState.petWindow && !mainState.petWindow.isDestroyed()) return
  const primaryWorkArea = screen.getPrimaryDisplay().workArea
  const rawScale = parseFloat(process.env.PET_SCALE || '1')
  const scale = clamp(isNaN(rawScale) ? 1 : rawScale, 0.3, 5)

  // Restore wherever the user last dragged it to, rather than always
  // snapping back to the bottom-right default on every relaunch.
  const saved = readWindowState()
  const initialBounds = petWindowModes.restore(saved, {
    fallbackSize: initialPetWindowSize(scale),
    primaryWorkArea,
  })

  mainState.petWindow = new BrowserWindow({
    width: initialBounds.width,
    height: initialBounds.height,
    x: initialBounds.x,
    y: initialBounds.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    // Windows only: a frameless window still gets the WS_THICKFRAME resize
    // border by default, which makes DWM apply its normal non-client move
    // animation the instant the window is grabbed — visible as the whole
    // pet sliding down a few pixels before drag tracking kicks in. Disabling
    // it removes that OS-level animation so drag tracks the cursor exactly.
    thickFrame: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      devTools: !app.isPackaged,
    },
  })
  mainState.petCaptureProtectionApplied = null

  mainState.petWindow.once('ready-to-show', syncPluginHost)

  secureRendererWindow(mainState.petWindow)

  mainState.petWindow.setIgnoreMouseEvents(false)

  // Without this, macOS ties the window to the Space it was created on —
  // alwaysOnTop alone does not make it follow you across a Space switch.
  // No Windows equivalent: virtual-desktop pinning there is a per-window
  // right-click toggle in Task View, not something Electron can set for us.
  applyPetCaptureProtection()
  applyMacFullscreenVisibilityPolicy()

  attachWindowRecovery('pet', mainState.petWindow)
  const petLoad = process.env.VITE_DEV_SERVER_URL && !app.isPackaged
    ? mainState.petWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    : mainState.petWindow.loadURL('agent-pets://app/index.html')
  petLoad.catch(error => console.error('Pet renderer load failed', error))

  mainState.petWindow.webContents.once('did-finish-load', () => {
    broadcastPetWindowMode()
  })

  mainState.petWindow.on('close', (event) => {
    if (mainState.isQuitting) return
    event.preventDefault()
    hidePetWindow()
  })
  mainState.petWindow.on('show', () => {
    mainState.pluginFeedController?.onVisibilityChanged()
    mainState.desktopTray?.rebuild()
    schedulePermissionUiSync()
  })
  mainState.petWindow.on('hide', () => {
    mainState.pluginFeedController?.onVisibilityChanged()
    mainState.desktopTray?.rebuild()
    schedulePermissionUiSync()
  })

  attachBroadcastResync(mainState.petWindow)
  mainState.petWindow.on('closed', () => {
    mainState.petWindow = null
    mainState.windowsFullscreenAutoHiddenPet = false
    mainState.petCaptureProtectionApplied = null
    mainState.anchorBottomCenter = null
    mainState.normalPetBounds = null
    mainState.edgeRestoreBounds = null
    mainState.petWindowEdge = null
    clearEdgeDwell()
    if (mainState.shimejiPersistHandle) {
      clearTimeout(mainState.shimejiPersistHandle)
      mainState.shimejiPersistHandle = null
    }
    if (mainState.resizeAnimHandle) {
      clearInterval(mainState.resizeAnimHandle)
      mainState.resizeAnimHandle = null
    }
    mainState.panelWindow?.close()
    syncWindowsFullscreenTargets()
  })

  syncWindowsFullscreenTargets()
}

// The panel is a separate always-on-top window rather than sharing the pet's
// window, so opening/closing or resizing it (Sessions <-> Settings) never
// moves or resizes the pet itself.
export function createPanelWindow() {
  // Idempotent: the first-run wizard or a pet click can create the panel on demand
  // before the startup step reaches it. A second window would orphan the first
  // renderer (its IPC would be rejected as untrusted) and its 'closed' event would
  // then clear the live reference.
  if (mainState.panelWindow && !mainState.panelWindow.isDestroyed()) return
  const panelWindow = new BrowserWindow({
    ...currentPanelSize(),
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    // Always user-resizable (every view); limits come from applyPanelWindowLimits.
    resizable: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      devTools: !app.isPackaged,
    },
  })
  mainState.panelWindow = panelWindow

  mainState.panelWindow.on('hide', () => mainState.pluginPanelViewController?.onPanelWindowHidden())
  mainState.panelWindow.on('show', () => {
    if (!mainState.panelWindow || mainState.panelWindow.isDestroyed()) return
    const contentBounds = mainState.panelWindow.getContentBounds()
    mainState.pluginPanelViewController?.relayout({ width: contentBounds.width, height: contentBounds.height })
  })
  mainState.panelWindow.webContents.on('did-start-loading', () => mainState.pluginPanelViewController?.onPanelRendererReload())
  // 'will-resize' (macOS / Windows) fires only for user-initiated resizes, never for setBounds.
  mainState.panelWindow.on('will-resize', () => { mainState.lastUserPanelResizeAt = Date.now() })
  mainState.panelWindow.on('resize', () => {
    if (!mainState.panelWindow || mainState.panelWindow.isDestroyed()) return
    const contentBounds = mainState.panelWindow.getContentBounds()
    mainState.pluginPanelViewController?.relayout({ width: contentBounds.width, height: contentBounds.height })
    if (!shouldRecordUserPanelSize({
      visible: mainState.panelWindow.isVisible(),
      now: Date.now(),
      supportsWillResize: process.platform === 'darwin' || process.platform === 'win32',
      lastUserResizeAt: mainState.lastUserPanelResizeAt,
      programmaticUntil: mainState.programmaticPluginPanelUntil,
    })) return
    const [width, height] = mainState.panelWindow.getSize()
    recordUserPanelSize({ width, height })
  })

  secureRendererWindow(mainState.panelWindow)

  applyMacFullscreenVisibilityPolicy()

  attachWindowRecovery('panel', mainState.panelWindow)
  const panelLoad = process.env.VITE_DEV_SERVER_URL && !app.isPackaged
    ? mainState.panelWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}#panel`)
    : mainState.panelWindow.loadURL('agent-pets://app/index.html#panel')
  panelLoad.catch(error => console.error('Panel renderer load failed', error))

  mainState.panelWindow.on('blur', () => {
    // Clicking the pet focuses petWindow just before the click handler's
    // 'panel-toggle' IPC arrives — if we hid on blur here too, the toggle
    // would then see the panel already hidden and reopen it (a flicker,
    // and clicking the pet could never close the panel). Let the toggle
    // handler own that case; blur-hide is only for genuine click-outside.
    if (!shouldHidePanelOnBlur(currentPanelBlurState())) return
    schedulePanelBlurHide()
  })

  attachBroadcastResync(mainState.panelWindow)
  mainState.panelWindow.on('closed', () => {
    // Only the window that is still current may clear shared state.
    if (mainState.panelWindow !== panelWindow) return
    mainState.pluginPanelViewController?.close()
    if (mainState.panelBlurHideHandle) clearTimeout(mainState.panelBlurHideHandle)
    mainState.panelBlurHideHandle = null
    mainState.panelWindow = null
    mainState.panelModalOpen = false
    mainState.windowsFullscreenAutoHiddenPanel = false
    syncWindowsFullscreenTargets()
  })

  syncWindowsFullscreenTargets()
}

// ── Panel size: one user-owned size for every view ───────────────────────────
// 尺寸與定位邏輯在 panel-geometry.ts；這裡只綁定 Electron 的 screen、尺寸檔與結束時 flush。
const panelGeometry = createPanelGeometry({
  state: mainState,
  screen: {
    getDisplayMatching: rect => screen.getDisplayMatching(rect),
    getPrimaryDisplay: () => screen.getPrimaryDisplay(),
  },
  createSizeStore: () => {
    const store = new PanelSizeStore(appUserDataPaths().panelSize)
    app.once('before-quit', () => store.flush())
    return store
  },
})

export const {
  computePanelBounds,
  currentPanelSize,
  applyPanelWindowLimits,
  setPluginPanelWindowBounds,
  requestPanelMinimum,
  resetPanelSize,
  repositionVisiblePanel,
} = panelGeometry
const { applyCurrentPanelSize, recordUserPanelSize } = panelGeometry

export async function openPluginPanelViewForPlugin(
  pluginId: string,
  openToken: number,
  frameValue: unknown,
  contentValue: unknown,
) {
  const context = mainState.pluginRuntimeContexts.get(pluginId)
  const panelView = context?.manifest.contributes.panelView
  if (!isPluginPanelPluginId(pluginId) || !panelView || !context?.pluginsEnabled || !context.enabled
    || !enabledPluginRoot(pluginId) || !mainState.panelWindow || mainState.panelWindow.isDestroyed() || !mainState.pluginPanelViewController) {
    return { ok: false as const, error: panelView ? 'disabled' : 'not_permitted' }
  }
  if (!mainState.panelWindow.isVisible()) return { ok: false as const, error: 'panel_unavailable' }
  if (!mainState.pluginPanelViewController.canOpenToken(openToken)) return { ok: false as const, error: 'invalid_request' }
  const contentBounds = mainState.panelWindow.getContentBounds()
  const bounds = validatePluginPanelViewBounds(
    readPluginPanelRect(frameValue) ?? { x: -1, y: -1, width: 0, height: 0 },
    readPluginPanelRect(contentValue) ?? { x: -1, y: -1, width: 0, height: 0 },
    { width: contentBounds.width, height: contentBounds.height },
  )
  if (!bounds) return { ok: false as const, error: 'panel_unavailable' }
  mainState.pluginPanelViewController.close('replaced')
  return mainState.pluginPanelViewController.open({ pluginId, entry: panelView.entry, openToken, bounds })
}

// Status-line count can flap as agents come and go, so coalesce the writes
// instead of hitting disk on every resize.

export function persistPetBounds(x: number, y: number, width: number, height: number) {
  if (mainState.persistBoundsHandle) clearTimeout(mainState.persistBoundsHandle)
  mainState.persistBoundsHandle = setTimeout(() => {
    mainState.persistBoundsHandle = null
    const current = { x, y, width, height }
    if (mainState.petWindowMode === 'normal') mainState.normalPetBounds = current
    persistCurrentPetWindowState()
  }, 1_000)
}

export function ensureDesktopWindows(): boolean {
  if (!app.isReady()) return false
  if (!mainState.petWindow || mainState.petWindow.isDestroyed()) createPetWindow()
  if (!mainState.panelWindow || mainState.panelWindow.isDestroyed()) createPanelWindow()
  return Boolean(mainState.petWindow && mainState.panelWindow)
}

export function showPetWindow(): void {
  if (!ensureDesktopWindows() || !mainState.petWindow) return
  mainState.windowsFullscreenAutoHiddenPet = false
  if (mainState.petWindow.isMinimized()) mainState.petWindow.restore()
  // With fullscreen exclusion enabled, showing the pet from the Tray must not
  // steal focus or pull another app's fullscreen Space away on macOS.
  if (IS_MAC && currentDesktopPreferences().fullscreenAutoHideEnabled) {
    mainState.petWindow.showInactive()
  } else {
    mainState.petWindow.show()
    mainState.petWindow.focus()
  }
  mainState.desktopTray?.rebuild()
}

export function hidePetWindow(): void {
  if (mainState.panelBlurHideHandle) clearTimeout(mainState.panelBlurHideHandle)
  mainState.panelBlurHideHandle = null
  mainState.windowsFullscreenAutoHiddenPet = false
  mainState.windowsFullscreenAutoHiddenPanel = false
  mainState.panelWindow?.hide()
  mainState.petWindow?.hide()
  mainState.desktopTray?.rebuild()
}

const PANEL_REVEAL_FRAME_TIMEOUT_MS = 400
let panelRevealSequence = 0

// 隱藏後重新顯示時，宿主與插件子視圖的新 frame 不一定同時送達；插件晚到的那段時間只看得到內容區底色，
// 看起來就是閃一下。呼叫端先以透明度 0 顯示，這裡等目前可見的畫面都送出第一個 frame（或逾時）才顯示。
function revealPanelWindowAfterFirstFrame(panelWindow: BrowserWindow): void {
  const sequence = ++panelRevealSequence
  const contents = [panelWindow.webContents, ...panelWindow.contentView.children
    .filter((view): view is WebContentsView => view instanceof WebContentsView && view.getVisible())
    .map(view => view.webContents)]
  let pending = contents.length
  let done = false
  const finish = () => {
    if (done) return
    done = true
    clearTimeout(timer)
    for (const item of contents) {
      try { if (!item.isDestroyed()) item.endFrameSubscription() } catch {}
    }
    if (sequence === panelRevealSequence && !panelWindow.isDestroyed()) panelWindow.setOpacity(1)
  }
  const timer = setTimeout(finish, PANEL_REVEAL_FRAME_TIMEOUT_MS)
  for (const item of contents) {
    let painted = false
    try {
      item.beginFrameSubscription(false, () => {
        if (painted) return
        painted = true
        if (--pending === 0) finish()
      })
    } catch {
      if (--pending === 0) finish()
    }
  }
}

// `restore` 沿用面板上次關閉時的畫面（含暫停中的插件畫面與視窗尺寸），只依寵物位置重新定位；
// 其他 view 是明確導向，會先關閉暫停中的插件畫面再切換。
export function showPanelWindow(view: 'sessions' | 'settings' | 'restore' = 'sessions', pluginViewPluginId?: string): void {
  if (!ensureDesktopWindows() || !mainState.panelWindow) return
  if (rendererRecoveries.get('panel')?.state().gaveUp) {
    // The panel renderer is dead and out of retries; show a fresh window
    // rather than a broken one.
    const broken = mainState.panelWindow
    mainState.panelWindow = null
    try { broken.destroy() } catch {}
    createPanelWindow()
    if (!mainState.panelWindow) return
  }
  const restore = view === 'restore'
  if (!restore) mainState.pluginPanelViewController?.close(mainState.panelWindow.isVisible() ? 'closed' : 'hidden')
  if (mainState.panelBlurHideHandle) clearTimeout(mainState.panelBlurHideHandle)
  mainState.panelBlurHideHandle = null
  mainState.windowsFullscreenAutoHiddenPanel = false
  if (mainState.petWindowMode === 'edge') applyNormalPetBounds()
  showPetWindow()
  // The same user-owned size for every view; only the anchor (the pet) can move it.
  applyCurrentPanelSize()
  const wasHidden = !mainState.panelWindow.isVisible()
  if (wasHidden) {
    mainState.panelWindow.setOpacity(0)
  } else {
    panelRevealSequence += 1
    mainState.panelWindow.setOpacity(1)
  }
  // Opening a panel is an explicit user action (Tray item, notification, or
  // pet click), so it must remain keyboard-usable even when fullscreen
  // exclusion is enabled. The macOS Space collection policy still decides
  // which Space the window may occupy.
  mainState.panelWindow.show()
  mainState.panelWindow.focus()
  if (wasHidden) revealPanelWindowAfterFirstFrame(mainState.panelWindow)

  const notifyRenderer = () => {
    if (!mainState.panelWindow || mainState.panelWindow.isDestroyed()) return
    mainState.panelWindow.webContents.send(IPC_CHANNELS.panelOpened, { restore })
    if (view === 'settings') mainState.panelWindow.webContents.send(IPC_CHANNELS.panelOpenSettings)
    if (view === 'settings' && pluginViewPluginId) mainState.panelWindow.webContents.send(IPC_CHANNELS.panelOpenPluginView, pluginViewPluginId)
  }
  if (mainState.panelWindow.webContents.isLoading()) {
    mainState.panelWindow.webContents.once('did-finish-load', notifyRenderer)
  } else {
    notifyRenderer()
  }
}

export function currentDesktopPreferences(): DesktopPreferences {
  if (!mainState.desktopPreferences) {
    return {
      dndEnabled: false,
      dndUntil: null,
      notificationsEnabled: true,
      permissionBubbleEnabled: true,
      claudePermissionRespondEnabled: false,
      claudePermissionWaitSeconds: CLAUDE_PERMISSION_WAIT_DEFAULT_SECONDS,
      presentationMcpEnabled: true,
      achievementsEnabled: true,
      edgeModeEnabled: false,
      shimejiEnabled: false,
      captureExclusionEnabled: false,
      fullscreenAutoHideEnabled: false,
      rightClickHideEnabled: false,
      completionMarkersEnabled: true,
      sessionJumpEnabled: true,
      sessionJumpSwitchAppEnabled: true,
      soundEnabled: false,
      soundVolume: 60,
      soundOnPermission: true,
      soundOnError: true,
      soundOnSuccess: true,
      launchAtStartup: false,
      launchAtStartupSupported: false,
      launchAtStartupStatus: 'unsupported',
      locale: 'zh-TW',
      visibilityCapabilities: currentDesktopVisibilityCapabilities(),
    }
  }
  return mainState.desktopPreferences.get()
}

export function broadcastDesktopPreferences(preferences: DesktopPreferences): void {
  for (const window of [mainState.petWindow, mainState.panelWindow]) {
    if (window && !window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.desktopPreferencesUpdated, preferences)
    }
  }
}

export function currentPowerSaveState(): boolean {
  try {
    return powerMonitor.isOnBatteryPower()
  } catch {
    return false
  }
}

export function broadcastPowerSaveState(): void {
  const powerSave = currentPowerSaveState()
  for (const window of [mainState.petWindow, mainState.panelWindow]) {
    if (window && !window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.powerSaveStateUpdated, powerSave)
    }
  }
}

export function currentDesktopVisibilityCapabilities() {
  return desktopVisibilityCapabilitiesForPlatform(
    process.platform,
    typeof BrowserWindow.prototype.setContentProtection === 'function',
    mainState.windowsFullscreenDetector?.available === true,
  )
}

export function sameDesktopVisibilityCapabilities(
  left: ReturnType<typeof currentDesktopVisibilityCapabilities>,
  right: ReturnType<typeof currentDesktopVisibilityCapabilities>,
): boolean {
  return left.captureExclusion.supported === right.captureExclusion.supported
    && left.captureExclusion.mode === right.captureExclusion.mode
    && left.fullscreenAutoHide.supported === right.fullscreenAutoHide.supported
    && left.fullscreenAutoHide.mode === right.fullscreenAutoHide.mode
}

export function syncDesktopVisibilityCapabilities(): DesktopPreferences | null {
  if (!mainState.desktopPreferences) return null
  const current = mainState.desktopPreferences.get()
  const capabilities = currentDesktopVisibilityCapabilities()
  if (sameDesktopVisibilityCapabilities(current.visibilityCapabilities, capabilities)) {
    return current
  }
  const next = mainState.desktopPreferences.setVisibilityCapabilities(capabilities)
  setLocale(next.locale)
  broadcastDesktopPreferences(next)
  schedulePermissionUiSync()
  return next
}

export function nativeWindowHandleFor(window: BrowserWindow | null): bigint | null {
  if (!window || window.isDestroyed()) return null
  try {
    return nativeWindowHandleToPointer(window.getNativeWindowHandle())
  } catch (error) {
    console.error('Failed to read a Windows native window handle', error)
    return null
  }
}

export function syncWindowsFullscreenTargets(): void {
  if (!mainState.windowsFullscreenDetector) return
  mainState.windowsFullscreenDetector.setTargetWindows({
    pet: nativeWindowHandleFor(mainState.petWindow),
    panel: nativeWindowHandleFor(mainState.panelWindow),
  })
}

export function restoreWindowsHiddenByFullscreen(): void {
  if (mainState.windowsFullscreenAutoHiddenPet) {
    mainState.windowsFullscreenAutoHiddenPet = false
    if (mainState.petWindow && !mainState.petWindow.isDestroyed() && !mainState.petWindow.isVisible()) {
      mainState.petWindow.showInactive()
    }
  }
  if (mainState.windowsFullscreenAutoHiddenPanel) {
    mainState.windowsFullscreenAutoHiddenPanel = false
    if (mainState.panelWindow && !mainState.panelWindow.isDestroyed() && !mainState.panelWindow.isVisible()) {
      mainState.panelWindow.showInactive()
    }
  }
}

function currentPanelBlurState() {
  return {
    dialogOpen: mainState.dialogOpen,
    petFocused: mainState.petWindow?.isFocused() ?? false,
    pinned: mainState.panelPinned,
    modalOpen: mainState.panelModalOpen,
  }
}

export function schedulePanelBlurHide(): void {
  if (mainState.panelBlurHideHandle) clearTimeout(mainState.panelBlurHideHandle)
  mainState.panelBlurHideHandle = setTimeout(() => {
    mainState.panelBlurHideHandle = null
    if (!mainState.panelWindow || mainState.panelWindow.isDestroyed() || mainState.panelWindow.isFocused() || !mainState.panelWindow.isVisible()) {
      return
    }
    // A pin / wizard can be engaged during the grace delay.
    if (mainState.panelPinned || mainState.panelModalOpen) return
    // Give the Win32 detector's event-driven refresh a chance to classify an
    // external fullscreen transition before treating the blur as a manual
    // click-away. This preserves the marker needed to restore an open panel.
    if (process.platform === 'win32' && mainState.windowsFullscreenState.panelDisplayFullscreen) return
    mainState.windowsFullscreenAutoHiddenPanel = false
    mainState.panelWindow.hide()
  }, PANEL_BLUR_HIDE_DELAY_MS)
}

export function applyWindowsFullscreenAutoHideState(state: WindowsFullscreenState): void {
  mainState.windowsFullscreenState = state
  mainState.pluginFeedController?.onVisibilityChanged()
  if (process.platform !== 'win32') return

  const preferences = syncDesktopVisibilityCapabilities() ?? currentDesktopPreferences()
  if (
    !preferences.visibilityCapabilities.fullscreenAutoHide.supported
    || !preferences.fullscreenAutoHideEnabled
    || (mainState.permissionBroker?.hasActiveRequests() ?? false)
  ) {
    restoreWindowsHiddenByFullscreen()
    return
  }

  if (state.petDisplayFullscreen) {
    if (mainState.petWindow && !mainState.petWindow.isDestroyed() && mainState.petWindow.isVisible()) {
      mainState.windowsFullscreenAutoHiddenPet = true
      mainState.petWindow.hide()
    }
  } else if (mainState.windowsFullscreenAutoHiddenPet) {
    mainState.windowsFullscreenAutoHiddenPet = false
    if (mainState.petWindow && !mainState.petWindow.isDestroyed() && !mainState.petWindow.isVisible()) {
      mainState.petWindow.showInactive()
    }
  }

  if (state.panelDisplayFullscreen) {
    if (mainState.panelWindow && !mainState.panelWindow.isDestroyed() && mainState.panelWindow.isVisible()) {
      mainState.windowsFullscreenAutoHiddenPanel = true
      mainState.panelWindow.hide()
    }
  } else if (mainState.windowsFullscreenAutoHiddenPanel) {
    mainState.windowsFullscreenAutoHiddenPanel = false
    if (mainState.panelWindow && !mainState.panelWindow.isDestroyed() && !mainState.panelWindow.isVisible()) {
      mainState.panelWindow.showInactive()
    }
  }
}

export function createWindowsFullscreenServices(): void {
  if (process.platform !== 'win32' || mainState.windowsFullscreenDetector) return
  const detector = createWindowsFullscreenDetector(applyWindowsFullscreenAutoHideState)
  mainState.windowsFullscreenDetector = detector
  if (!detector.start()) {
    console.warn('Windows fullscreen auto-hide is unavailable; keeping the setting disabled')
  }
}

let dndExpiryTimer: ReturnType<typeof setTimeout> | null = null

// A timed Do Not Disturb ends by itself; when it does, summarise what was
// silenced so the user is not left wondering what they missed.
function scheduleDndExpiry(preferences: DesktopPreferences): void {
  if (dndExpiryTimer) clearTimeout(dndExpiryTimer)
  dndExpiryTimer = null
  if (!preferences.dndEnabled || preferences.dndUntil === null) return
  const delay = Math.min(Math.max(0, preferences.dndUntil - Date.now()) + 50, 2_147_483_647)
  dndExpiryTimer = setTimeout(() => {
    dndExpiryTimer = null
    const missed = mainState.desktopNotifications?.takeDndMissedCount() ?? 0
    updateDesktopPreferences({ dndEnabled: false, dndUntil: null })
    if (missed > 0) mainState.desktopNotifications?.showDndSummary(missed)
  }, delay)
  dndExpiryTimer.unref?.()
}

export function updateDesktopPreferences(patch: unknown): DesktopPreferences {
  if (!mainState.desktopPreferences) throw new Error('Desktop preferences are not ready')
  const previousPreferences = mainState.desktopPreferences.get()
  const achievementsWereEnabled = previousPreferences.achievementsEnabled
  const preferences = mainState.desktopPreferences.update(patch)
  if (previousPreferences.dndEnabled !== preferences.dndEnabled) mainState.pluginFeedController?.onVisibilityChanged()
  if (
    previousPreferences.claudePermissionRespondEnabled !== preferences.claudePermissionRespondEnabled
    || previousPreferences.claudePermissionWaitSeconds !== preferences.claudePermissionWaitSeconds
  ) applyClaudePermissionRespond(preferences)
  scheduleDndExpiry(preferences)
  setLocale(preferences.locale)
  if (!preferences.edgeModeEnabled && mainState.petWindowMode === 'edge') applyNormalPetBounds()
  applyPetCaptureProtection()
  applyMacFullscreenVisibilityPolicy()
  applyWindowsFullscreenAutoHideState(mainState.windowsFullscreenState)
  mainState.windowsFullscreenDetector?.refresh()
  if (!preferences.presentationMcpEnabled || preferences.dndEnabled) {
    mainState.presentationController?.clear()
  }
  mainState.desktopTray?.rebuild()
  broadcastDesktopPreferences(preferences)
  schedulePermissionUiSync()
  if (!achievementsWereEnabled && preferences.achievementsEnabled) {
    growth.reconcileFromHistory()
  }
  return preferences
}

export function unregisterPermissionHotkeys(): void {
  if (!app.isReady()) return
  permissionHotkeys?.clear()
}

export function syncTrayAttention(): void {
  mainState.desktopTray?.setAttention(mainState.desktopNotifications?.getAttention() ?? EMPTY_ATTENTION)
}

export function broadcastPermissionRequests(): void {
  const listed = mainState.permissionBroker?.listRequests() ?? []
  if (listed.length > 0 && mainState.petWindowMode !== 'normal') {
    applyNormalPetBounds()
  }
  const hadPermissionRequests = mainState.permissionAttentionCount > 0
  mainState.permissionAttentionCount = listed.length
  if (hadPermissionRequests !== listed.length > 0) applyMacFullscreenVisibilityPolicy()
  if (mainState.desktopNotifications) mainState.desktopNotifications.setPermissionRequests(listed)
  else syncTrayAttention()

  const top = listed[0]
  const hotkeyInfo = app.isReady()
    ? getPermissionHotkeys().sync(
      top,
      Boolean(
        currentDesktopPreferences().permissionBubbleEnabled
        && mainState.petWindow
        && !mainState.petWindow.isDestroyed()
        && mainState.petWindow.isVisible(),
      ),
    )
    : null
  const requests = attachHotkeyInfo(listed, hotkeyInfo)
  for (const window of [mainState.petWindow, mainState.panelWindow]) {
    if (window && !window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.permissionRequestsUpdated, requests)
    }
  }
}

const historySender = createVisibleSender<BrowserWindow>()

function sendHistoryUpdatedTo(window: BrowserWindow): void {
  window.webContents.send(IPC_CHANNELS.historyUpdated)
}

// Hidden windows skip progression/history pushes; on show they get exactly one
// resync so a stale pet or panel never stays behind.
function attachBroadcastResync(window: BrowserWindow): void {
  window.on('show', () => {
    growth.resyncProgression(window)
    historySender.resync(window, sendHistoryUpdatedTo)
  })
}

// 成就、progression store 與其廣播由 growth 服務負責；這裡保留原本的匯出名稱，讓 main.ts 與 IPC 不需改動。
export const growth = createGrowthService({
  state: mainState,
  getWindows: () => [mainState.petWindow, mainState.panelWindow],
  openProgressionStore: () => new ProgressionStore(appUserDataPaths().progression),
  openAchievementStore: () => new AchievementStore(appUserDataPaths().achievements),
  achievementsEnabled: () => currentDesktopPreferences().achievementsEnabled,
  logError: (message, error) => console.error(message, error),
  logMain,
})

export const createProgressionServices = growth.startProgression
export const createAchievementServices = growth.startAchievements
export const broadcastProgression = growth.broadcastProgression
export const broadcastAchievements = growth.broadcastAchievements
export const setActiveProgressionPet = growth.setActivePet

export function currentHistorySummary(projectId?: string, rangeDays = 7): HistorySummary | null {
  if (!mainState.historyStore) return null
  const summary = mainState.historyStore.getSummary(mainState.progressionStore?.getActivePetId() ?? DEFAULT_PET_ID, projectId, rangeDays)
  const scan = mainState.localUsageReader?.getDiagnostics()
  return scan
    ? {
        ...summary,
        scan: {
          finishedAt: scan.finishedAt,
          durationMs: scan.durationMs,
          filesScanned: scan.filesScanned,
          filesSkipped: scan.filesSkipped,
          filesDeferred: scan.filesDeferred,
        },
      }
    : summary
}

function flushHistoryUpdated(): void {
  for (const window of [mainState.petWindow, mainState.panelWindow]) {
    historySender.send(window, sendHistoryUpdatedTo)
  }
}

const HISTORY_UPDATED_COALESCE_MS = 1000
const queueHistoryUpdated = createLatestValueCoalescer<void>(
  flushHistoryUpdated,
  callback => { setTimeout(callback, HISTORY_UPDATED_COALESCE_MS).unref?.() },
)

/** At most one historyUpdated per ~1s regardless of event rate. */
export function broadcastHistoryUpdated(): void {
  queueHistoryUpdated()
}

export function broadcastPresentationIntent(intent: PresentationIntent): void {
  for (const window of [mainState.petWindow, mainState.panelWindow]) {
    if (window && !window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.presentationIntent, intent)
    }
  }
}

export function createPresentationServices(presentationToken: string): void {
  if (mainState.presentationController || mainState.presentationMcpServer) return

  mainState.presentationController = new PresentationController({
    emit: broadcastPresentationIntent,
    getStatus: () => {
      const preferences = currentDesktopPreferences()
      return normalizePresentationStatus({
        ...mainState.presentationStatusProjection,
        dnd: preferences.dndEnabled,
        enabled: preferences.presentationMcpEnabled,
      })
    },
    getBlockReason: () => {
      const preferences = currentDesktopPreferences()
      if (!preferences.presentationMcpEnabled) return 'disabled'
      if (preferences.dndEnabled) return 'dnd_enabled'
      return null
    },
  })

  const server = createPresentationMcpServer({
    token: presentationToken,
    controller: mainState.presentationController,
  })
  const presentationHealth = serverHealthTracker().register('presentation', localPorts().presentation)
  const presentationHandle = listenOnLocalPort(server, localPorts().presentation, {
    label: 'Presentation MCP',
    onStatus: presentationHealth.onStatus,
    onPersistentFailure: presentationHealth.onPersistentFailure,
    onListening: () => {
      if (!app.isPackaged) console.log(`Presentation MCP control listening on http://127.0.0.1:${localPorts().presentation}`)
    },
  })
  presentationHealth.attach(presentationHandle)
  mainState.presentationMcpServer = server
}

// 歷史資料庫、本機用量掃描與它們的計時器由獨立服務負責；成就與廣播留在這裡，以回呼傳入。
export const historyRuntime = createHistoryRuntimeService({
  state: mainState,
  databasePath: () => appUserDataPaths().history,
  openStore: databasePath => new HistoryStore(databasePath),
  createLocalUsageReader: options => new LocalUsageReader(options),
  homeDir: () => app.getPath('home'),
  configDirs: () => {
    const { claude, codex } = currentAgentConfigDirs()
    return { claude: claude.path, codex: codex.path }
  },
  isOnBatteryPower: () => powerMonitor.isOnBatteryPower(),
  onRecovered: notifyHistoryRecovered,
  onHistoryUpdated: () => broadcastHistoryUpdated(),
  onLocalRecordsImported: (records, retentionDays) => growth.syncLocalTokenUsage(records, retentionDays),
  onLocalScanFinished: () => growth.evaluateLocalTokens(),
  onDeferredStartupWork: () => growth.reconcileFromHistory(),
  logError: (message, error) => console.error(message, error),
})

// 使用者觸發的資料庫整理；啟動流程不使用。
export const dbMaintenance = createDbMaintenanceService({
  getHistoryStore: () => mainState.historyStore,
  getProgressionStore: () => mainState.progressionStore,
  getAchievementStore: () => mainState.achievementStore,
  databasePaths: () => {
    const paths = appUserDataPaths()
    return [paths.history, paths.progression, paths.achievements]
  },
  isLocalScanActive: () => mainState.localUsageScanPromise !== null,
  logError: (message, error) => console.error(message, error),
})

export const createHistoryServices = historyRuntime.start
export const refreshLocalUsage = historyRuntime.refreshLocalUsage

function notifyHistoryRecovered(): void {
  try {
    if (!Notification.isSupported()) return
    new Notification({
      title: t('reliability.history.recoveredTitle'),
      body: t('reliability.history.recoveredBody'),
    }).show()
  } catch {}
}

export function isProgressionPetId(value: unknown): value is string {
  return isValidPetId(value, 128)
}

export function schedulePermissionUiSync(): void {
  queueMicrotask(() => broadcastPermissionRequests())
}

export function cancelPermissionRequests(
  reason: 'system_lock' | 'system_suspend' | 'broker_shutdown',
): void {
  const broker = mainState.permissionBroker
  if (!broker) return
  for (const request of broker.listRequests()) {
    broker.resolveExternally(request.requestId, reason)
  }
}

function permissionAuditPath(): string {
  return appUserDataPaths().permissionAudit
}

export function listPermissionAuditEntries(limit: number): PermissionAuditEntry[] {
  return readPermissionAudit(permissionAuditPath(), limit)
    .filter(record => typeof record.action === 'string' && record.risk)
    .map(record => ({
      resolvedAt: record.resolvedAt,
      agentId: record.agentId,
      action: record.action as string,
      risk: record.risk as PermissionAuditEntry['risk'],
      status: record.status,
      ...(record.decidedBy ? { decidedBy: record.decidedBy } : {}),
      terminalReason: record.terminalReason,
    }))
}

export function clearPermissionAuditLog(): void {
  clearPermissionAudit(permissionAuditPath())
}

// --- Claude Code permission respond (opt-in) --------------------------------
const CLAUDE_PERMISSION_SOURCES = familySourceSet('claude')
// Cached so the permission server never reads preferences (or the OS login item) per request.
let claudePermissionRespondEnabled = false

export function isClaudePermissionRespondEnabled(): boolean {
  return claudePermissionRespondEnabled
}

function applyClaudePermissionRespond(preferences: DesktopPreferences): void {
  claudePermissionRespondEnabled = preferences.claudePermissionRespondEnabled
  try {
    syncClaudePermissionRespondOptIn(preferences.claudePermissionRespondEnabled ? preferences.claudePermissionWaitSeconds : null)
  } catch (error) {
    logMain('warn', 'permission', `Claude permission opt-in file sync failed: ${(error as NodeJS.ErrnoException)?.code ?? 'unknown'}`)
  }
  if (preferences.claudePermissionRespondEnabled || !mainState.permissionBroker) return
  // Turning the feature off takes pending Claude requests down; their hooks then get 410
  // and leave the decision to Claude Code's own prompt.
  for (const request of mainState.permissionBroker.listRequests()) {
    if (CLAUDE_PERMISSION_SOURCES.has(request.adapterId)) {
      mainState.permissionBroker.resolveExternally(request.requestId, 'adapter_disconnected')
    }
  }
}

export function createPermissionServices(permissionToken: string): void {
  if (mainState.permissionBroker || mainState.permissionRelay || mainState.permissionAdapterServer) return

  trimPermissionAuditOnStartup(permissionAuditPath(), appUserDataPaths().legacyPermissionAudit)
  const relay = new PermissionAdapterRelay()
  const broker = new PermissionBroker({
    onChanged: schedulePermissionUiSync,
    onAudit: record => {
      try {
        appendPermissionAudit(permissionAuditPath(), record)
      } catch (error) {
        console.error('Failed to persist permission audit record', error)
      }
    },
  })
  for (const source of PERMISSION_ADAPTER_SOURCES) broker.registerAdapter(relay.createPort(source))
  const server = createPermissionAdapterServer({
    token: permissionToken,
    broker,
    relay,
    isSourceEnabled: source => !CLAUDE_PERMISSION_SOURCES.has(source) || claudePermissionRespondEnabled,
  })
  const permissionHealth = serverHealthTracker().register('permission', localPorts().permission)
  const permissionHandle = listenOnLocalPort(server, localPorts().permission, {
    label: 'Permission adapter',
    onStatus: permissionHealth.onStatus,
    onPersistentFailure: permissionHealth.onPersistentFailure,
    onListening: () => {
      if (!app.isPackaged) console.log(`Permission adapter listening on http://127.0.0.1:${localPorts().permission}`)
    },
  })

  permissionHealth.attach(permissionHandle)
  mainState.permissionRelay = relay
  mainState.permissionBroker = broker
  mainState.permissionAdapterServer = server
  powerMonitor.on('lock-screen', () => cancelPermissionRequests('system_lock'))
  powerMonitor.on('suspend', () => cancelPermissionRequests('system_suspend'))
}

/**
 * A waiting-permission / waiting-input notification about one session (the only kinds that carry a
 * target) switches to that session's app when allowed (macOS, allowlisted app, both toggles on);
 * anything else opens the Sessions tab. The click itself is the user action.
 */
export async function openNotificationTarget(target?: { source: string; sessionId: string }): Promise<void> {
  try {
    if (target && await mainState.sessionJump?.switchFromNotification(target)) return
  } catch (error) {
    console.error('Switching to the session app failed', error)
  }
  showPanelWindow('sessions')
}

export function createDesktopServices(): void {
  if (mainState.desktopPreferences || mainState.desktopTray || mainState.desktopNotifications) return

  mainState.desktopPreferences = new DesktopPreferencesStore(
    appUserDataPaths().desktopPreferences,
    createLoginItemAdapter({
      platform: process.platform,
      app,
      execPath: process.execPath,
      portableExecutableFile: process.env.PORTABLE_EXECUTABLE_FILE,
    }),
    currentDesktopVisibilityCapabilities(),
  )
  setLocale(currentDesktopPreferences().locale)
  applyClaudePermissionRespond(currentDesktopPreferences())

  mainState.sessionJump = createSessionJumpService(currentDesktopPreferences)

  mainState.desktopNotifications = new DesktopNotificationService({
    logFilePath: appUserDataPaths().notificationLog,
    getPreferences: currentDesktopPreferences,
    isAppFocused: () => [mainState.petWindow, mainState.panelWindow].some(window => window?.isFocused()),
    onNotificationClick: target => { void openNotificationTarget(target) },
    onAttentionChanged: () => syncTrayAttention(),
  })

  scheduleDndExpiry(currentDesktopPreferences())

  mainState.desktopTray = new DesktopTrayController(
    join(__dirname, '..', 'build', 'icon.png'),
    {
      getPreferences: currentDesktopPreferences,
      updatePreferences: patch => { updateDesktopPreferences(patch) },
      isPetVisible: () => Boolean(mainState.petWindow?.isVisible()),
      showPet: showPetWindow,
      hidePet: hidePetWindow,
      openPanel: () => showPanelWindow('restore'),
      openSettings: () => showPanelWindow('settings'),
      getPetMode: () => mainState.petWindowMode,
      getPluginCommands: pluginTrayCommands,
      invokePluginCommand: (pluginId, commandId) => {
        const result = mainState.pluginCommandController?.invoke(pluginId, commandId)
        if (result && !result.ok) mainState.pluginBroker?.recordSystemDiagnostic(pluginId, result.error, 'command.tray')
      },
      onPluginCommandsOmitted: pluginIds => {
        if (pluginIds.length === 0) return
        for (const pluginId of pluginIds) {
          if (mainState.diagnosedPluginTrayOverflowIds.has(pluginId)) continue
          mainState.diagnosedPluginTrayOverflowIds.add(pluginId)
          mainState.pluginBroker?.recordSystemDiagnostic(pluginId, 'too_many_enabled', 'plugin.tray')
        }
      },
      toggleMiniMode,
      reloadPet: reloadPetRenderers,
      quit: () => app.quit(),
    },
  )
  try {
    mainState.desktopTray.create()
  } catch (error) {
    // Linux desktops without a StatusNotifier/AppIndicator host (or a missing icon) must not
    // take the app down; the pet window and panel keep working without the tray.
    console.error('Tray is unavailable', error instanceof Error ? error.message : error)
  }
}

export function getPetsJsonPath(): string {
  if (app.isPackaged) {
    return join(app.getAppPath(), 'dist', 'pets', 'pets.json')
  }
  return join(__dirname, '..', 'dist', 'pets', 'pets.json')
}

export async function availablePetIds(): Promise<Set<string>> {
  const ids = new Set<string>()
  try {
    const raw = JSON.parse(await fs.promises.readFile(getPetsJsonPath(), 'utf-8'))
    if (Array.isArray(raw)) {
      for (const pet of raw) {
        if (pet && isValidRegularPetId(pet.id, 128)) ids.add(pet.id)
      }
    }
  } catch {}

  const customBase = path.resolve(hookScriptDeployPath(), 'custom')
  try {
    for (const entry of await fs.promises.readdir(customBase, { withFileTypes: true })) {
      if (!entry.isDirectory() || !isValidRegularPetId(entry.name, 128)) continue
      const petJsonPath = safeJoin(customBase, entry.name, 'pet.json')
      if (!petJsonPath) continue
      try {
        const petStat = await fs.promises.lstat(petJsonPath)
        if (!petStat.isFile() || petStat.isSymbolicLink()) continue
        const pet = JSON.parse(await fs.promises.readFile(petJsonPath, 'utf-8'))
        const id = typeof pet.id === 'string' ? pet.id : entry.name
        if (isValidRegularPetId(id, 128)) ids.add(id)
      } catch {}
    }
  } catch {}
  const pluginSkinIds = availablePluginSkinPetIds(
    [...mainState.pluginRuntimeContexts].map(([pluginId, context]) => ({
      pluginId,
      enabled: context.enabled,
      skinIds: (context.manifest.contributes.skins ?? []).map(skin => skin.id),
    })),
    mainState.pluginPreferencesSnapshot?.pluginsEnabled === true,
  )
  for (const petId of pluginSkinIds) ids.add(petId)
  ids.add(DEFAULT_PET_ID)
  return ids
}

export const AVAILABLE_PET_IDS_CACHE_MS = 5_000
let availablePetIdsLoad: Promise<Set<string>> | null = null

// Live event ingestion calls this on every tool-call/state event; re-reading
// pets.json plus the whole custom-pets directory that often would add a
// second batch of synchronous disk I/O to the same hot path project routing
// already had to be freed of. User-initiated calls (pick/bind/list) skip
// this and always read fresh.
export async function availablePetIdsCached(): Promise<Set<string>> {
  const now = Date.now()
  if (mainState.availablePetIdsCache && mainState.availablePetIdsCache.expiresAt > now) return mainState.availablePetIdsCache.ids
  if (availablePetIdsLoad) return availablePetIdsLoad
  const loading = availablePetIds()
  availablePetIdsLoad = loading
  try {
    const ids = await loading
    if (availablePetIdsLoad === loading) {
      mainState.availablePetIdsCache = { ids, expiresAt: Date.now() + AVAILABLE_PET_IDS_CACHE_MS }
    }
    return ids
  } finally {
    if (availablePetIdsLoad === loading) availablePetIdsLoad = null
  }
}

export function createProjectRoutingServices(): void {
  if (mainState.projectRoutingStore) return
  try {
    mainState.projectRoutingStore = new ProjectRoutingStore(
      appUserDataPaths().projectRouting,
      { defaultPetId: DEFAULT_PET_ID },
    )
  } catch (error) {
    console.error('Project routing storage is unavailable', error)
    mainState.projectRoutingStore = null
  }
}

export function rawProjectPath(input: unknown): string | undefined {
  const value = asRecord(input)?.project
  return typeof value === 'string' ? value : undefined
}

export async function normalizeIngressEvent(input: unknown, receivedAt?: number) {
  const routed = await routeIngressEvent(input, receivedAt)
  if (!routed.ok) return routed
  return { ok: true as const, event: withSessionJumpContext(input, routed.event) }
}

async function routeIngressEvent(input: unknown, receivedAt?: number) {
  const normalized = withAnswerableClaudeNotice(
    await mainState.agentAdapterRegistry?.normalize(input, receivedAt) ?? { ok: false as const, error: 'adapter_registry_unavailable' },
    {
      enabled: claudePermissionRespondEnabled,
      hasRecentRequest: (source, sessionId) => Boolean(
        mainState.permissionBroker?.hasRecentRequestForSession(source, sessionId, CLAUDE_ANSWERABLE_GRACE_MS),
      ),
    },
  )
  if (!normalized.ok || !mainState.projectRoutingStore) return normalized

  try {
    const available = await availablePetIdsCached()
    const identity = mainState.projectRoutingStore.trackSeen(rawProjectPath(input), receivedAt)
    if (!identity) return normalized
    const route = mainState.projectRoutingStore.route(identity.projectId, available)
    if (route.fallback) {
      console.warn(`Project pet binding for ${identity.displayName} is unavailable; using default pet.`)
    }
    return {
      ok: true as const,
      event: {
        ...normalized.event,
        project: identity.displayName,
        projectId: identity.projectId,
        ...(route.petId ? { routedPetId: route.petId } : {}),
      },
    }
  } catch (error) {
    console.error('Project routing failed; preserving unbound event behavior', error)
    return normalized
  }
}

export async function exportDiagnostics(): Promise<{ ok: boolean; canceled?: boolean }> {
  const recentLogLines = mainLogger().readRecent(300)
  const report = buildDiagnosticsReport({
    app: {
      version: app.getVersion(),
      electron: process.versions.electron ?? '',
      chrome: process.versions.chrome ?? '',
      node: process.versions.node ?? '',
      platform: process.platform,
      arch: process.arch,
      packaged: app.isPackaged,
      locale: locale.value,
    },
    recentLogLines,
    generatedAt: Date.now(),
  })
  const parent = mainState.panelWindow && !mainState.panelWindow.isDestroyed() ? mainState.panelWindow : undefined
  const options = {
    defaultPath: join(app.getPath('documents'), `agent-pets-diagnostics-${new Date().toISOString().slice(0, 10)}.json`),
    filters: [{ name: 'JSON', extensions: ['json'] }],
  }
  const result = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return { ok: false, canceled: true }
  await fs.promises.writeFile(result.filePath, report, { encoding: 'utf8', mode: 0o600 })
  return { ok: true }
}

export function registerRuntimeDiagnostics(startupResults: () => unknown, crashStats: () => unknown, previousRunUnclean: boolean): void {
  registerDiagnosticsSection('startup', startupResults)
  registerDiagnosticsSection('crashGuard', crashStats)
  registerDiagnosticsSection('previousRunUnclean', () => previousRunUnclean)
  registerDiagnosticsSection('localServers', () => serverHealthTracker().snapshot().servers.map(server => ({
    id: server.id, port: server.port, state: server.state, attempt: server.attempt, code: server.code ?? null,
  })))
  registerDiagnosticsSection('pluginHost', () => mainState.pluginHostWindow?.diagnostics() ?? null)
  registerDiagnosticsSection('rendererErrors', () => ({ count: mainState.rendererErrorCount }))
  registerDiagnosticsSection('eventPipeline', () => ({ ...eventPipelineStats }))
  registerDiagnosticsSection('stores', () => ({
    history: mainState.historyStore ? 'ready' : 'unavailable',
    achievements: mainState.achievementStore ? 'ready' : 'unavailable',
    achievementInitRetries: mainState.achievementStoreRetryAttempt,
    progression: mainState.progressionStore ? 'ready' : 'unavailable',
    plugins: mainState.pluginRegistry ? 'ready' : 'unavailable',
    sessionsTracked: mainState.sessionSnapshot.list().length,
  }))
}
