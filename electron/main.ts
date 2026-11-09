
import { app, BrowserWindow, screen, ipcMain, dialog, session, protocol, powerMonitor, Notification, shell, Menu } from 'electron'

import { join } from 'path'



import * as fs from 'fs'
import * as path from 'path'
import { createEventServer } from './event-server'
import { createAgentAdapterRegistry } from './agent-adapter'
import { createAgentAdapterOperations } from './agent-adapter-operations'
import { getQuotaUsage } from './quota'
import { writeJsonAtomic } from './desktop-preferences'






import { ProgressionStore } from './progression'





import { ProjectMcpRegistryStore } from './project-mcp-registry'
import { installProjectMcp, planProjectMcp, removeProjectMcp } from './project-mcp-setup'

import { PLUGIN_ARCHIVE_SKIN_IMAGE_MAX_BYTES } from './plugin-registry'





























import { locale, t } from '../src/i18n'








import { createPluginSkinPetId } from '../src/utils/pet-id.ts'

import { clampWindowBounds } from './pet-window-mode'
import { hookScriptDeployPath, installIntegration, uninstallIntegration, refreshInstalledIntegrationScripts, ensurePermissionToken, ensurePresentationToken, ensurePresentationMcpScript, presentationMcpScriptPath, resolveNodeBin } from './setup'
import { parsePetBehaviorManifest } from './pet-behavior-manifest'
import { shouldDisableDevHardwareAcceleration } from './dev-runtime'
import { ensureDirectoryWithin, writeFileWithin } from './ipc/pet-assets-fs.ts'

import { registerHistoryIpc } from './ipc/history'
import { pruneCorruptCopies } from './main/db-recovery'
import { registerProgressionIpc } from './ipc/progression'
import { registerDesktopIpc } from './ipc/desktop'
import { registerPermissionIpc } from './ipc/permission'
import { registerAdapterIpc } from './ipc/adapters'
import { registerProjectMcpIpc } from './ipc/project-mcp'
import { registerOnboardingIpc } from './ipc/onboarding'
import { configureSetupEnvironment } from './setup-environment'
import { OnboardingStore } from './onboarding-state'
import { registerProjectPetsIpc } from './ipc/project-pets'

import { registerPetAssetIpc } from './ipc/pet-assets'
import { PetImportStaging } from './pet-import.ts'
import { isIntegrationTarget, registerIntegrationIpc } from './ipc/integrations'
import { registerWindowControlsIpc } from './ipc/window-controls'
import { registerQuotaIpc } from './ipc/quota'
import { registerPetsIpc } from './ipc/pets'
import { registerReliabilityIpc } from './ipc/reliability'
import { registerSessionJumpIpc } from './ipc/session-jump'
import { takeSessionJumpContext } from './main/session-jump-runtime'

import { registerPetMotionIpc } from './ipc/pet-motion'
import { registerPetContextMenuIpc } from './ipc/pet-context-menu'
import { t as translate } from '../src/i18n'




