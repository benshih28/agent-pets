import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import type { App, BrowserWindow, Dialog, IpcMain, IpcMainEvent, IpcMainInvokeEvent, NativeTheme, SafeStorage, Session, Shell, WebContentsView } from 'electron'
import { IPC_CHANNELS } from '../ipc/channels.ts'
import { registerPluginFeedIpc } from '../ipc/plugin-feed.ts'
import { registerPluginPanelUiIpc } from '../ipc/plugin-panel-ui.ts'
import { registerPluginSettingsIpc } from '../ipc/plugin-settings.ts'
import { registerPluginPreferencesIpc } from '../ipc/plugin-preferences.ts'
import { registerPluginCatalogIpc } from '../ipc/plugin-catalog.ts'
import { registerPluginInstallIpc } from '../ipc/plugin-install.ts'
import { registerPanelThemeIpc } from '../ipc/panel-theme.ts'
import { registerUserPanelThemeIpc } from '../ipc/panel-theme-user.ts'
import { readUserPanelThemeImportFile, writeUserPanelThemeExportFile } from '../panel-theme-user-store.ts'
import { deleteUserImage, prepareUserImage, readUserImageSource, storeUserImage } from '../panel-theme-images.ts'
import { emptyPanelThemeState } from '../plugin-panel-themes.ts'
import { PluginRegistry, PLUGIN_ARCHIVE_SKIN_MAX_BYTES } from '../plugin-registry.ts'
import { PluginPreferencesStore, pluginHostMemoryBudgetMb } from '../plugin-preferences.ts'
import type { PluginHostWindowController } from '../plugin-host-window.ts'
import { PluginBroker, type PluginReactionRequest } from '../plugin-broker.ts'
import { PluginCommandController } from '../plugin-commands.ts'
import { PluginBadgeController } from '../plugin-badges.ts'
import { PluginFeedController } from '../plugin-feed.ts'
import { filterPluginRequestHeaders, isPublicPluginNetworkHost, PluginNetworkClient, stripPluginSetCookieHeaders } from '../plugin-net.ts'
import { PluginHostGrantController, sanitizePluginHostRequestReason } from '../plugin-host-grants.ts'
import { PluginSecretsStore } from '../plugin-secrets.ts'
import { PluginSecretConsentStore } from '../plugin-secret-consent.ts'
import { PluginSettingsStore } from '../plugin-settings.ts'
import { PluginAgentStatusController } from '../plugin-agent-status.ts'
import { PluginEventSourceController } from '../plugin-event-source.ts'
import { PluginExternalLinkController } from '../plugin-external-links.ts'
import { DEFAULT_PLUGIN_ISSUE_REPORT_URL } from '../plugin-report.ts'
import { PluginDeveloperModeWatcher } from '../plugin-developer-mode.ts'
import { catalogFingerprintMatches, isPluginCatalogUrl, selectLatestCompatiblePluginVersion } from '../plugin-catalog.ts'
import { buildPluginCatalogPanelItems } from '../plugin-catalog-updates.ts'
import { PluginPanelViewController, type PluginPanelNativeView, type PluginPanelViewSession } from '../plugin-panel-view.ts'
import { validatePluginPanelViewBounds } from '../plugin-panel-window.ts'
import { isPluginPanelInstallConfirmation, isPluginPanelPluginId, isPluginPanelPreferencePatch } from '../plugin-panel-validation.ts'
import { isPluginSkinPetId } from '../../src/utils/pet-id.ts'
import type { TranslationKey, TranslationParams } from '../../src/i18n'
import type { AppLocale } from '../../src/types/locale.ts'
import type { DesktopPreferences } from '../../src/types/desktop.ts'
import type { PluginBadgeView, PluginEventSourceStatusView, PluginPanelResult, PluginPanelSnapshot } from '../../src/types/plugin.ts'
import type { IpcErrorCode } from '../../src/types/ipc.ts'
import type { PluginSkinFallbackInfo, MainState } from './state.ts'
import { PanelThemeRuntime } from './panel-theme-runtime.ts'
import type { LogLevel } from '../diagnostics/logger.ts'
import type { PluginPanelRect } from '../plugin-panel-window.ts'
import type { UserDataPaths } from './user-data-paths.ts'
import { recordOrEmpty } from '../value-guards.ts'

