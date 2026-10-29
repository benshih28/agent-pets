import { IPC_CHANNELS } from '../ipc/channels'
import { app, BrowserWindow, WebContentsView, screen, ipcMain, dialog, net, session, protocol, globalShortcut, powerMonitor, shell, safeStorage } from 'electron'
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { join, resolve } from 'path'
import { randomUUID } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { Readable } from 'node:stream'
import * as fs from 'fs'
import * as path from 'path'





import { DesktopPreferencesStore, resolveLoginItemExecutable } from '../desktop-preferences'
import { DesktopNotificationService } from '../desktop-notifications'
import { DesktopTrayController } from '../desktop-tray'
import type { PluginTrayCommandItem } from '../plugin-tray'
import { desktopVisibilityCapabilitiesForPlatform } from '../desktop-visibility'
import { PermissionBroker } from '../permission-broker'
import { appendPermissionAudit } from '../permission-audit'
import { ProgressionStore } from '../progression'
import { AchievementStore } from '../achievements'
import { HistoryStore } from '../history'
import { LocalUsageReader } from '../local-usage'
import { createPresentationMcpServer, PRESENTATION_MCP_PORT } from '../presentation-mcp'
import { listenOnLocalPort } from '../local-server-listen'
import { normalizePresentationStatus, PresentationController } from '../presentation-controller'


import { ProjectRoutingStore } from '../project-routing'
import { PluginRegistry, PLUGIN_ARCHIVE_SKIN_IMAGE_MAX_BYTES, PLUGIN_ARCHIVE_SKIN_MAX_BYTES } from '../plugin-registry'
import { PluginPreferencesStore, pluginHostMemoryBudgetMb } from '../plugin-preferences'
import { PluginHostWindowController, type PluginHostDescriptor } from '../plugin-host-window'
import { selectEnabledPluginDescriptors } from '../plugin-host-selection'
import { PluginBroker, type PluginBrokerContext, type PluginReactionRequest } from '../plugin-broker.ts'
import { PluginCommandController } from '../plugin-commands.ts'
import { PluginBadgeController } from '../plugin-badges.ts'
import { PluginFeedController } from '../plugin-feed.ts'
import { filterPluginRequestHeaders, PluginNetworkClient, stripPluginSetCookieHeaders } from '../plugin-net.ts'
import { isPublicPluginNetworkHost } from '../plugin-net.ts'
import { PluginHostGrantController, sanitizePluginHostRequestReason } from '../plugin-host-grants.ts'
import { PluginSecretsStore } from '../plugin-secrets.ts'
import { PluginSecretConsentStore } from '../plugin-secret-consent.ts'
import { PluginSettingsStore } from '../plugin-settings.ts'
import { PluginAgentStatusController } from '../plugin-agent-status.ts'
import { PluginEventSourceController } from '../plugin-event-source.ts'
import { PluginExternalLinkController } from '../plugin-external-links.ts'
import { DEFAULT_PLUGIN_ISSUE_REPORT_URL } from '../plugin-report.ts'
import { effectivePluginScheduleMinimum } from '../plugin-schedule.ts'

import { PluginDeveloperModeWatcher } from '../plugin-developer-mode.ts'
import { catalogFingerprintMatches, createPluginCatalogGateway, isPluginCatalogUrl, PLUGIN_CATALOG_ALLOWED_HOSTS, PLUGIN_CATALOG_MAX_PACKAGE_BYTES, selectLatestCompatiblePluginVersion } from '../plugin-catalog.ts'
import { buildPluginCatalogPanelItems, PluginCatalogAutoCheckSchedule } from '../plugin-catalog-updates.ts'
import { PluginPanelViewController, type PluginPanelNativeView, type PluginPanelViewSession } from '../plugin-panel-view.ts'
import { validatePluginPanelViewBounds, type PluginPanelRect } from '../plugin-panel-window.ts'
import { isPluginPanelInstallConfirmation, isPluginPanelPluginId, isPluginPanelPreferencePatch, pluginPanelErrorCode } from '../plugin-panel-validation.ts'
import { handlePluginProtocolRequest } from '../plugin-protocol'
import { pluginHostAssets } from '../plugin-host-assets'
import { parsePluginManifest } from '../plugin-manifest'
import { createPermissionAdapterServer, PERMISSION_ADAPTER_PORT, PermissionAdapterRelay } from '../permission-adapter-server'
import type { DesktopPreferences } from '../../src/types/desktop'
import { locale, setLocale, t } from '../../src/i18n'
import tokensCss from '../../src/styles/tokens.css?raw'
import type { ProgressionSnapshot } from '../../src/types/progression'
import type { AchievementUnlock } from '../../src/types/achievement'
import type { HistorySummary } from '../../src/types/history'
import type { PresentationIntent } from '../../src/types/presentation'
import type { PluginEventSourceStatusView, PluginPanelPlugin, PluginPanelResult, PluginPanelSnapshot } from '../../src/types/plugin'
import type { IpcErrorCode } from '../../src/types/ipc'

import type { PetEdge, PetWindowMode, PetWindowModeState } from '../../src/types/pet-window'
import { createPluginSkinPetId, isPluginSkinPetId, isValidPetId, isValidRegularPetId } from '../../src/utils/pet-id.ts'
import { availablePluginSkinPetIds } from '../plugin-skins.ts'
import { EDGE_DWELL_MS, EDGE_TRIGGER_DISTANCE_PX, clampWindowBounds, edgeWindowBounds, miniWindowBounds, nearestEdge, type WindowBounds } from '../pet-window-mode'
import { IS_MAC, hookScriptDeployPath, readWindowState, writeWindowState } from '../setup'


import { createWindowsFullscreenDetector, nativeWindowHandleToPointer, type WindowsFullscreenState } from '../windows-fullscreen-detector'







import { registerPluginFeedIpc } from '../ipc/plugin-feed'
import { createLatestValueCoalescer } from '../ipc/broadcast-coalescer.ts'

import { type IntegrationTestSource } from '../ipc/integrations'



import { registerPluginPanelUiIpc } from '../ipc/plugin-panel-ui'

import { registerPluginSettingsIpc } from '../ipc/plugin-settings'
import { registerPluginPreferencesIpc } from '../ipc/plugin-preferences'
import { registerPluginCatalogIpc } from '../ipc/plugin-catalog'
import { registerPluginInstallIpc } from '../ipc/plugin-install'
import { mainState, type PluginSkinFallbackInfo } from './state'

const PERMISSION_ALLOW_HOTKEY = 'CommandOrControl+Shift+Y'
const PERMISSION_DENY_HOTKEY = 'CommandOrControl+Shift+N'

export const PANEL_WIDTH = 460
export const PANEL_MIN_WIDTH = 320
export const PANEL_MAX_WIDTH = 960
export const PANEL_GAP = 6
// petWindow's actual bounds include a fixed, unscaled band of transparent
// space reserved above the visible sprite for the quota tooltip to pop
// into (see QUOTA_TOOLTIP_HEADROOM_H in agentStore.ts — keep in sync).
// computePanelBounds must anchor off the visible pet, not the raw window
// bounds, or the panel opens with a big gap floating above the pet — worst
// at small pet sizes, where that fixed band is a large fraction of the
// window's total (scaled) height. Only a fallback now: the renderer reports
// its measured content height (see petContentHeight), which also accounts
// for the status lines, whose size does not scale with the pet.
export const PET_WINDOW_TOP_HEADROOM = 190
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
      hostname: '127.0.0.1',
      port: 17373,
      path: '/v1/events',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        'x-agent-pets-token': mainState.eventToken,
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
  }, 8)
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

export function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function readPluginPanelRect(value: unknown): PluginPanelRect | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const rect = value as Record<string, unknown>
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
      const root = resolve(app.getPath('userData'), 'plugins', entry.id, entry.currentVersion)
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


export function sanitizePetId(id: string): string | null {
  if (typeof id !== 'string') return null
  const cleaned = id.replace(/[^a-zA-Z0-9_\-.]/g, '')
  if (cleaned.length === 0 || cleaned.length > 64) return null
  if (cleaned.includes('..')) return null
  return cleaned
}

export function safeJoin(base: string, ...parts: string[]): string | null {
  const root = resolve(base)
  const resolvedPath = resolve(root, ...parts)
  const relative = path.relative(root, resolvedPath)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null
  return resolvedPath
}