import { mainState } from './main/state'
import { createShutdownCoordinator } from './main/shutdown'
import { acquireSingleInstanceLock, relaunchApp } from './relaunch'
import { disposeMainTimers } from './main/dispose-timers'
import { flushMainLog, logMain, teeConsoleToLog } from './diagnostics/main-log'
import { acquireRunMarker } from './diagnostics/session-marker'
import { installChildProcessGoneLogger, installCrashGuard, runStartupStep, type StartupStepResult } from './main/crash-guard'
import { setPluginPanelWindowBounds, MAX_PET_IMAGE_BYTES, MAX_PET_JSON_BYTES, MAX_PET_UNCOMPRESSED_BYTES, MAX_PET_ZIP_BYTES, MAX_PET_ZIP_ENTRIES, animateBounds, applyNormalPetBounds, assertTrustedIpcSender, availablePetIds, broadcastAchievementUnlock, broadcastDesktopPreferences, broadcastHistoryUpdated, broadcastPowerSaveState, broadcastProgression, broadcastProgressionIfChanged, clamp, clearEdgeDwell, computePanelBounds, configureSecureProtocol, createAchievementServices, createDesktopServices, createHistoryServices, createPanelWindow, createPermissionServices, isClaudePermissionRespondEnabled, createPetWindow, createPluginServices, createPresentationServices, createProgressionServices, createProjectRoutingServices, createWindowsFullscreenServices, currentDesktopPreferences, currentHistorySummary, currentPowerSaveState, displayForBounds, enabledPluginRoot, finiteNumber, getPetsJsonPath, hidePetWindow, initializePluginCatalogAutoCheck, isProgressionPetId, isSupportedRasterImage, isTrustedIpcSender, logAchievementDiagnostic, normalizeIngressEvent, persistCurrentPetWindowState, persistPetBounds, petModeState, rasterContentType, readRegularFileWithin, refreshLocalUsage, rehomePetWindowForDisplayChange, repositionVisiblePanel, safeJoin, sanitizePetId, scheduleEdgeDwell, scheduleShimejiPositionPersist, sendIntegrationTestEvent, setActiveProgressionPet, cancelHistoryStoreRetry, localPorts, reloadPetRenderers, registerRuntimeDiagnostics, exportDiagnostics, serverHealthTracker, setPetWindowMode, showPanelWindow, showPetWindow, syncPluginHost, syncWindowsFullscreenTargets, unregisterPermissionHotkeys, updateDesktopPreferences, waitForIntegrationTestReceipt, scheduleEdgeRedock, broadcastProgressionAwards, listPermissionAuditEntries, clearPermissionAuditLog, toggleMiniMode, requestPanelMinimum, resetPanelSize } from './main/runtime'





// Height in CSS px of the pet window's actually-painted content, reported by
// the pet renderer. The rest of the window is transparent tooltip headroom.








































































// Full-size bounds captured immediately before entering Edge. The native
// window is replaced by a small edge handle, so hover/click must restore this
// exact snapshot instead of deriving a new position from the handle bounds.








// Process-level error boundary: installed before anything else so a failure in
// any later service can never surface Electron's native crash dialog or kill
// the tray application silently.
teeConsoleToLog()
// setup.ts reaches Electron only through this seam so the installers can also run from the CLI and tests.
configureSetupEnvironment({
  appData: () => app.getPath('appData'),
  userData: () => app.getPath('userData'),
  isPackaged: () => app.isPackaged,
  resourcesPath: () => process.resourcesPath,
})

const runMarker = acquireRunMarker(join(app.getPath('userData'), 'logs'))
const crashGuard = installCrashGuard({
  log: (level, message, detail) => {
    if (level === 'error') console.error(message, ...(detail === undefined ? [] : [detail]))
    else console.warn(message)
  },
  onUserVisibleError: () => {
    try {
      if (!app.isReady() || !Notification.isSupported()) return
      new Notification({ title: t('reliability.crash.toastTitle'), body: t('reliability.crash.toastBody') }).show()
    } catch {}
  },
  onEscalate: () => { void showCrashEscalationDialog() },
})
installChildProcessGoneLogger(app, (_level, message) => console.error(message))
export const mainCrashGuardStats = () => crashGuard.stats()

// Enforce Chromium's renderer sandbox even if a future BrowserWindow option
// accidentally regresses. This must be called before app readiness.
app.enableSandbox()
// Chromium's GPU process can access-violate on some Windows desktop drivers
// while serving the Vite renderer. Safe mode is explicit and development-only;
// packaged builds and other platforms retain hardware acceleration.
if (shouldDisableDevHardwareAcceleration(
  process.platform,
  app.isPackaged,
  process.env.VITE_DEV_SERVER_URL,
  process.env.AGENT_PETS_GPU_SAFE_MODE,
)) {
  app.disableHardwareAcceleration()
  console.info('Hardware acceleration disabled for Windows development safe mode')
}
// Phase 3 uses Node's built-in SQLite driver. Electron exposes it behind the
// same experimental switch as the bundled Node runtime; keeping the switch in
// the main process avoids renderer access to the database or its handles.
app.commandLine.appendSwitch('experimental-sqlite')
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'agent-pets',
    // corsEnabled 讓面板能從 agent-pets://panel-theme 載入主題字型
    // （字型一律是 CORS 請求）。只有這條路由會送出
    // Access-Control-Allow-Origin 標頭，而且只給受信任的面板來源。
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
  },
])

// Fixed pane URL; the renderer never supplies a target.
const MACOS_LOGIN_ITEMS_SETTINGS_URL = 'x-apple.systempreferences:com.apple.LoginItems-Settings.extension'