// Plugin runtime：建立並接線 plugin 服務（registry、偏好、機密、broker、feed、host 視窗、
// 面板 view 與所有 plugin／面板主題 IPC registrar），並以 `dispose()` 依固定順序釋放。
//
// 各 controller 的實例仍放在 `mainState`：IPC、事件伺服器、托盤與面板視窗的主程序程式碼
// 都會讀。這裡不持有額外狀態；依賴 Electron 的值（session、safeStorage、WebContentsView、
// dialog、shell、plugin host 視窗類別）與 `runtime.ts` 內的 helper 都由 deps 傳入，
// 不 import `runtime.ts` 或 Electron 值，因此能在 Node 測試直接執行。
// Permission Control Plane 與 Presentation MCP 的狀態不在此處理（只讀 presentationController 提交 reaction）。

export type PluginRuntimeState = Pick<MainState,
  | 'developerSourceFolders' | 'dialogOpen' | 'nextPluginEnableOrder' | 'panelThemeRuntime' | 'panelWindow'
  | 'pendingDeveloperFolders' | 'pendingPluginPlanIds' | 'pendingPluginSkinFallbacks' | 'petWindow'
  | 'pluginAgentStatusController' | 'pluginBadgeController' | 'pluginBroker' | 'pluginCatalogAutoCheckSchedule'
  | 'pluginCatalogCache' | 'pluginCommandController' | 'pluginDeveloperModeWatcher' | 'pluginEnableOrder'
  | 'pluginEventSourceController' | 'pluginExternalLinkController' | 'pluginFeedController'
  | 'pluginHostGrantController' | 'pluginHostWindow' | 'pluginNetworkClient' | 'pluginPanelViewController'
  | 'pluginPanelViewOpenSequence' | 'pluginPreferences' | 'pluginPreferencesSnapshot' | 'pluginRegistry'
  | 'pluginRootsByToken' | 'pluginRuntimeContexts' | 'pluginSecretConsentStore' | 'pluginSecretsStore'
  | 'pluginSettingsStore' | 'pluginUiMessageGuard' | 'presentationController'>

type PanelUiIpcDeps = Parameters<typeof registerPluginPanelUiIpc>[0]
type SenderGuard = (event: IpcMainEvent | IpcMainInvokeEvent, requiredWindow?: BrowserWindow | null) => void

export interface PluginRuntimeDeps {
  state: PluginRuntimeState
  /** 啟動時只解析一次的 userData 路徑表（只用到 root 與 pluginVersionRoot）。 */
  userDataPaths(): Pick<UserDataPaths, 'root' | 'pluginVersionRoot'>
  pluginUiPreloadPath: string
  tokensCss: string
  electron: {
    ipcMain: IpcMain
    session: { fromPartition(partition: string): Session }
    safeStorage: SafeStorage
    nativeTheme: Pick<NativeTheme, 'shouldUseDarkColors'>
    dialog: Pick<Dialog, 'showMessageBox' | 'showOpenDialog' | 'showSaveDialog'>
    shell: Pick<Shell, 'openExternal'>
    app: Pick<App, 'getVersion'>
  }
  /** `new WebContentsView(options)`；Electron 值不進這個模組。 */
  createWebContentsView(options: ConstructorParameters<typeof WebContentsView>[0]): WebContentsView
  /** `new PluginHostWindowController(options)`。 */
  createPluginHostWindow(options: ConstructorParameters<typeof PluginHostWindowController>[0]): PluginHostWindowController
  translate(key: TranslationKey, params?: TranslationParams): string
  locale: { readonly value: AppLocale }
  logMain(level: LogLevel, channel: string, message: string, detail?: unknown): void
  createMainPluginCatalogGateway: Parameters<typeof registerPluginCatalogIpc>[0]['createCatalogGateway']
  // 以下是 runtime.ts 仍擁有、也被視窗與托盤程式碼共用的 helper。
  refreshPluginRuntimeContexts(): Promise<void>
  syncPluginHost(): Promise<void>
  syncPanelThemes(): void
  enabledPluginRoot(pluginId: string): string | null
  enabledPluginSkinRecords(): Map<string, PluginSkinFallbackInfo>
  currentDesktopPreferences(): DesktopPreferences
  isPluginFeedVisible(): boolean
  isPluginLinkHostAllowed(pluginId: string, host: string): boolean
  broadcastPluginBadges(badges?: PluginBadgeView[]): void
  broadcastPluginFeedUnreadCount(count?: number): void
  queuePluginEventSourceBroadcast(statuses: PluginEventSourceStatusView[]): void
  requestPluginNetwork(networkSession: Session, url: string, init: RequestInit): Promise<Response>
  readRegularFileWithin(root: string, relativePath: string, maxBytes: number): Promise<Buffer | null>
  panelRendererOrigin(): string | null
  assertTrustedIpcSender: SenderGuard
  assertPluginPanelSender(event: IpcMainEvent | IpcMainInvokeEvent): void
  isTrustedIpcSender: (event: IpcMainEvent | IpcMainInvokeEvent, requiredWindow?: BrowserWindow | null) => boolean
  pluginPanelError(error: unknown): IpcErrorCode
  pluginPanelSnapshot(): Promise<PluginPanelResult<PluginPanelSnapshot>>
  openPluginPanelViewForPlugin: PanelUiIpcDeps['openPluginPanelView']
  showPanelWindow(view?: 'sessions' | 'settings' | 'restore', pluginViewPluginId?: string): void
  finiteNumber(value: unknown): number | null
  readPluginPanelRect(value: unknown): PluginPanelRect | null
}