export function isSupportedRasterImage(data: Uint8Array): boolean {
  const png = data.length >= 8
    && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47
    && data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a
  const jpeg = data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
  const webp = data.length >= 12
    && Buffer.from(data.subarray(0, 4)).toString('ascii') === 'RIFF'
    && Buffer.from(data.subarray(8, 12)).toString('ascii') === 'WEBP'
  return png || jpeg || webp
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

export function rasterContentType(data: Uint8Array): string | null {
  if (data.length >= 8
    && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47
    && data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a) return 'image/png'
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  if (data.length >= 12
    && Buffer.from(data.subarray(0, 4)).toString('ascii') === 'RIFF'
    && Buffer.from(data.subarray(8, 12)).toString('ascii') === 'WEBP') return 'image/webp'
  return null
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

export function configureSecureProtocol(): void {
  protocol.handle('agent-pets', async (request) => {
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 })
    try {
      const url = new URL(request.url)
      const pathname = decodeURIComponent(url.pathname)
      if (url.hostname === 'plugin') {
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
      if (url.hostname === 'app') {
        const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
        const data = await readRegularFileWithin(resolve(join(__dirname, '../dist')), relativePath, 25 * 1024 * 1024)
        if (!data) return new Response('Not found', { status: 404 })
        return new Response(Uint8Array.from(data), {
          status: 200,
          headers: {
            'content-type': contentTypeFor(relativePath),
            'x-content-type-options': 'nosniff',
          },
        })
      }
      if (url.hostname === 'custom') {
        const match = pathname.match(/^\/([a-zA-Z0-9_.-]{1,64})\/spritesheet\.webp$/)
        const safeId = match ? sanitizePetId(match[1]) : null
        if (!safeId) return new Response('Not found', { status: 404 })
        const customRoot = resolve(hookScriptDeployPath(), 'custom')
        const data = await readRegularFileWithin(customRoot, join(safeId, 'spritesheet.webp'), MAX_PET_IMAGE_BYTES)
        const contentType = data ? rasterContentType(data) : null
        if (!data || !contentType) return new Response('Not found', { status: 404 })
        return new Response(Uint8Array.from(data), {
          status: 200,
          headers: { 'content-type': contentType, 'x-content-type-options': 'nosniff' },
        })
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
  return resolve(app.getPath('userData'), 'plugins', entry.id, entry.currentVersion)
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
    const root = resolve(app.getPath('userData'), 'plugins', entry.id, entry.currentVersion)
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

export async function syncPluginHost(): Promise<void> {
  const previousSkins = enabledPluginSkinRecords()
  await refreshPluginRuntimeContexts()
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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function decodeCatalogBase64(value: unknown): Uint8Array {
  if (typeof value !== 'string' || value.length === 0 || value.length > 36_000_000
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('Invalid catalog base64')
  }
  const bytes = Buffer.from(value, 'base64')
  if (bytes.toString('base64') !== value) throw new Error('Invalid catalog base64')
  return bytes
}

export function createMainPluginCatalogGateway() {
  return createPluginCatalogGateway({
    fetchRegistry: async (url, maxBytes) => {
      const e2eMode = Object.prototype.hasOwnProperty.call(globalThis, '__agentPetsE2E')
      const e2e = (globalThis as typeof globalThis & { __agentPetsE2E?: unknown }).__agentPetsE2E
      if (e2eMode) {
        if (!isRecord(e2e)) throw new Error('Catalog fixture unavailable')
        const fixture = e2e.catalogFixture
        if (!isRecord(fixture) || fixture.registry === undefined) throw new Error('Catalog fixture unavailable')
        return fixture.registry
      }
      if (!mainState.pluginNetworkClient) throw new Error('Plugin network unavailable')
      const result = await mainState.pluginNetworkClient.fetch('agent-pets-catalog', url, undefined,
        PLUGIN_CATALOG_ALLOWED_HOSTS, { maxResponseBytes: maxBytes, timeoutMs: 15_000, requestsPerMinute: 10 })
      if (!result.ok) throw Object.assign(new Error('Catalog unavailable'), { code: result.error })
      if (result.value.status === 404) throw Object.assign(new Error('Catalog not found'), { code: 'catalog_not_found' })
      if (result.value.status < 200 || result.value.status >= 300) throw new Error('Catalog unavailable')
      return result.value.isBase64Encoded
        ? Buffer.from(decodeCatalogBase64(result.value.body)).toString('utf8')
        : result.value.body
    },
    downloadArchive: async (url, maxBytes) => {
      const e2eMode = Object.prototype.hasOwnProperty.call(globalThis, '__agentPetsE2E')
      const e2e = (globalThis as typeof globalThis & { __agentPetsE2E?: unknown }).__agentPetsE2E
      if (e2eMode) {
        if (!isRecord(e2e)) throw new Error('Catalog fixture unavailable')
        const fixture = e2e.catalogFixture
        const downloads = isRecord(fixture) && isRecord(fixture.downloads) ? fixture.downloads : null
        if (!downloads || !Object.prototype.hasOwnProperty.call(downloads, url)) throw new Error('Catalog fixture download unavailable')
        return decodeCatalogBase64(downloads[url])
      }
      if (!mainState.pluginNetworkClient) throw new Error('Plugin network unavailable')
      const result = await mainState.pluginNetworkClient.fetch('agent-pets-catalog', url, undefined,
        PLUGIN_CATALOG_ALLOWED_HOSTS, { maxResponseBytes: Math.min(maxBytes, PLUGIN_CATALOG_MAX_PACKAGE_BYTES), timeoutMs: 15_000, requestsPerMinute: 10 })
      if (!result.ok) throw Object.assign(new Error('Package unavailable'), { code: result.error })
      if (result.value.status < 200 || result.value.status >= 300) throw new Error('Package unavailable')
      return result.value.isBase64Encoded
        ? decodeCatalogBase64(result.value.body)
        : Buffer.from(result.value.body, 'utf8')
    },
  })
}

export function checkPluginCatalogUpdates(): Promise<number> {
  return (async () => {
    if (!mainState.pluginRegistry || !mainState.pluginPreferences) throw new Error('Plugin catalog services unavailable')
    const preferences = mainState.pluginPreferences.get()
    if (!preferences.onlineCatalogEnabled || !preferences.dailyUpdateCheck
      || !isPluginCatalogUrl(preferences.catalogUrl)) throw new Error('Plugin catalog auto-check disabled')
    const result = await createMainPluginCatalogGateway().load(preferences.catalogUrl)
    if (!result.ok) throw new Error('Plugin catalog check failed')
    const items = buildPluginCatalogPanelItems(result.value, mainState.pluginRegistry.list())
    return items.filter(item => item.updateAvailable).length
  })()
}

export function initializePluginCatalogAutoCheck(): void {
  if (!mainState.pluginPreferences || !mainState.pluginRegistry || mainState.pluginCatalogAutoCheckSchedule) return
  mainState.pluginCatalogAutoCheckSchedule = new PluginCatalogAutoCheckSchedule({
    isEnabled: () => {
      try {
        const preferences = mainState.pluginPreferences?.get()
        return preferences?.onlineCatalogEnabled === true && preferences.dailyUpdateCheck
          && isPluginCatalogUrl(preferences.catalogUrl)
      } catch { return false }
    },
    getLastCheckedDay: () => mainState.pluginPreferences?.getLastCatalogAutoCheckDay() ?? null,
    setLastCheckedDay: day => {
      if (!mainState.pluginPreferences) throw new Error('Plugin preferences unavailable')
      mainState.pluginPreferences.setLastCatalogAutoCheckDay(day)
    },
    check: checkPluginCatalogUpdates,
    notify: updateCount => {
      mainState.pluginFeedController?.addSystemNotification(
        'agent-pets-catalog',
        { 'zh-TW': 'Agent Pets', 'en-US': 'Agent Pets' },
        t('pluginCatalogAutoCheckTitle'),
        updateCount > 0
          ? t('pluginCatalogAutoCheckFound', { count: String(updateCount) })
          : t('pluginCatalogAutoCheckNone'),
      )
    },
  })
  void mainState.pluginCatalogAutoCheckSchedule.checkIfDue()
  setInterval(() => {
    void mainState.pluginCatalogAutoCheckSchedule?.checkIfDue()
  }, 60 * 60 * 1_000)
}

export async function createPluginServices(): Promise<void> {
  if (mainState.pluginRegistry || mainState.pluginPreferences || mainState.pluginHostWindow) return
  const userDataDirectory = app.getPath('userData')
  mainState.pluginRegistry = new PluginRegistry(userDataDirectory)
  mainState.pluginDeveloperModeWatcher = new PluginDeveloperModeWatcher(500)
  mainState.pluginPreferences = new PluginPreferencesStore(userDataDirectory)
  mainState.pluginSecretsStore = new PluginSecretsStore(userDataDirectory, safeStorage)
  mainState.pluginSecretConsentStore = new PluginSecretConsentStore(userDataDirectory)
  mainState.pluginSettingsStore = new PluginSettingsStore(userDataDirectory)
  mainState.pluginHostGrantController = new PluginHostGrantController()
  mainState.pluginBadgeController = new PluginBadgeController({
    getContext: pluginId => {
      const context = mainState.pluginRuntimeContexts.get(pluginId)
      return context ? {
        enabled: context.enabled,
        pluginsEnabled: context.pluginsEnabled,
        contributesBadge: context.manifest.contributes.badge === true,
        pluginName: context.manifest.name,
        targetPetId: context.targetPetId,
      } : null
    },
    onChanged: badges => broadcastPluginBadges(badges),
  })
  mainState.pluginAgentStatusController = new PluginAgentStatusController({
    emit: change => {
      for (const [pluginId, context] of mainState.pluginRuntimeContexts) {
        if (context.enabled && context.pluginsEnabled && context.manifest.permissions.agentStatus) {
          mainState.pluginHostWindow?.notifyStatusChanged(pluginId, [change])
        }
      }
    },
  })
  mainState.pluginEventSourceController = new PluginEventSourceController({
    getContext: pluginId => {
      const context = mainState.pluginRuntimeContexts.get(pluginId)
      const contribution = context?.manifest.contributes.eventSource
      return context && contribution ? {
        enabled: context.enabled,
        pluginsEnabled: context.pluginsEnabled,
        pluginName: context.manifest.name,
        family: contribution.family,
        displayName: contribution.displayName,
      } : null
    },
    onChanged: statuses => {
      queuePluginEventSourceBroadcast(statuses)
    },
  })
  await refreshPluginRuntimeContexts()
  mainState.pluginFeedController = new PluginFeedController({
    emit: item => {
      if (mainState.petWindow && !mainState.petWindow.isDestroyed()) {
        const panelViewAvailable = Boolean(mainState.pluginRuntimeContexts.get(item.pluginId)?.manifest.contributes.panelView)
        mainState.petWindow.webContents.send(IPC_CHANNELS.pluginFeedItem, { ...item, ...(panelViewAvailable ? { panelViewAvailable: true } : {}) })
      }
    },
    onNotificationsChanged: count => broadcastPluginFeedUnreadCount(count),
    isPetVisible: isPluginFeedVisible,
    getGlobalState: () => ({
      pluginsEnabled: mainState.pluginPreferencesSnapshot?.pluginsEnabled === true,
      dndEnabled: currentDesktopPreferences().dndEnabled,
      rateLimitPer10Min: mainState.pluginPreferencesSnapshot?.resources.globalFeedPer10Min,
    }),
    getPluginState: pluginId => {
      const context = mainState.pluginRuntimeContexts.get(pluginId)
      if (!context) return null
      return {
        enabled: context.enabled,
        muted: context.muted,
        targetPetId: context.targetPetId,
        rateLimitPer10Min: context.rateLimitPer10Min,
        name: context.manifest.name,
      }
    },
    isLinkHostAllowed: isPluginLinkHostAllowed,
    resolveIconUrl: (pluginId, relativePath) => (
      mainState.pluginRuntimeContexts.has(pluginId) ? `agent-pets://plugin/${pluginId}/${relativePath}` : null
    ),
  })
  const pluginNetworkSession = session.fromPartition('plugin-network')
  pluginNetworkSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  pluginNetworkSession.setPermissionCheckHandler(() => false)
  pluginNetworkSession.webRequest.onBeforeSendHeaders((details, callback) => {
    callback({ requestHeaders: filterPluginRequestHeaders(details.requestHeaders) })
  })
  pluginNetworkSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: stripPluginSetCookieHeaders(details.responseHeaders) })
  })
  mainState.pluginBroker = new PluginBroker({
    userDataDirectory,
    getContext: pluginId => {
      const context = mainState.pluginRuntimeContexts.get(pluginId)
      return context ? { ...context, dndEnabled: currentDesktopPreferences().dndEnabled } : null
    },
    feed: mainState.pluginFeedController,
    network: mainState.pluginNetworkClient ??= new PluginNetworkClient({
      request: (url, init) => requestPluginNetwork(pluginNetworkSession, url, init),
    }),
    onRequestHost: async (pluginId, rawHost, rawReason) => {
      const context = mainState.pluginRuntimeContexts.get(pluginId)
      const reason = sanitizePluginHostRequestReason(rawReason)
      if (!context || !context.manifest.permissions.network?.userGranted || !reason || !mainState.pluginHostGrantController || !mainState.pluginPreferences) {
        return { ok: false, error: context?.manifest.permissions.network?.userGranted ? 'invalid_request' : 'not_permitted' }
      }
      const decision = mainState.pluginHostGrantController.begin(pluginId, rawHost, reason, context.grantedHosts)
      if (!decision.ok) return decision
      if (decision.alreadyGranted) return { granted: true, host: decision.host }
      if (!await isPublicPluginNetworkHost(decision.host)) {
        mainState.pluginHostGrantController.finish(pluginId, decision.host, true)
        return { ok: false, error: 'host_not_allowed' }
      }
      try {
        const name = context.manifest.name[locale.value]
        const options = {
          type: 'question' as const,
          title: t('pluginNetworkRequestTitle'),
          message: t('pluginNetworkRequestMessage', { name, host: decision.host, reason }),
          buttons: [t('pluginNetworkAllow'), t('pluginNetworkDeny')],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        }
        const parent = mainState.panelWindow && !mainState.panelWindow.isDestroyed() ? mainState.panelWindow
          : mainState.petWindow && !mainState.petWindow.isDestroyed() ? mainState.petWindow : undefined
        const response = parent
          ? await dialog.showMessageBox(parent, options)
          : await dialog.showMessageBox(options)
        if (response.response !== 0) {
          mainState.pluginHostGrantController.finish(pluginId, decision.host, false)
          return { ok: false, error: 'denied' }
        }
        const storedHosts = mainState.pluginPreferences.getPlugin(pluginId).grantedHosts
        const grantedHosts = [...new Set([...storedHosts, decision.host])]
        mainState.pluginPreferences.updatePlugin(pluginId, { grantedHosts })
        mainState.pluginHostGrantController.finish(pluginId, decision.host, true)
        await syncPluginHost()
        return { granted: true, host: decision.host }
      } catch {
        mainState.pluginHostGrantController.finish(pluginId, decision.host, true)
        return { ok: false, error: 'disabled' }
      }
    },
    onSecretGet: (pluginId, key) => {
      const context = mainState.pluginRuntimeContexts.get(pluginId)
      if (!context || !mainState.pluginSecretsStore) return { ok: false, error: 'disabled' }
      try {
        return mainState.pluginSecretsStore.get(pluginId, key, context.manifest.permissions.secrets ?? [])
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : null
        return { ok: false, error: code === 'secret_unavailable' || code === 'secret_not_found' || code === 'not_permitted'
          ? code : 'secret_unavailable' }
      }
    },
    onSettingsGet: pluginId => {
      const context = mainState.pluginRuntimeContexts.get(pluginId)
      if (!context || !mainState.pluginSettingsStore) return { ok: false, error: 'disabled' }
      try { return mainState.pluginSettingsStore.get(pluginId, context.manifest) } catch {
        return { ok: false, error: 'settings_invalid' }
      }
    },
    onAgentStatusGet: pluginId => {
      const context = mainState.pluginRuntimeContexts.get(pluginId)
      if (!context?.manifest.permissions.agentStatus) return { ok: false, error: 'not_permitted' }
      return mainState.pluginAgentStatusController?.getStatus() ?? { ok: false, error: 'agent_status_unavailable' }
    },
    onAgentEmit: (pluginId, event) => mainState.pluginEventSourceController?.emit(pluginId, event) ?? { ok: false, error: 'disabled' },
    onBadgeSet: (pluginId, badge) => {
      const result = mainState.pluginBadgeController?.set(pluginId, badge)
      return result?.ok ? result.value : { ok: false, error: result?.error ?? 'disabled' }
    },
    onReaction: (pluginId, request: PluginReactionRequest) => {
      const result = mainState.presentationController?.submitPluginReaction(pluginId, request)
      if (result?.accepted) return { ok: true }
      const error = result?.error
      return {
        ok: false,
        error: error === 'invalid_request' || error === 'queue_full' || error === 'rate_limited'
          || error === 'not_found' ? error : 'disabled',
      }
    },
  })
  mainState.pluginHostWindow = new PluginHostWindowController({
    onRpc: (pluginId, request) => {
      const data = request && typeof request === 'object' && !Array.isArray(request)
        ? request as Record<string, unknown>
        : {}
      if (data.method === 'ui.postMessage') {
        if (!Array.isArray(data.args) || data.args.length !== 1) return { ok: false, error: 'invalid_request' }
        if (typeof data.id !== 'string') return { ok: false, error: 'invalid_request' }
        const response = mainState.pluginPanelViewController?.postMessage(pluginId, data.args[0])
          ?? { ok: true as const, value: { delivered: false } }
        return { id: data.id, ...response }
      }
      return mainState.pluginBroker?.handle(pluginId, request) ?? { ok: false, error: 'disabled' }
    },
    createPluginToken: pluginId => {
      const root = enabledPluginRoot(pluginId)
      if (!root) throw new Error('Plugin is unavailable')
      const token = randomUUID()
      mainState.pluginRootsByToken.set(token, root)
      return token
    },
    revokePluginToken: (_pluginId, token) => {
      mainState.pluginRootsByToken.delete(token)
    },
    pluginRootForToken: token => mainState.pluginRootsByToken.get(token) ?? null,
    messageGuard: mainState.pluginUiMessageGuard,
    onPluginCrash: (pluginId, consecutiveCrashes, reason) => {
      mainState.pluginBadgeController?.clearPlugin(pluginId)
      mainState.pluginEventSourceController?.clearPlugin(pluginId)
      if (consecutiveCrashes >= 3) {
        const name = mainState.pluginRuntimeContexts.get(pluginId)?.manifest.name ?? { 'zh-TW': pluginId, 'en-US': pluginId }
        if (reason === 'host') mainState.pluginBroker?.recordHostUnavailable(pluginId)
        mainState.pluginFeedController?.addSystemNotification(
          pluginId,
          name,
          reason === 'host' ? t('pluginHostUnavailableTitle') : t('pluginCrashDisabledTitle'),
          reason === 'host'
            ? t('pluginHostUnavailableBody', { name: name[locale.value] })
            : t('pluginCrashDisabledBody', { name: name[locale.value] }),
        )
        try { mainState.pluginRegistry?.setStatus(pluginId, 'disabled_crashed') } catch {}
        try { mainState.pluginPreferences?.updatePlugin(pluginId, { enabled: false }) } catch {}
        mainState.pluginEnableOrder.delete(pluginId)
        setTimeout(() => { void syncPluginHost() }, 0)
      }
    },
    onPluginReset: pluginId => mainState.pluginEventSourceController?.clearPlugin(pluginId),
    getMemoryBudgetMb: activePluginCount => {
      const perPlugin = mainState.pluginPreferencesSnapshot?.resources.memoryMbPerPlugin ?? 0
      return pluginHostMemoryBudgetMb(perPlugin, activePluginCount)
    },
  })
  mainState.pluginCommandController = new PluginCommandController({
    getContext: pluginId => {
      const context = mainState.pluginRuntimeContexts.get(pluginId)
      return context ? {
        enabled: context.enabled,
        pluginsEnabled: context.pluginsEnabled,
        commandIds: (context.manifest.contributes.commands ?? []).map(command => command.id),
      } : null
    },
    dispatch: (pluginId, commandId) => mainState.pluginHostWindow?.invokeCommand(pluginId, commandId) ?? false,
  })
  mainState.pluginPanelViewController = new PluginPanelViewController({
    preloadPath: join(__dirname, 'plugin-ui-preload.js'),
    tokensCss,
    getParentWindow: () => {
      const parent = mainState.panelWindow
      if (!parent || parent.isDestroyed()) return null
      return {
        isDestroyed: () => parent.isDestroyed(),
        isVisible: () => parent.isVisible(),
        // The controller exposes a structural test seam; this adapter only receives the WebContentsView it creates.
        // This asserted boundary is limited to the real WebContentsView created below; the controller interface stays structural for unit tests.
        addChildView: view => parent.contentView.addChildView(view as unknown as WebContentsView),
        // The controller exposes a structural test seam; this adapter only receives the WebContentsView it creates.
        // This asserted boundary is limited to the real WebContentsView created below; the controller interface stays structural for unit tests.
        removeChildView: view => parent.contentView.removeChildView(view as unknown as WebContentsView),
      }
    },
    // Electron's concrete Session satisfies the narrower controller seam; keep the seam independently mockable in tests.
    createSession: partition => session.fromPartition(partition) as PluginPanelViewSession,
    // The structural controller seam intentionally omits Electron's full event surface; the factory always creates the native type.
    createView: options => new WebContentsView(options) as unknown as PluginPanelNativeView,
    createToken: pluginId => {
      const root = enabledPluginRoot(pluginId)
      if (!root) throw new Error('Plugin is unavailable')
      const token = randomUUID()
      mainState.pluginRootsByToken.set(token, root)
      return token
    },
    revokeToken: (_pluginId, token) => { mainState.pluginRootsByToken.delete(token) },
    pluginRootForToken: token => mainState.pluginRootsByToken.get(token) ?? null,
    messageGuard: mainState.pluginUiMessageGuard,
    onApiRequest: (pluginId, request) => {
      if (request.method === 'ui.postMessage') {
        if (request.args.length !== 1) return { ok: false, error: 'invalid_request' }
        const response = mainState.pluginHostWindow?.postUiMessageToWorker(pluginId, request.args[0])
          ?? { ok: false as const, error: 'disabled' }
        return { id: request.id, ...response }
      }
      if (request.method === 'links.openExternal') {
        if (request.args.length !== 2) return { ok: false, error: 'invalid_request' }
        return mainState.pluginExternalLinkController?.open(pluginId, request.args[0], request.args[1])
          ?? { ok: false, error: 'disabled' }
      }
      return mainState.pluginBroker?.handle(pluginId, request) ?? { ok: false, error: 'disabled' }
    },
    onClosed: event => {
      restorePluginPanelWindowSize(event.pluginId)
      if (mainState.panelWindow && !mainState.panelWindow.isDestroyed()) {
        mainState.panelWindow.webContents.send(IPC_CHANNELS.pluginPanelViewClosed, event)
      }
    },
    onBlockedRequest: () => {
      const e2e = (globalThis as typeof globalThis & {
        __agentPetsE2E?: { panelViewBlockedRequests?: number }
      }).__agentPetsE2E
      if (e2e) e2e.panelViewBlockedRequests = (e2e.panelViewBlockedRequests ?? 0) + 1
    },
  })

  mainState.pluginExternalLinkController = new PluginExternalLinkController({
    getContext: pluginId => {
      const context = mainState.pluginRuntimeContexts.get(pluginId)
      return context ? {
        enabled: context.enabled,
        pluginsEnabled: context.pluginsEnabled,
        hosts: context.manifest.permissions.links?.hosts ?? [],
      } : null
    },
    openExternal: url => shell.openExternal(url),
  })

  registerPluginFeedIpc({
    ipcMain,
    assertTrustedIpcSender,
    assertPluginPanelSender,
    getPetWindow: () => mainState.petWindow,
    getPanelWindow: () => mainState.panelWindow,
    getPluginFeedController: () => mainState.pluginFeedController,
    getPluginBadgeController: () => mainState.pluginBadgeController,
    getPluginEventSourceController: () => mainState.pluginEventSourceController,
    isPluginPanelPluginId,
    isPluginSkinPetId,
    getPendingSkinFallbacks: () => mainState.pendingPluginSkinFallbacks,
    getEnabledPluginSkinIds: () => new Set(enabledPluginSkinRecords().keys()),
    fallbackCopy: info => ({
      title: t('pluginSkinFallbackTitle'),
      body: t('pluginSkinFallbackBody', {
        plugin: info.pluginName[locale.value],
        skin: info.skinName[locale.value],
      }),
    }),
    addSystemNotification: (pluginId, pluginName, title, body) => (
      mainState.pluginFeedController?.addSystemNotification(pluginId, pluginName, title, body) ?? false
    ),
    broadcastUnreadCount: () => broadcastPluginFeedUnreadCount(),
    hasPluginContext: pluginId => mainState.pluginRuntimeContexts.has(pluginId),
    isPluginLinkHostAllowed,
    openExternal: url => shell.openExternal(url),
  })

  registerPluginPanelUiIpc({
    ipcMain,
    assertPluginPanelSender,
    isTrustedIpcSender,
    isPluginPanelPluginId,
    getPluginPanelSnapshot: pluginPanelSnapshot,
    invokePluginCommand: (pluginId, commandId) => mainState.pluginCommandController?.invoke(pluginId, commandId),
    openSequence: {
      get value() { return mainState.pluginPanelViewOpenSequence },
      set value(value: number) { mainState.pluginPanelViewOpenSequence = value },
    },
    openPluginPanelView: openPluginPanelViewForPlugin,
    getPetWindow: () => mainState.petWindow,
    getPluginPanelContext: pluginId => mainState.pluginRuntimeContexts.get(pluginId) ?? null,
    enabledPluginRoot,
    showPanelWindow: (view, pluginViewPluginId) => showPanelWindow(view, pluginViewPluginId),
    getPanelWindow: () => mainState.panelWindow,
    getPluginPanelViewController: () => mainState.pluginPanelViewController,
    finiteNumber,
    readPluginPanelRect,
    validateBounds: validatePluginPanelViewBounds,
  })

  registerPluginSettingsIpc({
    ipcMain,
    assertPluginPanelSender,
    isPluginPanelPluginId,
    getPluginContext: pluginId => mainState.pluginRuntimeContexts.get(pluginId) ?? null,
    getSettingsStore: () => mainState.pluginSettingsStore,
    getSecretsStore: () => mainState.pluginSecretsStore,
    getSecretConsentStore: () => mainState.pluginSecretConsentStore,
    notifySettingsChanged: (pluginId, values) => mainState.pluginHostWindow?.notifySettingsChanged(pluginId, values),
    pluginPanelError,
  })

  registerPluginPreferencesIpc({
    ipcMain,
    assertPluginPanelSender,
    isPluginPanelPluginId,
    isPluginPanelPreferencePatch,
    getPreferencesStore: () => mainState.pluginPreferences,
    getRegistry: () => mainState.pluginRegistry,
    enabledPluginContext: pluginId => mainState.pluginRuntimeContexts.get(pluginId)?.enabled === true,
    enabledPluginCount: () => [...mainState.pluginRuntimeContexts.values()].filter(context => context.enabled).length,
    maxEnabledPlugins: () => mainState.pluginPreferencesSnapshot?.resources.maxEnabledPlugins ?? 0,
    pluginEnableOrder: mainState.pluginEnableOrder,
    nextPluginEnableOrder: {
      get value() { return mainState.nextPluginEnableOrder },
      set value(value: number) { mainState.nextPluginEnableOrder = value },
    },
    onCatalogPreferencesChanged: (previous, next) => {
      if (!next.onlineCatalogEnabled || next.catalogUrl !== previous.catalogUrl) mainState.pluginCatalogCache = null
    },
    checkCatalogIfDue: () => {
      if (mainState.pluginCatalogAutoCheckSchedule) void mainState.pluginCatalogAutoCheckSchedule.checkIfDue()
    },
    syncPluginHost,
    pluginPanelError,
  })

  registerPluginCatalogIpc({
    ipcMain,
    assertPluginPanelSender,
    getRegistry: () => mainState.pluginRegistry,
    getPreferencesStore: () => mainState.pluginPreferences,
    getCatalogCache: () => mainState.pluginCatalogCache,
    setCatalogCache: value => { mainState.pluginCatalogCache = value },
    createCatalogGateway: createMainPluginCatalogGateway,
    buildCatalogItems: buildPluginCatalogPanelItems,
    isPluginCatalogUrl,
    selectLatestVersion: selectLatestCompatiblePluginVersion,
    catalogFingerprintMatches,
    pendingPlanIds: mainState.pendingPluginPlanIds,
    pendingDeveloperFolders: mainState.pendingDeveloperFolders,
    issueReportBaseUrl: () => {
      const e2e = (globalThis as typeof globalThis & { __agentPetsE2E?: { pluginIssueReportBaseUrl?: string } }).__agentPetsE2E
      return typeof e2e?.pluginIssueReportBaseUrl === 'string' ? e2e.pluginIssueReportBaseUrl : DEFAULT_PLUGIN_ISSUE_REPORT_URL
    },
    openExternal: url => shell.openExternal(url),
  })

  registerPluginInstallIpc({
    ipcMain,
    assertPluginPanelSender,
    getRegistry: () => mainState.pluginRegistry,
    getPreferencesStore: () => mainState.pluginPreferences,
    getPanelWindow: () => mainState.panelWindow,
    isDialogOpen: () => mainState.dialogOpen,
    setDialogOpen: value => { mainState.dialogOpen = value },
    showOpenDialog: (window, options) => dialog.showOpenDialog(window, options),
    translate: key => t(key),
    fs: fs.promises,
    maxArchiveBytes: PLUGIN_ARCHIVE_SKIN_MAX_BYTES,
    pendingPlanIds: mainState.pendingPluginPlanIds,
    pendingDeveloperFolders: mainState.pendingDeveloperFolders,
    developerSourceFolders: mainState.developerSourceFolders,
    getDeveloperModeWatcher: () => mainState.pluginDeveloperModeWatcher,
    getSecretsStore: () => mainState.pluginSecretsStore,
    getPluginBroker: () => mainState.pluginBroker,
    getPluginHostGrantController: () => mainState.pluginHostGrantController,
    getPluginFeedController: () => mainState.pluginFeedController,
    isInstallConfirmation: isPluginPanelInstallConfirmation,
    isPluginPanelPluginId,
    pluginPanelError,
    syncPluginHost,
    pluginPanelSnapshot,
  })

}

export function clearEdgeDwell(): void {
  if (mainState.edgeDwellHandle) clearTimeout(mainState.edgeDwellHandle)
  mainState.edgeDwellHandle = null
  mainState.edgeDwellCandidate = null
}

export function petModeState(): PetWindowModeState {
  return mainState.petWindowEdge
    ? { mode: mainState.petWindowMode, edge: mainState.petWindowEdge }
    : { mode: mainState.petWindowMode }
}

export function broadcastPetWindowMode(): void {
  mainState.pluginFeedController?.onVisibilityChanged()
  const state = petModeState()
  for (const window of [mainState.petWindow, mainState.panelWindow]) {
    if (window && !window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.petWindowModeUpdated, state)
    }
  }
}

export function displayForBounds(bounds: WindowBounds) {
  return screen.getDisplayMatching({
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height)),
  })
}