// Async so a relaunched instance can wait for the old process to release the lock
// without blocking the main thread. bootstrapApp awaits it before creating windows.
const singleInstanceLock: Promise<boolean> = acquireSingleInstanceLock(
  () => app.requestSingleInstanceLock(),
  { argv: process.argv },
).then(acquired => {
  if (!acquired) {
    app.quit()
  } else {
    app.on('second-instance', () => {
      showPetWindow()
    })
  }
  return acquired
})

const startupResults: StartupStepResult[] = []
const startupLog = (level: 'error' | 'warn', message: string, detail?: unknown) => {
  console.error(message, ...(detail === undefined ? [] : [detail]))
  logMain(level, 'startup', message)
}
const startupTimings: Array<{ name: string; startMs: number; durationMs: number }> = []
const startupStep = async (name: string, fn: () => void | Promise<void>) => {
  const startMs = performance.now()
  try {
    return await runStartupStep(name, fn, startupLog, startupResults)
  } finally {
    const durationMs = performance.now() - startMs
    performance.mark(`agent-pets:startup:${name}`)
    startupTimings.push({ name, startMs: Math.round(startMs), durationMs: Math.round(durationMs * 10) / 10 })
  }
}

// Repeated uncaught errors: offer a restart once per run. Never relaunches on its own.
async function showCrashEscalationDialog(): Promise<void> {
  try {
    if (!app.isReady()) return
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: t('reliability.crash.escalateTitle'),
      message: t('reliability.crash.escalateMessage'),
      buttons: [t('reliability.crash.escalateRestart'), t('reliability.crash.escalateContinue')],
      defaultId: 0,
      cancelId: 1,
    })
    if (response === 0) {
      relaunchApp(app)
      shutdown.runNow()
      app.exit(0)
    }
  } catch {}
}

async function showStartupFailureDialog(): Promise<void> {
  try {
    const { response } = await dialog.showMessageBox({
      type: 'error',
      title: t('reliability.startup.failedTitle'),
      message: t('reliability.startup.failedMessage'),
      buttons: [t('reliability.startup.retry'), t('reliability.startup.quit')],
      defaultId: 0,
      cancelId: 1,
    })
    if (response === 0) {
      relaunchApp(app)
      shutdown.runNow()
      app.exit(0)
    } else {
      app.quit()
    }
  } catch {}
}