export interface PluginRuntime {
  /** 建立所有 plugin 服務；已建立時直接返回（重入防護）。 */
  start(): Promise<void>
  /** 依固定順序釋放 plugin 服務；可重複呼叫。 */
  dispose(): void
}

export function createPluginRuntime(deps: PluginRuntimeDeps): PluginRuntime {
  const mainState = deps.state
  const {
    refreshPluginRuntimeContexts, syncPluginHost, syncPanelThemes, enabledPluginRoot, enabledPluginSkinRecords,
    currentDesktopPreferences, isPluginFeedVisible, isPluginLinkHostAllowed, broadcastPluginBadges,
    broadcastPluginFeedUnreadCount, queuePluginEventSourceBroadcast, requestPluginNetwork, readRegularFileWithin,
    panelRendererOrigin, assertTrustedIpcSender, assertPluginPanelSender, isTrustedIpcSender, pluginPanelError,
    pluginPanelSnapshot, openPluginPanelViewForPlugin, showPanelWindow, finiteNumber, readPluginPanelRect,
    createMainPluginCatalogGateway, logMain, tokensCss, locale,
  } = deps
  const { ipcMain, session, safeStorage, nativeTheme, dialog, shell, app } = deps.electron
  const appUserDataPaths = deps.userDataPaths
  const t = deps.translate

  async function start(): Promise<void> {
    if (mainState.pluginRegistry || mainState.pluginPreferences || mainState.pluginHostWindow) return
    const userDataDirectory = appUserDataPaths().root
    mainState.pluginRegistry = new PluginRegistry(userDataDirectory)
    mainState.pluginDeveloperModeWatcher = new PluginDeveloperModeWatcher(500, pluginId => {
      // Surfaces in the plugin's diagnostics in the manager instead of vanishing.
      mainState.pluginBroker?.recordSystemDiagnostic(pluginId, 'invalid_request', 'developer.reload')
    })
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
    mainState.panelThemeRuntime = new PanelThemeRuntime({
      userDataDirectory,
      pluginRoot: (pluginId, version) => appUserDataPaths().pluginVersionRoot(pluginId, version),
      readRegularFileWithin,
      send: state => {
        const window = mainState.panelWindow
        if (window && !window.isDestroyed()) window.webContents.send(IPC_CHANNELS.panelThemeChanged, state)
      },
      rendererOrigin: panelRendererOrigin,
      sendPetStatus: state => {
        const window = mainState.petWindow
        if (window && !window.isDestroyed()) window.webContents.send(IPC_CHANNELS.panelThemePetStatusChanged, state)
      },
      sendPluginTheme: snapshot => {
        mainState.pluginHostWindow?.notifyThemeChanged(snapshot)
        mainState.pluginPanelViewController?.notifyThemeChanged(snapshot)
      },
      initialMode: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
    })
    try { mainState.panelThemeRuntime.sweep() } catch {}
    syncPanelThemes()
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
      onLog: (pluginId, entry) => logMain(entry.level === 'info' ? 'info' : entry.level === 'warn' ? 'warn' : 'error', `plugin:${pluginId}`, String(entry.message).slice(0, 300)),
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
      onThemeGet: () => mainState.panelThemeRuntime?.getPluginTheme() ?? null,
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
    mainState.pluginHostWindow = deps.createPluginHostWindow({
      onRpc: (pluginId, request) => {
        const data = recordOrEmpty(request)
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
        logMain('warn', 'plugin-host', `plugin crash reason=${reason} consecutive=${consecutiveCrashes}`, { pluginId })
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
      preloadPath: deps.pluginUiPreloadPath,
      tokensCss,
      getThemeSnapshot: () => mainState.panelThemeRuntime?.getPluginTheme() ?? null,
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
      createView: options => {
        const view = deps.createWebContentsView(options)
        // 原生 view 不受網頁 overflow 裁切；底色透明，插件才能自己畫出與外框一致的圓角。
        view.setBackgroundColor('#00000000')
        // The structural controller seam intentionally omits Electron's full event surface; the factory always creates the native type.
        return view as unknown as PluginPanelNativeView
      },
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
      buildCatalogItems: (document, installed) => buildPluginCatalogPanelItems(document, installed, app.getVersion()),
      isPluginCatalogUrl,
      selectLatestVersion: (plugin, apiVersion) => selectLatestCompatiblePluginVersion(plugin, apiVersion, app.getVersion()),
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
      onPluginRemoved: pluginId => mainState.panelThemeRuntime?.removePlugin(pluginId),
    })

    registerPanelThemeIpc({
      ipcMain,
      assertPluginPanelSender,
      assertPetSender: event => assertTrustedIpcSender(event, mainState.petWindow),
      setPanelAppearance: appearance => mainState.panelThemeRuntime?.setPanelAppearance(appearance),
      getPetStatus: () => mainState.panelThemeRuntime?.getPetStatus() ?? { light: null, dark: null },
      getStore: () => mainState.panelThemeRuntime?.store ?? null,
      getSources: () => mainState.panelThemeRuntime?.getSources() ?? [],
      getState: () => mainState.panelThemeRuntime?.getState() ?? emptyPanelThemeState(),
      publish: () => mainState.panelThemeRuntime?.publish(),
      getPanelWindow: () => mainState.panelWindow,
      isDialogOpen: () => mainState.dialogOpen,
      setDialogOpen: value => { mainState.dialogOpen = value },
      showOpenDialog: (window, options) => dialog.showOpenDialog(window, options),
      translate: key => t(key),
      readUserImage: readUserImageSource,
      prepareUserImage,
      storeUserImage: (pluginId, prepared) => storeUserImage(appUserDataPaths().root, pluginId, prepared),
      deleteUserImage: (pluginId, file) => deleteUserImage(appUserDataPaths().root, pluginId, file),
      pluginPanelError,
      now: Date.now,
    })

    registerUserPanelThemeIpc({
      ipcMain,
      assertPluginPanelSender,
      getRuntime: () => mainState.panelThemeRuntime,
      getPanelWindow: () => mainState.panelWindow,
      isDialogOpen: () => mainState.dialogOpen,
      setDialogOpen: value => { mainState.dialogOpen = value },
      showOpenDialog: (window, options) => dialog.showOpenDialog(window, options),
      showSaveDialog: (window, options) => dialog.showSaveDialog(window, options),
      translate: key => t(key),
      readImportFile: readUserPanelThemeImportFile,
      writeExportFile: writeUserPanelThemeExportFile,
    })  }

  function dispose(): void {
    mainState.pluginPanelViewController?.close()
    mainState.pluginPanelViewController = null
    mainState.pluginDeveloperModeWatcher?.destroy()
    mainState.pluginDeveloperModeWatcher = null
    mainState.pluginBroker?.destroy()
    mainState.pluginBroker = null
    mainState.pluginFeedController = null
    mainState.pluginAgentStatusController?.destroy()
    mainState.pluginAgentStatusController = null
    mainState.pluginSecretsStore = null
    mainState.pluginSecretConsentStore = null
    mainState.pluginSettingsStore = null
    mainState.pluginRuntimeContexts.clear()
    mainState.pluginPreferencesSnapshot = null
    mainState.pluginHostWindow?.close()
    mainState.pluginHostWindow = null
    mainState.pluginEventSourceController?.destroy()
    mainState.pluginEventSourceController = null
  }

  return { start, dispose }
}