export function displayForSavedState(saved: ReturnType<typeof readWindowState>) {
  if (saved?.displayId !== undefined) {
    const byId = screen.getAllDisplays().find(display => display.id === saved.displayId)
    if (byId) return byId
  }
  const savedBounds = saved?.normalBounds ?? (
    saved && saved.width !== undefined && saved.height !== undefined
      ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height }
      : null
  )
  return savedBounds ? displayForBounds(savedBounds) : screen.getPrimaryDisplay()
}

export function persistCurrentPetWindowState(): void {
  if (!mainState.petWindow || mainState.petWindow.isDestroyed()) return
  const bounds = mainState.petWindow.getBounds()
  const display = displayForBounds(bounds)
  const normal = mainState.edgeRestoreBounds ?? mainState.normalPetBounds ?? bounds
  writeWindowState({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    mode: mainState.petWindowMode,
    edge: mainState.petWindowEdge ?? undefined,
    displayId: display.id,
    displayBounds: display.bounds,
    normalBounds: normal,
  })
}

export function scheduleShimejiPositionPersist(): void {
  if (mainState.shimejiPersistHandle) clearTimeout(mainState.shimejiPersistHandle)
  mainState.shimejiPersistHandle = setTimeout(() => {
    mainState.shimejiPersistHandle = null
    persistCurrentPetWindowState()
  }, 2_000)
}