async function bootstrapApp(): Promise<void> {
  if (!(await singleInstanceLock)) return

  registerRuntimeDiagnostics(() => startupResults.map(result => ({ name: result.name, ok: result.ok, ...startupTimings.find(timing => timing.name === result.name) })), () => crashGuard.stats(), runMarker.previousRunUnclean)
  if (runMarker.previousRunUnclean) {
    logMain('warn', 'startup', 'previous run did not exit cleanly')
    try {
      if (Notification.isSupported()) {
        new Notification({ title: t('reliability.unclean.title'), body: t('reliability.unclean.body') }).show()
      }
    } catch {}
  }

  session.defaultSession.setPermissionCheckHandler(() => false)
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })

  await startupStep('integration-scripts', () => { mainState.eventToken = refreshInstalledIntegrationScripts(app.getVersion()) })
  await startupStep('adapters', () => {
    mainState.agentAdapterRegistry = createAgentAdapterRegistry(createAgentAdapterOperations({ claudePermissionRespondEnabled: isClaudePermissionRespondEnabled }))
    mainState.projectMcpRegistry = new ProjectMcpRegistryStore(
      join(app.getPath('userData'), 'project-mcp-registry.json'),
    )
  })
  await startupStep('project-routing', createProjectRoutingServices)
  let permissionToken = ''
  let presentationToken = ''
  await startupStep('tokens', () => {
    permissionToken = ensurePermissionToken()
    presentationToken = ensurePresentationToken()
  })
  await startupStep('protocol', configureSecureProtocol)
  await startupStep('windows-fullscreen', createWindowsFullscreenServices)
  await startupStep('desktop', createDesktopServices)
  // The pet becomes visible before plugins, history or achievements spin up,
  // so a slow plugin directory or disk never delays the first paint.
  await startupStep('pet-window', createPetWindow)
  await startupStep('plugins', createPluginServices)
  await startupStep('fullscreen-targets', () => {
    syncWindowsFullscreenTargets()
    mainState.windowsFullscreenDetector?.refresh()
  })
  await startupStep('power-monitor', () => {
    powerMonitor.on('resume', () => mainState.pluginHostWindow?.handleSystemResume())
    powerMonitor.on('on-battery', broadcastPowerSaveState)
    powerMonitor.on('on-ac', broadcastPowerSaveState)
    broadcastPowerSaveState()
  })
  await startupStep('presentation', () => createPresentationServices(presentationToken))
  await startupStep('plugin-host', async () => {
    await syncPluginHost()
    initializePluginCatalogAutoCheck()
  })
  await startupStep('display-events', () => {
    screen.on('display-added', rehomePetWindowForDisplayChange)
    screen.on('display-removed', rehomePetWindowForDisplayChange)
    screen.on('display-metrics-changed', rehomePetWindowForDisplayChange)
  })
  await startupStep('permission', () => createPermissionServices(permissionToken))
  await startupStep('progression', createProgressionServices)
  await startupStep('achievements', createAchievementServices)
  await startupStep('history', createHistoryServices)

  await startupStep('event-server', () => {
  mainState.eventServer = createEventServer(
    // 視窗關閉後變數可能尚未歸零；對已銷毀的 webContents send 會拋錯，導致
    // 事件回 400 且 onEvent（通知、XP、歷史）整個被跳過。
    () => [mainState.petWindow, mainState.panelWindow].filter((w): w is BrowserWindow => w !== null && !w.isDestroyed()),
    mainState.eventToken,
    (event) => {
      if (event.originalEvent === 'AgentPetsIntegrationTest') {
        mainState.pendingIntegrationTests.get(event.sessionId)?.()
      }
      try { mainState.sessionSnapshot.record(event) } catch {}
      try { mainState.sessionJump?.record(event, takeSessionJumpContext(event)) } catch {}
      try {
        mainState.desktopNotifications?.handleEvent(event)
      } catch {
        console.error('Desktop notification handling failed')
      }
      let progressionResult: ReturnType<ProgressionStore['handleEvent']> | undefined
      try {
        progressionResult = mainState.progressionStore?.handleEvent(event, event.routedPetId)
        if (progressionResult) {
          broadcastProgressionIfChanged(progressionResult.snapshot)
          broadcastProgressionAwards(progressionResult)
        }
      } catch (error) {
        console.error('Progression event handling failed', error)
      }
      try {
        // Achievement rules only depend on terminal completions and explicit
        // token usage. Do not open the achievement SQLite transaction for the
        // high-frequency thinking/tool-running heartbeat events that carry no
        // new fact; this keeps the additive subsystem off the hot path.
        if (
          currentDesktopPreferences().achievementsEnabled
          && mainState.achievementStore
          && (event.state === 'success' || event.tokenUsage !== undefined)
        ) {
          const routedPetId = event.routedPetId ?? progressionResult?.snapshot.petId ?? mainState.progressionStore?.getActivePetId() ?? 'aang-airbender'
          const unlocks = mainState.achievementStore.recordEvent(event, routedPetId, progressionResult?.snapshot)
          unlocks.forEach(broadcastAchievementUnlock)
        }
      } catch (error) {
        console.error('Achievement event handling failed', error)
        logAchievementDiagnostic('recordEvent', error, event)
      }
      try {
        const routedPetId = event.routedPetId ?? mainState.progressionStore?.getActivePetId() ?? 'aang-airbender'
        // Same-turn events share one SQLite commit; the broadcast is coalesced too.
        mainState.historyStore?.queueEvent(event, routedPetId, broadcastHistoryUpdated)
      } catch (error) {
        console.error('History event handling failed', error)
      }
    },
    normalizeIngressEvent,
    (() => {
      const health = serverHealthTracker().register('event', localPorts().event)
      return { port: localPorts().event, onStatus: health.onStatus, onPersistentFailure: health.onPersistentFailure, onHandle: health.attach }
    })(),
  )
  })

  registerSessionJumpIpc({
    ipcMain,
    assertTrustedIpcSender,
    runSessionJump: async (action, key) => mainState.sessionJump?.run(action, key) ?? { ok: false, error: 'unsupported' },
  })

  registerReliabilityIpc({
    ipcMain,
    isTrustedIpcSender,
    reportRendererError: report => {
      mainState.rendererErrorCount += 1
      logMain('error', `renderer:${report.window}`, `${report.kind}: ${report.message}`, report.stack)
    },
    reloadRenderers: reloadPetRenderers,
    assertTrustedIpcSender,
    getPanelWindow: () => mainState.panelWindow,
    getServerHealth: () => serverHealthTracker().snapshot(),
    getSessionSnapshot: () => mainState.sessionSnapshot.list(),
    exportDiagnostics,
    retryServer: id => serverHealthTracker().retry(id),
  })

  registerPetMotionIpc({
    ipcMain,
    getPetWindow: () => mainState.petWindow,
    isTrustedIpcSender,
    clearEdgeDwell,
    clearShimejiPersist: () => {
      if (mainState.shimejiPersistHandle) clearTimeout(mainState.shimejiPersistHandle)
      mainState.shimejiPersistHandle = null
    },
    getDragPollHandle: () => mainState.dragPollHandle,
    setDragPollHandle: handle => { mainState.dragPollHandle = handle },
    setInterval: (callback, delay) => setInterval(callback, delay),
    clearInterval: handle => clearInterval(handle),
    getCursorScreenPoint: () => screen.getCursorScreenPoint(),
    getPetWindowMode: () => mainState.petWindowMode,
    applyNormalPetBounds,
    setEdgeRestoreBounds: bounds => { mainState.edgeRestoreBounds = bounds },
    setAnchorBottomCenter: anchor => { mainState.anchorBottomCenter = anchor },
    getPanelWindow: () => mainState.panelWindow,
    persistCurrentPetWindowState,
    scheduleEdgeDwell,
    getDesktopPreferences: currentDesktopPreferences,
    hasActivePermissionRequests: () => mainState.permissionBroker?.hasActiveRequests() ?? false,
    currentPowerSaveState,
    displayForBounds,
    clampWindowBounds,
    setNormalPetBounds: bounds => { mainState.normalPetBounds = bounds },
    scheduleShimejiPositionPersist,
    repositionVisiblePanel,
    scheduleEdgeRedock,
    smoothWalk: true,
  })

  registerPetContextMenuIpc({
    ipcMain,
    getPetWindow: () => mainState.petWindow,
    isTrustedIpcSender,
    actions: {
      isDndEnabled: () => currentDesktopPreferences().dndEnabled,
      setDnd: enabled => { updateDesktopPreferences({ dndEnabled: enabled }) },
      getPetMode: () => mainState.petWindowMode,
      toggleMiniMode,
      openPanel: () => showPanelWindow('restore'),
      openSettings: () => showPanelWindow('settings'),
      hidePet: hidePetWindow,
      quit: () => app.quit(),
    },
    labels: () => ({
      dnd: translate('dnd'),
      miniMode: translate('miniMode'),
      openPanel: translate('openControlPanel'),
      openSettings: translate('openSettings'),
      hidePet: translate('hidePets'),
      quit: translate('quit'),
    }),
    popup: (template, window) => { Menu.buildFromTemplate(template).popup({ window }) },
  })

  registerWindowControlsIpc({
    ipcMain,
    isTrustedIpcSender,
    assertTrustedIpcSender,
    getPetWindow: () => mainState.petWindow,
    getPanelWindow: () => mainState.panelWindow,
    getDesktopPreferences: currentDesktopPreferences,
    getPetWindowMode: () => mainState.petWindowMode,
    getNormalPetBounds: () => mainState.normalPetBounds,
    setNormalPetBounds: value => { mainState.normalPetBounds = value },
    getEdgeRestoreBounds: () => mainState.edgeRestoreBounds,
    setEdgeRestoreBounds: value => { mainState.edgeRestoreBounds = value },
    getAnchorBottomCenter: () => mainState.anchorBottomCenter,
    setAnchorBottomCenter: value => { mainState.anchorBottomCenter = value },
    getPetContentHeight: () => mainState.petContentHeight,
    setPetContentHeight: value => { mainState.petContentHeight = value },
    setPanelFullscreenAutoHidden: value => { mainState.windowsFullscreenAutoHiddenPanel = value },
    setPanelBlurLock: lock => {
      if (lock.pinned !== undefined) mainState.panelPinned = lock.pinned
      if (lock.modal !== undefined) mainState.panelModalOpen = lock.modal
    },
    finiteNumber,
    clamp,
    requestPanelMinimum,
    resetPanelSize,
    getDisplayWorkArea: bounds => screen.getDisplayMatching(bounds).workArea,
    animateBounds,
    persistPetBounds,
    persistCurrentPetWindowState,
    repositionVisiblePanel,
    hidePetWindow,
    showPanelWindow: view => showPanelWindow(view),
    quit: () => app.quit(),
    relaunch: () => relaunchApp(app),
    exit: code => { shutdown.runNow(); app.exit(code) },
    setPresentationStatus: status => { mainState.presentationStatusProjection = status },
    updatePluginAgentStatus: status => { mainState.pluginAgentStatusController?.update(status) },
  })

  registerDesktopIpc({
    ipcMain,
    assertTrustedIpcSender,
    getPanelWindow: () => mainState.panelWindow,
    getDesktopPreferences: () => mainState.desktopPreferences,
    getDesktopTray: () => mainState.desktopTray,
    broadcastDesktopPreferences,
    updateDesktopPreferences,
    currentPowerSaveState,
    petModeState,
    setPetWindowMode,
    openLoginItemsSettings: async () => {
      if (process.platform !== 'darwin') return false
      try {
        await shell.openExternal(MACOS_LOGIN_ITEMS_SETTINGS_URL)
        return true
      } catch {
        return false
      }
    },
  })



  registerProgressionIpc({
    ipcMain,
    assertTrustedIpcSender,
    isProgressionPetId,
    setActiveProgressionPet,
    getProgressionStore: () => mainState.progressionStore,
    getAchievementStore: () => mainState.achievementStore,
  })

  registerPermissionIpc({
    ipcMain,
    assertTrustedIpcSender,
    getPetWindow: () => mainState.petWindow,
    getPanelWindow: () => mainState.panelWindow,
    getPermissionBroker: () => mainState.permissionBroker,
    listAudit: limit => listPermissionAuditEntries(limit),
    clearAudit: () => clearPermissionAuditLog(),
  })

  registerAdapterIpc({
    ipcMain,
    assertTrustedIpcSender,
    getPanelWindow: () => mainState.panelWindow,
    getPetWindow: () => mainState.petWindow,
    getAgentAdapterRegistry: () => mainState.agentAdapterRegistry,
  })

  registerQuotaIpc({
    ipcMain,
    assertTrustedIpcSender,
    getQuotaUsage,
    getHistoryStore: () => mainState.historyStore,
    broadcastHistoryUpdated,
    getWindows: () => [mainState.petWindow, mainState.panelWindow],
    logError: (message, error) => console.error(message, error),
  })

  registerHistoryIpc({
    ipcMain,
    assertTrustedIpcSender,
    getPanelWindow: () => mainState.panelWindow,
    getHistoryStore: () => mainState.historyStore,
    refreshLocalUsage,
    currentHistorySummary,
    broadcastHistoryUpdated,
    onHistoryCleared: () => pruneCorruptCopies(join(app.getPath('userData'), 'history.sqlite'), 0),
    documentsPath: () => app.getPath('documents'),
    joinPath: join,
    showSaveDialog: (window, options) => window
      ? dialog.showSaveDialog(window, options)
      : dialog.showSaveDialog(options),
    writeJsonAtomic,
    writeTextFile: (filePath, text) => fs.writeFileSync(filePath, text, { encoding: 'utf8', mode: 0o600 }),
    revealPath: filePath => shell.showItemInFolder(filePath),
    growthExport: petId => ({
      progression: mainState.progressionStore?.getSnapshot(petId) ?? null,
      achievements: (mainState.achievementStore?.getSnapshot(petId, mainState.progressionStore?.getSnapshot(petId))
        .achievements ?? []).filter(item => item.unlocked).map(item => ({ id: item.id, unlockedAt: item.unlockedAt ?? null })),
    }),
    activePetId: () => mainState.progressionStore?.getActivePetId() ?? null,
  })

  registerIntegrationIpc({
    ipcMain,
    assertTrustedIpcSender,
    getPanelWindow: () => mainState.panelWindow,
    sendIntegrationTestEvent,
    waitForIntegrationTestReceipt,
    installIntegration,
    uninstallIntegration,
    isIntegrationTarget,
  })

  registerProjectPetsIpc({
    ipcMain,
    assertTrustedIpcSender,
    getPanelWindow: () => mainState.panelWindow,
    getPetWindow: () => mainState.petWindow,
    getStore: () => mainState.projectRoutingStore,
    availablePetIds,
    isDialogOpen: () => mainState.dialogOpen,
    setDialogOpen: value => { mainState.dialogOpen = value },
    showOpenDialog: (window, options) => dialog.showOpenDialog(window, options),
    chooseProjectPetTitle: () => t('chooseProjectPet'),
    chooseProjectPetHelp: () => t('chooseProjectPetHelp'),
    logError: (message, error) => console.error(message, error),
  })

  const onboardingStore = new OnboardingStore(join(app.getPath('userData'), 'onboarding.json'))
  registerOnboardingIpc({
    ipcMain,
    assertTrustedIpcSender: event => assertTrustedIpcSender(event),
    getStore: () => onboardingStore,
  })

  registerProjectMcpIpc({
    ipcMain,
    assertTrustedIpcSender,
    getPanelWindow: () => mainState.panelWindow,
    getPetWindow: () => mainState.petWindow,
    isDialogOpen: () => mainState.dialogOpen,
    setDialogOpen: value => { mainState.dialogOpen = value },
    showOpenDialog: (window, options) => dialog.showOpenDialog(window, options),
    ensurePresentationMcpScript,
    installOptions: () => ({ nodeExecutable: resolveNodeBin(), bridgePath: presentationMcpScriptPath() }),
    getRegistry: () => mainState.projectMcpRegistry,
    getLocale: () => currentDesktopPreferences().locale,
    installProjectMcp,
    planProjectMcp,
    removeProjectMcp,
  })

  registerPetsIpc({
    ipcMain,
    assertTrustedIpcSender,
    fs: fs.promises,
    path,
    builtinPetsPath: getPetsJsonPath,
    customPetsPath: hookScriptDeployPath,
    parseBehaviorManifest: parsePetBehaviorManifest,
    sanitizePetId,
    safeJoin,
    pluginsEnabled: () => mainState.pluginPreferencesSnapshot?.pluginsEnabled === true,
    pluginContexts: () => mainState.pluginRuntimeContexts,
    enabledPluginRoot,
    createPluginSkinPetId,
    readRegularFileWithin,
    rasterContentType,
    pluginSkinImageMaxBytes: PLUGIN_ARCHIVE_SKIN_IMAGE_MAX_BYTES,
    locale: () => locale.value,
    pluginVersion: pluginId => mainState.pluginRegistry?.list().find(entry => entry.id === pluginId)?.currentVersion ?? '',
  })

  mainState.petImport = new PetImportStaging({
    root: hookScriptDeployPath(),
    sanitizePetId,
    builtinPetIds: async () => {
      const raw = JSON.parse(await fs.promises.readFile(getPetsJsonPath(), 'utf-8')) as unknown
      return Array.isArray(raw) ? raw.flatMap(pet => (pet && typeof pet.id === 'string' ? [pet.id] : [])) : []
    },
  })
  // Crash recovery for interrupted imports; never blocks startup.
  void mainState.petImport.recoverStale().catch(() => undefined)
  registerPetAssetIpc({
    ipcMain,
    assertTrustedIpcSender,
    getPanelWindow: () => mainState.panelWindow,
    getPetWindow: () => mainState.petWindow,
    setDialogOpen: value => { mainState.dialogOpen = value },
    showOpenDialog: (window, options) => dialog.showOpenDialog(window, options),
    customPetsRoot: hookScriptDeployPath,
    safeJoin,
    sanitizePetId,
    ensureDir: directory => ensureDirectoryWithin(hookScriptDeployPath(), directory),
    writeFileEnsured: (filePath, contents) => writeFileWithin(hookScriptDeployPath(), filePath, contents),
    parsePetBehaviorManifest,
    isSupportedRasterImage,
    petImport: mainState.petImport!,
    fs: fs.promises,
    path,
    customPetDescription: () => t('customPet'),
    maxPetZipBytes: MAX_PET_ZIP_BYTES,
    maxPetZipEntries: MAX_PET_ZIP_ENTRIES,
    maxPetUncompressedBytes: MAX_PET_UNCOMPRESSED_BYTES,
    maxPetJsonBytes: MAX_PET_JSON_BYTES,
    maxPetImageBytes: MAX_PET_IMAGE_BYTES,
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createPetWindow()
      createPanelWindow()
    } else {
      showPetWindow()
    }
  })

  // The hidden panel is a second Chromium renderer running the whole Vue app.
  // Creating it last keeps it from competing with the pet's first paint and the
  // service steps above; ensureDesktopWindows() creates it on demand if the user
  // opens it earlier. Every panelWindow consumer already tolerates null.
  await startupStep('panel-window', createPanelWindow)
  syncWindowsFullscreenTargets()
  if (startupResults.some(result => !result.ok)) {
    // Services start independently, so a partial failure still leaves a usable
    // app. Only offer retry/quit when nothing visible could be created.
    if (!mainState.petWindow) await showStartupFailureDialog()
  }
}