export function applyNormalPetBounds(): void {
  if (!mainState.petWindow || mainState.petWindow.isDestroyed()) return
  clearEdgeDwell()
  const current = mainState.petWindow.getBounds()
  const restore = mainState.edgeRestoreBounds ?? mainState.normalPetBounds ?? current
  const display = displayForBounds(restore)
  const normal = clampWindowBounds(restore, display.workArea)
  mainState.normalPetBounds = normal
  mainState.edgeRestoreBounds = null
  mainState.petWindowMode = 'normal'
  mainState.petWindowEdge = null
  mainState.petWindow.setIgnoreMouseEvents(false)
  mainState.petWindow.setBounds(normal)
  repositionVisiblePanel()
  persistCurrentPetWindowState()
  broadcastPetWindowMode()
  mainState.desktopTray?.rebuild()
}

export function applyMiniPetBounds(): void {
  if (!mainState.petWindow || mainState.petWindow.isDestroyed()) return
  clearEdgeDwell()
  const current = mainState.petWindow.getBounds()
  const normalSource = mainState.edgeRestoreBounds ?? mainState.normalPetBounds ?? current
  const display = displayForBounds(normalSource)
  mainState.normalPetBounds = clampWindowBounds(normalSource, display.workArea)
  mainState.edgeRestoreBounds = null
  mainState.petWindowMode = 'mini'
  mainState.petWindowEdge = null
  mainState.petWindow.setIgnoreMouseEvents(false)
  mainState.petWindow.setBounds(miniWindowBounds(mainState.normalPetBounds, display.workArea))
  repositionVisiblePanel()
  persistCurrentPetWindowState()
  broadcastPetWindowMode()
  mainState.desktopTray?.rebuild()
}

export function applyEdgePetBounds(edge: PetEdge): void {
  if (!mainState.petWindow || mainState.petWindow.isDestroyed()) return
  if (!currentDesktopPreferences().edgeModeEnabled) {
    applyNormalPetBounds()
    return
  }
  clearEdgeDwell()
  const current = mainState.petWindow.getBounds()
  // Edge can only be entered from a full-size normal window. Capture the
  // actual bounds at this moment so expansion returns to the user's exact
  // pre-edge position, even if a previous persisted snapshot is stale.
  const normalSource = mainState.petWindowMode === 'normal'
    ? current
    : mainState.edgeRestoreBounds ?? mainState.normalPetBounds ?? current
  const display = displayForBounds(normalSource)
  mainState.normalPetBounds = clampWindowBounds(normalSource, display.workArea)
  mainState.edgeRestoreBounds = { ...mainState.normalPetBounds }
  mainState.petWindowMode = 'edge'
  mainState.petWindowEdge = edge
  // Edge is an explicit, opaque handle-sized window. Keep it interactive so
  // a click or drag can expand it; click-through remains owned by Normal's
  // transparent-region hit testing.
  mainState.petWindow.setIgnoreMouseEvents(false)
  mainState.petWindow.setBounds(edgeWindowBounds(mainState.normalPetBounds, display.workArea, edge))
  repositionVisiblePanel()
  persistCurrentPetWindowState()
  broadcastPetWindowMode()
  mainState.desktopTray?.rebuild()
}

export function setPetWindowMode(mode: PetWindowMode): void {
  if (!mainState.petWindow || mainState.petWindow.isDestroyed()) return
  // A permission bubble must remain fully usable. The Broker remains the
  // authority, so a compact/partially hidden window is never allowed while a
  // request is pending.
  if (mode !== 'normal' && (mainState.permissionBroker?.hasActiveRequests() ?? false)) {
    applyNormalPetBounds()
    return
  }
  if (mode === 'normal') applyNormalPetBounds()
  else if (mode === 'mini') applyMiniPetBounds()
  else if (mainState.petWindowEdge) applyEdgePetBounds(mainState.petWindowEdge)
}

export function toggleMiniMode(): void {
  setPetWindowMode(mainState.petWindowMode === 'mini' ? 'normal' : 'mini')
}

export function scheduleEdgeDwell(): void {
  clearEdgeDwell()
  if (
    !mainState.petWindow
    || mainState.petWindow.isDestroyed()
    || mainState.petWindowMode !== 'normal'
    || !currentDesktopPreferences().edgeModeEnabled
  ) return
  const bounds = mainState.petWindow.getBounds()
  const display = displayForBounds(bounds)
  const edge = nearestEdge(bounds, display.workArea, EDGE_TRIGGER_DISTANCE_PX)
  if (!edge) return
  mainState.edgeDwellCandidate = { displayId: display.id, edge }
  mainState.edgeDwellHandle = setTimeout(() => {
    mainState.edgeDwellHandle = null
    const candidate = mainState.edgeDwellCandidate
    mainState.edgeDwellCandidate = null
    if (!candidate || !mainState.petWindow || mainState.petWindow.isDestroyed()) return
    const current = mainState.petWindow.getBounds()
    const currentDisplay = displayForBounds(current)
    const currentEdge = nearestEdge(current, currentDisplay.workArea, EDGE_TRIGGER_DISTANCE_PX)
    if (currentDisplay.id === candidate.displayId && currentEdge === candidate.edge) {
      applyEdgePetBounds(candidate.edge)
    }
  }, EDGE_DWELL_MS)
}