app.whenReady().then(bootstrapApp).catch(async error => {
  startupLog('error', 'Application bootstrap failed', error)
  try {
    if (!mainState.petWindow) createPetWindow()
  } catch (windowError) {
    startupLog('error', 'Fallback pet window failed', windowError)
  }
  await showStartupFailureDialog()
})

function teardownMainServices(): void {
  mainState.isQuitting = true
  runMarker.clear()
  flushMainLog()
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
  mainState.windowsFullscreenDetector?.stop()
  mainState.windowsFullscreenDetector = null
  if (mainState.panelBlurHideHandle) clearTimeout(mainState.panelBlurHideHandle)
  mainState.panelBlurHideHandle = null
  mainState.windowsFullscreenAutoHiddenPet = false
  mainState.windowsFullscreenAutoHiddenPanel = false
  cancelHistoryStoreRetry()
  if (mainState.pluginCatalogAutoCheckTimer) clearInterval(mainState.pluginCatalogAutoCheckTimer)
  mainState.pluginCatalogAutoCheckTimer = null
  if (mainState.localUsageScanTimer) clearInterval(mainState.localUsageScanTimer)
  mainState.localUsageScanTimer = null
  mainState.localUsageReader = null
  mainState.localUsageScanPromise = null
  mainState.presentationController?.clear()
  mainState.permissionBroker?.shutdown()
  mainState.progressionStore?.close()
  mainState.progressionStore = null
  if (mainState.achievementStoreRetryTimer) clearTimeout(mainState.achievementStoreRetryTimer)
  mainState.achievementStoreRetryTimer = null
  mainState.achievementStore?.close()
  mainState.achievementStore = null
  mainState.historyStore?.close()
  mainState.historyStore = null
  mainState.projectRoutingStore?.close()
  mainState.projectRoutingStore = null
  disposeMainTimers(mainState)
}