export function rehomePetWindowForDisplayChange(): void {
  if (!mainState.petWindow || mainState.petWindow.isDestroyed()) return
  const current = mainState.petWindow.getBounds()
  const display = displayForBounds(current)
  const normalSource = mainState.edgeRestoreBounds ?? mainState.normalPetBounds ?? current
  mainState.normalPetBounds = clampWindowBounds(normalSource, display.workArea)
  if (mainState.petWindowMode === 'edge') mainState.edgeRestoreBounds = { ...mainState.normalPetBounds }
  if (mainState.petWindowMode === 'mini') {
    mainState.petWindow.setBounds(miniWindowBounds(mainState.normalPetBounds, display.workArea))
  } else if (mainState.petWindowMode === 'edge' && mainState.petWindowEdge) {
    mainState.petWindow.setBounds(edgeWindowBounds(mainState.normalPetBounds, display.workArea, mainState.petWindowEdge))
  } else {
    mainState.petWindowMode = 'normal'
    mainState.petWindowEdge = null
    mainState.petWindow.setIgnoreMouseEvents(false)
    mainState.petWindow.setBounds(mainState.normalPetBounds)
  }
  repositionVisiblePanel()
  persistCurrentPetWindowState()
  broadcastPetWindowMode()
}

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
  const visibleOnFullScreen = !preferences.fullscreenAutoHideEnabled
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

export function createPetWindow() {
  const primaryWorkArea = screen.getPrimaryDisplay().workArea
  const rawScale = parseFloat(process.env.PET_SCALE || '1')
  const scale = clamp(isNaN(rawScale) ? 1 : rawScale, 0.3, 5)

  // Restore wherever the user last dragged it to, rather than always
  // snapping back to the bottom-right default on every relaunch. Re-clamped
  // to the current work area in case it was saved on a monitor that's no
  // longer connected.
  const saved = readWindowState()

  // The pet size lives in the renderer's localStorage, which the main process
  // can't read, so the last size the renderer asked for is persisted with the
  // position and reused here. Without it the window would always be born at
  // the 1x (L) size and only shrink once the store hydrates — long enough for
  // the panel to open against L-sized bounds, and, because the window is
  // bottom-anchored, enough to walk the pet down the screen every launch.
  // The fallback is a rough guess; keep it in sync with PET_BASE_W/H,
  // QUOTA_TOOLTIP_MIN_W and QUOTA_TOOLTIP_HEADROOM_H in agentStore.ts.
  const w = saved?.width !== undefined
    ? Math.round(clamp(saved.width, 80, 1_600))
    : Math.max(Math.round(250 * scale), 260)
  const h = saved?.height !== undefined
    ? Math.round(clamp(saved.height, 80, 1_600))
    : Math.round(232 * scale) + 190

  const savedDisplay = displayForSavedState(saved)
  const savedNormal = saved?.normalBounds ?? (
    saved
      ? { x: saved.x, y: saved.y, width: saved.width ?? w, height: saved.height ?? h }
      : {
          x: primaryWorkArea.x + primaryWorkArea.width - w - 30,
          y: primaryWorkArea.y + primaryWorkArea.height - h - 30,
          width: w,
          height: h,
        }
  )
  mainState.normalPetBounds = clampWindowBounds(savedNormal, savedDisplay.workArea)
  const edgeModeEnabled = currentDesktopPreferences().edgeModeEnabled
  const attachedEdge = nearestEdge(mainState.normalPetBounds, savedDisplay.workArea, EDGE_TRIGGER_DISTANCE_PX)
  const canRestoreEdge = saved?.mode === 'edge'
    && edgeModeEnabled
    && attachedEdge !== null
    && (saved.edge === undefined || saved.edge === attachedEdge)
  mainState.petWindowMode = saved?.mode === 'mini' ? 'mini' : canRestoreEdge ? 'edge' : 'normal'
  mainState.petWindowEdge = canRestoreEdge ? (saved.edge ?? attachedEdge) : null
  mainState.edgeRestoreBounds = canRestoreEdge ? { ...mainState.normalPetBounds } : null
  const initialBounds = mainState.petWindowMode === 'mini'
    ? miniWindowBounds(mainState.normalPetBounds, savedDisplay.workArea)
    : mainState.petWindowMode === 'edge' && mainState.petWindowEdge
      ? edgeWindowBounds(mainState.normalPetBounds, savedDisplay.workArea, mainState.petWindowEdge)
      : mainState.normalPetBounds

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

  if (process.env.VITE_DEV_SERVER_URL && !app.isPackaged) {
    mainState.petWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainState.petWindow.loadURL('agent-pets://app/index.html')
  }

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
  mainState.panelWindow = new BrowserWindow({
    width: PANEL_WIDTH,
    height: 560,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
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

  mainState.panelWindow.on('hide', () => mainState.pluginPanelViewController?.onPanelWindowHidden())
  mainState.panelWindow.on('show', () => {
    if (!mainState.panelWindow || mainState.panelWindow.isDestroyed()) return
    const contentBounds = mainState.panelWindow.getContentBounds()
    mainState.pluginPanelViewController?.relayout({ width: contentBounds.width, height: contentBounds.height })
  })
  mainState.panelWindow.webContents.on('did-start-loading', () => mainState.pluginPanelViewController?.onPanelRendererReload())
  mainState.panelWindow.on('resize', () => {
    if (!mainState.panelWindow || mainState.panelWindow.isDestroyed()) return
    const contentBounds = mainState.panelWindow.getContentBounds()
    mainState.pluginPanelViewController?.relayout({ width: contentBounds.width, height: contentBounds.height })
    const pluginId = mainState.pluginPanelWindowSizer.activePluginId()
    if (!pluginId) return
    const [width, height] = mainState.panelWindow.getSize()
    if (mainState.programmaticPluginPanelSize) {
      if (mainState.programmaticPluginPanelSize.width === width && mainState.programmaticPluginPanelSize.height === height) {
        mainState.programmaticPluginPanelSize = null
        if (mainState.pluginPanelResizeResetTimer) clearTimeout(mainState.pluginPanelResizeResetTimer)
        mainState.pluginPanelResizeResetTimer = null
        return
      }
      mainState.programmaticPluginPanelSize = null
      if (mainState.pluginPanelResizeResetTimer) clearTimeout(mainState.pluginPanelResizeResetTimer)
      mainState.pluginPanelResizeResetTimer = null
    }
    const workArea = screen.getDisplayMatching(mainState.panelWindow.getBounds()).workArea
    mainState.pluginPanelWindowSizer.recordManualSize(pluginId, { width, height }, workArea)
  })

  secureRendererWindow(mainState.panelWindow)

  applyMacFullscreenVisibilityPolicy()

  if (process.env.VITE_DEV_SERVER_URL && !app.isPackaged) {
    mainState.panelWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}#panel`)
  } else {
    mainState.panelWindow.loadURL('agent-pets://app/index.html#panel')
  }

  mainState.panelWindow.on('blur', () => {
    if (mainState.dialogOpen) return
    // Clicking the pet focuses petWindow just before the click handler's
    // 'panel-toggle' IPC arrives — if we hid on blur here too, the toggle
    // would then see the panel already hidden and reopen it (a flicker,
    // and clicking the pet could never close the panel). Let the toggle
    // handler own that case; blur-hide is only for genuine click-outside.
    if (mainState.petWindow?.isFocused()) return
    schedulePanelBlurHide()
  })

  mainState.panelWindow.on('closed', () => {
    mainState.pluginPanelViewController?.close()
    if (mainState.panelBlurHideHandle) clearTimeout(mainState.panelBlurHideHandle)
    mainState.panelBlurHideHandle = null
    mainState.panelWindow = null
    mainState.windowsFullscreenAutoHiddenPanel = false
    syncWindowsFullscreenTargets()
  })

  syncWindowsFullscreenTargets()
}

export function computePanelBounds(height: number, width = PANEL_WIDTH) {
  const panelWidth = Math.round(clamp(width, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH))
  if (!mainState.petWindow) {
    const { workArea } = screen.getPrimaryDisplay()
    return { x: workArea.x, y: workArea.y, width: panelWidth, height }
  }

  const petBounds = mainState.petWindow.getBounds()
  // The window's horizontal center still matches the visible sprite's (the
  // headroom band is only added above, not to the sides), so x needs no
  // adjustment — only the vertical anchor does.
  //
  // Prefer the height the pet renderer measured for its own content: the
  // sprite is bottom-anchored in the window, and how much of the window it
  // actually fills depends on pet size AND status-line count, neither of
  // which the constant below can express. It is only the fallback for the
  // brief window before the first measurement arrives.
  const visibleHeight = mainState.petContentHeight !== null
    ? clamp(mainState.petContentHeight, 40, petBounds.height)
    : petBounds.height - PET_WINDOW_TOP_HEADROOM
  const visibleTop = petBounds.y + petBounds.height - visibleHeight
  const { workArea } = screen.getDisplayMatching(petBounds)
  const maxX = Math.max(workArea.x, workArea.x + workArea.width - panelWidth)
  const maxY = Math.max(workArea.y, workArea.y + workArea.height - height)
  let x = petBounds.x + Math.round(petBounds.width / 2) - Math.round(panelWidth / 2)
  const aboveY = visibleTop - height - PANEL_GAP
  const belowY = visibleTop + visibleHeight + PANEL_GAP
  let y = aboveY

  // Keep the panel touching the pet even near a work-area edge. Prefer above,
  // but place it below when there is no room instead of clamping it far away.
  if (aboveY < workArea.y && belowY + height <= workArea.y + workArea.height) {
    y = belowY
  }

  x = clamp(x, workArea.x, maxX)
  y = clamp(y, workArea.y, maxY)

  return { x, y, width: panelWidth, height }
}

export function setPluginPanelWindowBounds(bounds: ReturnType<typeof computePanelBounds>): void {
  if (!mainState.panelWindow || mainState.panelWindow.isDestroyed()) return
  mainState.programmaticPluginPanelSize = { width: bounds.width, height: bounds.height }
  if (mainState.pluginPanelResizeResetTimer) clearTimeout(mainState.pluginPanelResizeResetTimer)
  mainState.pluginPanelResizeResetTimer = setTimeout(() => {
    mainState.programmaticPluginPanelSize = null
    mainState.pluginPanelResizeResetTimer = null
  }, 500)
  mainState.panelWindow.setBounds(bounds)
}

export function restorePluginPanelWindowSize(pluginId: string): void {
  if (mainState.pluginPanelWindowSizer.activePluginId() !== pluginId) return
  const baseSize = mainState.pluginPanelWindowSizer.finish()
  if (!baseSize || !mainState.panelWindow || mainState.panelWindow.isDestroyed()) return
  mainState.panelWindow.setResizable(false)
  mainState.panelWindow.setMinimumSize(0, 0)
  mainState.panelWindow.setMaximumSize(0, 0)
  setPluginPanelWindowBounds(computePanelBounds(baseSize.height, baseSize.width))
}

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
  const [currentWidth, currentHeight] = mainState.panelWindow.getSize()
  const workArea = screen.getDisplayMatching(mainState.panelWindow.getBounds()).workArea
  const size = mainState.pluginPanelWindowSizer.begin(pluginId, { width: currentWidth, height: currentHeight }, panelView.preferredSize, workArea)
  mainState.panelWindow.setResizable(true)
  mainState.panelWindow.setMinimumSize(Math.min(320, workArea.width), Math.min(240, workArea.height))
  mainState.panelWindow.setMaximumSize(Math.min(960, workArea.width), Math.min(800, workArea.height))
  setPluginPanelWindowBounds(computePanelBounds(size.height, size.width))
  const result = await mainState.pluginPanelViewController.open({ pluginId, entry: panelView.entry, openToken, bounds })
  if (!result.ok) restorePluginPanelWindowSize(pluginId)
  return result
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

export function repositionVisiblePanel() {
  if (!mainState.panelWindow?.isVisible()) return
  const [width, height] = mainState.panelWindow.getSize()
  mainState.panelWindow.setBounds(computePanelBounds(height, width))
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

// `restore` 沿用面板上次關閉時的畫面（含暫停中的插件畫面與視窗尺寸），只依寵物位置重新定位；
// 其他 view 是明確導向，會先關閉暫停中的插件畫面再切換。
export function showPanelWindow(view: 'sessions' | 'settings' | 'restore' = 'sessions', pluginViewPluginId?: string): void {
  if (!ensureDesktopWindows() || !mainState.panelWindow) return
  const restore = view === 'restore'
  if (!restore) mainState.pluginPanelViewController?.close(mainState.panelWindow.isVisible() ? 'closed' : 'hidden')
  if (mainState.panelBlurHideHandle) clearTimeout(mainState.panelBlurHideHandle)
  mainState.panelBlurHideHandle = null
  mainState.windowsFullscreenAutoHiddenPanel = false
  if (mainState.petWindowMode === 'edge') applyNormalPetBounds()
  showPetWindow()
  if (restore) {
    const [width, height] = mainState.panelWindow.getSize()
    setPluginPanelWindowBounds(computePanelBounds(height, width))
  } else {
    mainState.panelWindow.setBounds(computePanelBounds(view === 'settings' ? 720 : 560))
  }
  // Opening a panel is an explicit user action (Tray item, notification, or
  // pet click), so it must remain keyboard-usable even when fullscreen
  // exclusion is enabled. The macOS Space collection policy still decides
  // which Space the window may occupy.
  mainState.panelWindow.show()
  mainState.panelWindow.focus()
  mainState.desktopNotifications?.clearAttention()

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
      notificationsEnabled: true,
      permissionBubbleEnabled: true,
      presentationMcpEnabled: true,
      achievementsEnabled: true,
      edgeModeEnabled: false,
      shimejiEnabled: false,
      captureExclusionEnabled: false,
      fullscreenAutoHideEnabled: false,
      rightClickHideEnabled: false,
      soundEnabled: false,
      launchAtStartup: false,
      launchAtStartupSupported: false,
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

export function schedulePanelBlurHide(): void {
  if (mainState.panelBlurHideHandle) clearTimeout(mainState.panelBlurHideHandle)
  mainState.panelBlurHideHandle = setTimeout(() => {
    mainState.panelBlurHideHandle = null
    if (!mainState.panelWindow || mainState.panelWindow.isDestroyed() || mainState.panelWindow.isFocused() || !mainState.panelWindow.isVisible()) {
      return
    }
    // Give the Win32 detector's event-driven refresh a chance to classify an
    // external fullscreen transition before treating the blur as a manual
    // click-away. This preserves the marker needed to restore an open panel.
    if (process.platform === 'win32' && mainState.windowsFullscreenState.panelDisplayFullscreen) return
    mainState.windowsFullscreenAutoHiddenPanel = false
    mainState.panelWindow.hide()
  }, 100)
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

export function updateDesktopPreferences(patch: unknown): DesktopPreferences {
  if (!mainState.desktopPreferences) throw new Error('Desktop preferences are not ready')
  const previousPreferences = mainState.desktopPreferences.get()
  const achievementsWereEnabled = previousPreferences.achievementsEnabled
  const preferences = mainState.desktopPreferences.update(patch)
  if (previousPreferences.dndEnabled !== preferences.dndEnabled) mainState.pluginFeedController?.onVisibilityChanged()
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
    reconcileAchievementsFromHistory()
  }
  return preferences
}

export function unregisterPermissionHotkeys(): void {
  if (!app.isReady()) return
  for (const accelerator of [PERMISSION_ALLOW_HOTKEY, PERMISSION_DENY_HOTKEY]) {
    if (globalShortcut.isRegistered(accelerator)) globalShortcut.unregister(accelerator)
  }
}

export function syncTrayAttention(): void {
  mainState.desktopTray?.setAttentionCount(mainState.notificationAttentionCount + mainState.permissionAttentionCount)
}

export function broadcastPermissionRequests(): void {
  const requests = mainState.permissionBroker?.listRequests() ?? []
  if (requests.length > 0 && mainState.petWindowMode !== 'normal') {
    applyNormalPetBounds()
  }
  mainState.permissionAttentionCount = requests.length
  syncTrayAttention()
  for (const window of [mainState.petWindow, mainState.panelWindow]) {
    if (window && !window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.permissionRequestsUpdated, requests)
    }
  }

  unregisterPermissionHotkeys()
  const top = requests[0]
  const permissionBubbleEnabled = currentDesktopPreferences().permissionBubbleEnabled
  if (
    !permissionBubbleEnabled
    || !top
    || top.status !== 'pending'
    || !top.hotkeyEligible
    || !mainState.petWindow
    || mainState.petWindow.isDestroyed()
    || !mainState.petWindow.isVisible()
  ) return

  try {
    if (top.allowedDecisions.includes('allow_once')) {
      globalShortcut.register(PERMISSION_ALLOW_HOTKEY, () => {
        void mainState.permissionBroker?.decide(top.requestId, 'allow_once', 'hotkey')
      })
    }
    if (top.allowedDecisions.includes('deny')) {
      globalShortcut.register(PERMISSION_DENY_HOTKEY, () => {
        void mainState.permissionBroker?.decide(top.requestId, 'deny', 'hotkey')
      })
    }
  } catch {
    unregisterPermissionHotkeys()
  }
}

export function broadcastProgression(snapshot?: ProgressionSnapshot): void {
  const next = snapshot ?? mainState.progressionStore?.getSnapshot()
  if (!next) return
  for (const window of [mainState.petWindow, mainState.panelWindow]) {
    if (window && !window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.progressionUpdated, next)
    }
  }
}

export function broadcastAchievements(petId?: string): void {
  const snapshot = mainState.achievementStore?.getSnapshot(
    petId ?? mainState.progressionStore?.getActivePetId() ?? 'aang-airbender',
  )
  if (!snapshot) return
  for (const window of [mainState.petWindow, mainState.panelWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send(IPC_CHANNELS.achievementsUpdated, snapshot)
  }
}

export function broadcastAchievementUnlock(unlock: AchievementUnlock): void {
  mainState.desktopNotifications?.showAchievement(unlock)
  for (const window of [mainState.petWindow, mainState.panelWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send(IPC_CHANNELS.achievementUnlocked, unlock)
  }
  // The unlock payload identifies the routed pet for the visual reward, but
  // the gallery in each renderer must remain scoped to its currently selected
  // pet rather than jumping to a background project pet.
  broadcastAchievements()
}

export function currentHistorySummary(projectId?: string): HistorySummary | null {
  if (!mainState.historyStore) return null
  return mainState.historyStore.getSummary(mainState.progressionStore?.getActivePetId() ?? 'aang-airbender', projectId)
}

export async function refreshLocalUsage(): Promise<void> {
  if (!mainState.localUsageReader || mainState.localUsageScanPromise) return mainState.localUsageScanPromise ?? Promise.resolve()
  mainState.localUsageScanPromise = mainState.localUsageReader.scan()
    .then(result => {
      if (result.recordsImported > 0) broadcastHistoryUpdated()
    })
    .catch(error => {
      console.error('Local token usage scan failed', error)
    })
    .finally(() => {
      mainState.localUsageScanPromise = null
    })
  return mainState.localUsageScanPromise
}

export function broadcastHistoryUpdated(): void {
  for (const window of [mainState.petWindow, mainState.panelWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send(IPC_CHANNELS.historyUpdated)
  }
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
  listenOnLocalPort(server, PRESENTATION_MCP_PORT, {
    label: 'Presentation MCP',
    onListening: () => {
      if (!app.isPackaged) console.log(`Presentation MCP control listening on http://127.0.0.1:${PRESENTATION_MCP_PORT}`)
    },
  })
  mainState.presentationMcpServer = server
}

export function createProgressionServices(): void {
  if (mainState.progressionStore) return
  try {
    mainState.progressionStore = new ProgressionStore(join(app.getPath('userData'), 'progression.sqlite'))
  } catch (error) {
    // A missing SQLite runtime must not prevent the desktop pet from starting;
    // the renderer simply keeps its progression card unavailable until the
    // runtime is repaired. No in-memory fallback is presented as durable XP.
    console.error('Progression storage is unavailable', error)
    mainState.progressionStore = null
  }
}

// Init can fail transiently (e.g. antivirus/cloud-sync briefly holding the
// file at startup); retry a few times with backoff instead of disabling
// achievements silently for the rest of the session.
export const ACHIEVEMENT_STORE_RETRY_DELAYS_MS = [3_000, 10_000, 30_000]

export function createAchievementServices(): void {
  if (mainState.achievementStore) return
  try {
    mainState.achievementStore = new AchievementStore(join(app.getPath('userData'), 'achievements.sqlite'))
    mainState.achievementStoreRetryAttempt = 0
    if (mainState.achievementStoreRetryTimer) {
      clearTimeout(mainState.achievementStoreRetryTimer)
      mainState.achievementStoreRetryTimer = null
    }
    // A retry can succeed after the renderer's initial achievements-init call
    // already came back null; push the real snapshot now so the gallery
    // recovers without requiring a manual reload.
    broadcastAchievements()
    reconcileAchievementsFromHistory()
  } catch (error) {
    // Achievements are an additive feedback surface. A broken achievement
    // database must never prevent XP, permissions, history, or event ingest.
    console.error('Achievement storage is unavailable', error)
    logAchievementDiagnostic('init', error)
    mainState.achievementStore = null
    scheduleAchievementStoreRetry()
  }
}

export function logAchievementDiagnostic(label: string, error: unknown, extra?: unknown): void {
  const line = `${new Date().toISOString()} [${label}] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`
    + `${extra !== undefined ? ` extra=${JSON.stringify(extra)}` : ''}\n`
  void fs.promises.appendFile(join(app.getPath('userData'), 'achievements-init-error.log'), line).catch(() => {})
}

export function scheduleAchievementStoreRetry(): void {
  if (mainState.achievementStoreRetryTimer) return
  const delay = ACHIEVEMENT_STORE_RETRY_DELAYS_MS[mainState.achievementStoreRetryAttempt]
  if (delay === undefined) return
  mainState.achievementStoreRetryAttempt += 1
  mainState.achievementStoreRetryTimer = setTimeout(() => {
    mainState.achievementStoreRetryTimer = null
    createAchievementServices()
  }, delay)
}

export function createHistoryServices(): void {
  if (mainState.historyStore) return
  try {
    mainState.historyStore = new HistoryStore(join(app.getPath('userData'), 'history.sqlite'))
    mainState.localUsageReader = new LocalUsageReader({
      homeDir: app.getPath('home'),
      history: mainState.historyStore,
      projectRouting: mainState.projectRoutingStore,
    })
    mainState.localUsageScanTimer = setInterval(() => {
      void refreshLocalUsage()
    }, 60_000)
    reconcileAchievementsFromHistory()
    void refreshLocalUsage()
  } catch (error) {
    // History is an additive HUD feature. A broken history database must not
    // prevent the pet, event receiver, XP, or permission controls from booting.
    console.error('History storage is unavailable', error)
    mainState.historyStore = null
    mainState.localUsageReader = null
  }
}

export function reconcileAchievementsFromHistory(): void {
  if (
    !mainState.achievementStore
    || !mainState.historyStore
    || !currentDesktopPreferences().achievementsEnabled
  ) return
  try {
    const unlocks = mainState.achievementStore.reconcileCompletedSessions(
      mainState.historyStore.getAchievementCompletedSessions(),
      petId => mainState.progressionStore?.getSnapshot(petId),
    )
    unlocks.forEach(broadcastAchievementUnlock)
  } catch (error) {
    console.error('Achievement history reconciliation failed', error)
    logAchievementDiagnostic('history-reconcile', error)
  }
}

export function isProgressionPetId(value: unknown): value is string {
  return isValidPetId(value, 128)
}

export function setActiveProgressionPet(petId: string): ProgressionSnapshot | null {
  if (!mainState.progressionStore) return null
  const snapshot = mainState.progressionStore.setActivePet(petId)
  broadcastProgression(snapshot)
  broadcastAchievements(petId)
  return snapshot
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

export function createPermissionServices(permissionToken: string): void {
  if (mainState.permissionBroker || mainState.permissionRelay || mainState.permissionAdapterServer) return

  const relay = new PermissionAdapterRelay()
  const broker = new PermissionBroker({
    onChanged: schedulePermissionUiSync,
    onAudit: record => {
      try {
        appendPermissionAudit(join(app.getPath('userData'), 'permission-audit.json'), record)
      } catch (error) {
        console.error('Failed to persist permission audit record', error)
      }
    },
  })
  broker.registerAdapter(relay.createPort('opencode-cli'))
  broker.registerAdapter(relay.createPort('opencode-desktop'))
  const server = createPermissionAdapterServer({ token: permissionToken, broker, relay })
  listenOnLocalPort(server, PERMISSION_ADAPTER_PORT, {
    label: 'Permission adapter',
    onListening: () => {
      if (!app.isPackaged) console.log(`Permission adapter listening on http://127.0.0.1:${PERMISSION_ADAPTER_PORT}`)
    },
  })

  mainState.permissionRelay = relay
  mainState.permissionBroker = broker
  mainState.permissionAdapterServer = server
  powerMonitor.on('lock-screen', () => cancelPermissionRequests('system_lock'))
  powerMonitor.on('suspend', () => cancelPermissionRequests('system_suspend'))
}

export function createDesktopServices(): void {
  if (mainState.desktopPreferences || mainState.desktopTray || mainState.desktopNotifications) return

  // electron-builder's Windows portable target runs the app from a temporary
  // extraction directory. Register the original launcher path, never that
  // ephemeral process.execPath. Unsupported/invalid paths fail closed.
  const loginItemExecutable = resolveLoginItemExecutable(
    process.platform,
    app.isPackaged,
    process.execPath,
    process.env.PORTABLE_EXECUTABLE_FILE,
  )

  mainState.desktopPreferences = new DesktopPreferencesStore(
    join(app.getPath('userData'), 'desktop-preferences.json'),
    {
      supported: loginItemExecutable !== null,
      getOpenAtLogin: () => {
        if (!loginItemExecutable) return false
        return app.getLoginItemSettings({ path: loginItemExecutable }).openAtLogin
      },
      setOpenAtLogin: (enabled) => {
        if (!loginItemExecutable) return false
        app.setLoginItemSettings({ openAtLogin: enabled, path: loginItemExecutable })
        return app.getLoginItemSettings({ path: loginItemExecutable }).openAtLogin
      },
    },
    currentDesktopVisibilityCapabilities(),
  )
  setLocale(currentDesktopPreferences().locale)

  mainState.desktopNotifications = new DesktopNotificationService({
    logFilePath: join(app.getPath('userData'), 'notification-log.json'),
    getPreferences: currentDesktopPreferences,
    isAppFocused: () => [mainState.petWindow, mainState.panelWindow].some(window => window?.isFocused()),
    onNotificationClick: () => showPanelWindow('sessions'),
    onAttentionChanged: count => {
      mainState.notificationAttentionCount = count
      syncTrayAttention()
    },
  })

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
      quit: () => app.quit(),
    },
  )
  mainState.desktopTray.create()
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
  ids.add('aang-airbender')
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
      join(app.getPath('userData'), 'project-routing.sqlite'),
      { defaultPetId: 'aang-airbender' },
    )
  } catch (error) {
    console.error('Project routing storage is unavailable', error)
    mainState.projectRoutingStore = null
  }
}

export function rawProjectPath(input: unknown): string | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const value = (input as Record<string, unknown>).project
  return typeof value === 'string' ? value : undefined
}

export async function normalizeIngressEvent(input: unknown, receivedAt?: number) {
  const normalized = await mainState.agentAdapterRegistry?.normalize(input, receivedAt)
  if (!normalized) return { ok: false as const, error: 'adapter_registry_unavailable' }
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