const shutdown = createShutdownCoordinator({
  // Debounced position writes must land before the stores close or the app exits.
  flush: () => {
    if (mainState.persistBoundsHandle || mainState.shimejiPersistHandle) persistCurrentPetWindowState()
  },
  pendingWork: () => mainState.localUsageScanPromise,
  teardown: teardownMainServices,
  quit: () => app.quit(),
  log: (message, error) => console.error(message, error),
})

app.on('before-quit', event => {
  mainState.isQuitting = true
  shutdown.onBeforeQuit(event)
})

app.on('will-quit', () => {
  unregisterPermissionHotkeys()
  mainState.permissionRelay?.shutdown()
  mainState.permissionRelay = null
  mainState.permissionBroker = null
  mainState.permissionAdapterServer?.closeAllConnections?.()
  mainState.permissionAdapterServer?.close()
  mainState.permissionAdapterServer = null
  mainState.desktopNotifications?.destroy()
  mainState.desktopNotifications = null
  mainState.desktopTray?.destroy()
  mainState.desktopTray = null
  mainState.presentationMcpServer?.closeAllConnections?.()
  mainState.presentationMcpServer?.close()
  mainState.presentationMcpServer = null
  mainState.presentationController = null
  mainState.eventServer?.closeAllConnections?.()
  mainState.eventServer?.close()
  mainState.eventServer = null
})

// Agent Pets is a tray application on every supported desktop platform.
// Hiding or closing its windows must not stop hooks or background status.
app.on('window-all-closed', () => {
  // Intentionally keep the main process alive until the user chooses Quit.
})
