import { IPC_CHANNELS } from './ipc/channels'
import type { ElectronAPI } from '../src/types/electron-api'
import type { AdapterDiagnoseIpcResult, AdapterInstallIpcResult, AdapterUninstallIpcResult } from '../src/types/ipc'
import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopPreferences, DesktopPreferencesPatch } from '../src/types/desktop'
import type { SessionJumpRequest, SessionJumpResult } from '../src/types/session-jump'
import type { PermissionDecisionValue, PermissionRequestView, PermissionAuditEntry } from '../src/types/permission'
import type { ProgressionAwardEvent, ProgressionInsights, ProgressionSnapshot } from '../src/types/progression'
import type { AchievementSnapshot, AchievementUnlock } from '../src/types/achievement'
import type { HistoryClearResult, HistoryCommandResult, HistoryExportRequest, HistorySessionDetail, HistorySessionPage, HistorySessionQuery, HistorySummary, HistoryUsageBlock } from '../src/types/history'
import type { PetWindowMode, PetWindowModeState } from '../src/types/pet-window'
import type { PetBehaviorManifest, PluginSkinPetSource } from '../src/types/pet'
import type { PetImportDecision } from '../src/types/pet-import'
import type { PresentationIntent, PresentationStatusUpdate } from '../src/types/presentation'
import type {
  PluginBadgeView,
  PluginBrokerDiagnostic,
  PluginBrokerLogEntry,
  PluginFeedItem,
  PluginEventSourceStatusView,
  PluginGlobalPreferencesPatch,
  PluginInstallPlan,
  PluginNotificationRecord,
  PluginPanelPlugin,
  PluginPanelSettingsSnapshot,
  PluginPanelResult,
  PluginPanelSnapshot,
  PluginPanelViewClosedEvent,
  PluginPreferences,
  PluginSettingScalar,
} from '../src/types/plugin.ts'
import type { PluginCatalogPanelItem } from '../src/types/plugin-catalog.ts'
import type { PanelThemeIpcResult, PanelThemeMode, PanelThemeRef, PanelThemeState, PanelThemeUserImageOptions, PetThemeState } from '../src/types/panel-theme.ts'
import type { PanelThemeValidateIpcResult, UserPanelThemeDefinition, UserPanelThemeIpcResult } from '../src/types/panel-theme-user.ts'
import type {
  ProjectMcpApplyRequest,
  ProjectMcpPlan,
  ProjectMcpRegistrySnapshot,
  ProjectMcpRemovalSummary,
  ProjectMcpSetupSummary,
} from '../src/types/project-mcp'
import type { ProjectPetArchiveResult, ProjectPetCommandResult, ProjectPetView } from '../src/types/project-pet'
import type { AgentAdapterId } from '../src/types/agent-adapter'
import type { OnboardingAction, OnboardingState } from '../src/types/onboarding'
import type { SessionSnapshotEntry } from './main/session-snapshot'
import type { LocalServerHealthSnapshot, LocalServerId } from '../src/types/reliability'

const electronAPI: ElectronAPI = {
  onAgentStatusEvent: (callback: (event: unknown) => void) => {
    const handler = (_event: unknown, data: unknown) => {
      if (Array.isArray(data)) {
        for (const item of data) callback(item)
      } else {
        callback(data)
      }
    }
    ipcRenderer.on(IPC_CHANNELS.agentStatusEvent, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.agentStatusEvent, handler)
    }
  },
  onPresentationIntent: (callback: (intent: PresentationIntent) => void) => {
    const handler = (_event: unknown, intent: PresentationIntent) => callback(intent)
    ipcRenderer.on(IPC_CHANNELS.presentationIntent, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.presentationIntent, handler)
    }
  },
  onPluginFeedItem: (callback: (item: PluginFeedItem) => void) => {
    const handler = (_event: unknown, item: PluginFeedItem) => callback(item)
    ipcRenderer.on(IPC_CHANNELS.pluginFeedItem, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.pluginFeedItem, handler)
    }
  },
  onPluginFeedUnreadCount: (callback: (count: number) => void) => {
    const handler = (_event: unknown, count: number) => callback(count)
    ipcRenderer.on(IPC_CHANNELS.pluginFeedUnreadCount, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.pluginFeedUnreadCount, handler)
    }
  },
  getPluginFeedUnreadCount: (): Promise<number> => ipcRenderer.invoke(IPC_CHANNELS.pluginFeedUnreadCount),
  getPluginBadges: (): Promise<PluginBadgeView[]> => ipcRenderer.invoke(IPC_CHANNELS.pluginBadgesGet),
  onPluginBadgesChanged: (callback: (badges: PluginBadgeView[]) => void) => {
    const handler = (_event: unknown, badges: PluginBadgeView[]) => callback(badges)
    ipcRenderer.on(IPC_CHANNELS.pluginBadgesUpdated, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.pluginBadgesUpdated, handler)
  },
  getPluginEventSourceStatuses: (): Promise<PluginEventSourceStatusView[]> => ipcRenderer.invoke(IPC_CHANNELS.pluginEventSourceList),
  onPluginEventSourceChanged: (callback: (statuses: PluginEventSourceStatusView[]) => void) => {
    const handler = (_event: unknown, statuses: PluginEventSourceStatusView[]) => callback(statuses)
    ipcRenderer.on(IPC_CHANNELS.pluginEventSourceUpdated, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.pluginEventSourceUpdated, handler)
  },
  onPluginSkinsChanged: (callback: (removedPetIds: string[]) => void) => {
    const handler = (_event: unknown, petIds: string[]) => callback(petIds)
    ipcRenderer.on(IPC_CHANNELS.pluginSkinsChanged, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.pluginSkinsChanged, handler)
  },
  notifyPluginSkinFallback: (petIds: string[]): Promise<number> => ipcRenderer.invoke(IPC_CHANNELS.pluginSkinFallbackNotify, petIds),
  getPanelThemeState: (): Promise<PanelThemeIpcResult> => ipcRenderer.invoke(IPC_CHANNELS.panelThemeStateGet),
  setPanelThemeAppearance: (appearance: { mode: PanelThemeMode; forcedColors: boolean }): void => ipcRenderer.send(IPC_CHANNELS.panelThemeAppearanceSet, appearance),
  setPanelThemeSlot: (mode: PanelThemeMode, ref: PanelThemeRef | null): Promise<PanelThemeIpcResult> => ipcRenderer.invoke(IPC_CHANNELS.panelThemeSlotSet, mode, ref),
  importPanelThemeUserImage: (ref: PanelThemeRef, mode: PanelThemeMode): Promise<PanelThemeIpcResult> => ipcRenderer.invoke(IPC_CHANNELS.panelThemeUserImageImport, ref, mode),
  clearPanelThemeUserImage: (ref: PanelThemeRef, mode: PanelThemeMode): Promise<PanelThemeIpcResult> => ipcRenderer.invoke(IPC_CHANNELS.panelThemeUserImageClear, ref, mode),
  setPanelThemeUserImageOptions: (ref: PanelThemeRef, mode: PanelThemeMode, options: PanelThemeUserImageOptions): Promise<PanelThemeIpcResult> => ipcRenderer.invoke(IPC_CHANNELS.panelThemeUserImageOptionsSet, ref, mode, options),
  validatePanelTheme: (definition: unknown): Promise<PanelThemeValidateIpcResult> => ipcRenderer.invoke(IPC_CHANNELS.panelThemeValidate, definition),
  listUserPanelThemes: (): Promise<UserPanelThemeIpcResult> => ipcRenderer.invoke(IPC_CHANNELS.panelThemeUserList),
  createUserPanelTheme: (name: string, definition: UserPanelThemeDefinition): Promise<UserPanelThemeIpcResult> => ipcRenderer.invoke(IPC_CHANNELS.panelThemeUserCreate, name, definition),
  updateUserPanelTheme: (id: string, definition: UserPanelThemeDefinition, name?: string): Promise<UserPanelThemeIpcResult> => ipcRenderer.invoke(IPC_CHANNELS.panelThemeUserUpdate, id, definition, ...(name === undefined ? [] : [name])),
  renameUserPanelTheme: (id: string, name: string): Promise<UserPanelThemeIpcResult> => ipcRenderer.invoke(IPC_CHANNELS.panelThemeUserRename, id, name),
  duplicateUserPanelTheme: (id: string, name: string): Promise<UserPanelThemeIpcResult> => ipcRenderer.invoke(IPC_CHANNELS.panelThemeUserDuplicate, id, name),
  deleteUserPanelTheme: (id: string): Promise<UserPanelThemeIpcResult> => ipcRenderer.invoke(IPC_CHANNELS.panelThemeUserDelete, id),
  exportUserPanelTheme: (id: string): Promise<UserPanelThemeIpcResult> => ipcRenderer.invoke(IPC_CHANNELS.panelThemeUserExport, id),
  importUserPanelTheme: (): Promise<UserPanelThemeIpcResult> => ipcRenderer.invoke(IPC_CHANNELS.panelThemeUserImport),
  getPetStatusTheme: (): Promise<PetThemeState> => ipcRenderer.invoke(IPC_CHANNELS.panelThemePetStatusGet),
  onPetStatusThemeChanged: (callback: (state: PetThemeState) => void) => {
    const handler = (_event: unknown, state: PetThemeState) => callback(state)
    ipcRenderer.on(IPC_CHANNELS.panelThemePetStatusChanged, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.panelThemePetStatusChanged, handler)
  },
  onPanelThemeChanged: (callback: (state: PanelThemeState) => void) => {
    const handler = (_event: unknown, state: PanelThemeState) => callback(state)
    ipcRenderer.on(IPC_CHANNELS.panelThemeChanged, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.panelThemeChanged, handler)
  },
  completePluginFeed: (itemId: string): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.pluginFeedComplete, itemId),
  openPluginFeedLink: (itemId: string): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.pluginFeedOpenLink, itemId),
  getPluginPanelSnapshot: (): Promise<PluginPanelResult<PluginPanelSnapshot>> => ipcRenderer.invoke(IPC_CHANNELS.pluginPanelSnapshot),
  invokePluginCommand: (pluginId: string, commandId: string): Promise<PluginPanelResult<{ accepted: true }>> => ipcRenderer.invoke(IPC_CHANNELS.pluginCommandInvoke, pluginId, commandId),
  openPluginPanelView: (pluginId: string, frame: unknown, content: unknown): Promise<PluginPanelResult<{ opened: true; openToken: number }>> => ipcRenderer.invoke(IPC_CHANNELS.pluginPanelViewOpen, pluginId, { frame, content }),
  closePluginPanelView: (openToken: number): void => ipcRenderer.send(IPC_CHANNELS.pluginPanelViewClose, openToken),
  setPluginPanelViewBounds: (openToken: number, frame: unknown, content: unknown, viewport: unknown): void => ipcRenderer.send(IPC_CHANNELS.pluginPanelViewBounds, { openToken, frame, content, viewport }),
  onPluginPanelViewClosed: (callback: (event: PluginPanelViewClosedEvent) => void) => {
    const handler = (_event: unknown, data: PluginPanelViewClosedEvent) => callback(data)
    ipcRenderer.on(IPC_CHANNELS.pluginPanelViewClosed, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.pluginPanelViewClosed, handler)
  },
  openPluginPanelFromPet: (pluginId: string): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.pluginPanelViewOpenFromPet, pluginId),
  getPluginSettings: (pluginId: string): Promise<PluginPanelResult<PluginPanelSettingsSnapshot>> => ipcRenderer.invoke(IPC_CHANNELS.pluginSettingsGet, pluginId),
  setPluginSettings: (pluginId: string, value: Record<string, PluginSettingScalar>): Promise<PluginPanelResult<Record<string, PluginSettingScalar>>> => ipcRenderer.invoke(IPC_CHANNELS.pluginSettingsSet, pluginId, value),
  getPluginSecretConsent: (): Promise<PluginPanelResult<boolean>> => ipcRenderer.invoke(IPC_CHANNELS.pluginSecretConsentGet),
  acceptPluginSecretConsent: (): Promise<PluginPanelResult<boolean>> => ipcRenderer.invoke(IPC_CHANNELS.pluginSecretConsentAccept),
  setPluginSecret: (pluginId: string, key: string, value: string): Promise<PluginPanelResult<{ configured: boolean }>> => ipcRenderer.invoke(IPC_CHANNELS.pluginSecretSet, pluginId, key, value),
  setPluginGlobalPreferences: (patch: PluginGlobalPreferencesPatch): Promise<PluginPanelResult<PluginPreferences>> => ipcRenderer.invoke(IPC_CHANNELS.pluginPreferencesGlobalSet, patch),
  listPluginCatalog: (): Promise<PluginPanelResult<PluginCatalogPanelItem[]>> => ipcRenderer.invoke(IPC_CHANNELS.pluginCatalogList),
  installPluginFromCatalog: (pluginId: string, version: string): Promise<PluginPanelResult<PluginInstallPlan>> => ipcRenderer.invoke(IPC_CHANNELS.pluginCatalogInstall, pluginId, version),
  reportInstalledPluginIssue: (pluginId: string): Promise<PluginPanelResult<{ opened: true }>> => ipcRenderer.invoke(IPC_CHANNELS.pluginReportIssue, pluginId),
  setPluginInstancePreferences: (pluginId: string, patch: unknown): Promise<PluginPanelResult<PluginPreferences>> => ipcRenderer.invoke(IPC_CHANNELS.pluginPreferencesInstanceSet, pluginId, patch),
  selectPluginArchive: (): Promise<PluginPanelResult<PluginInstallPlan>> => ipcRenderer.invoke(IPC_CHANNELS.pluginInstallSelect),
  selectPluginFolder: (): Promise<PluginPanelResult<PluginInstallPlan>> => ipcRenderer.invoke(IPC_CHANNELS.pluginInstallSelectFolder),
  installPluginPlan: (token: string, acceptAdditionalPermissions: boolean, acceptSignatureChange: boolean): Promise<PluginPanelResult<PluginPanelPlugin>> => ipcRenderer.invoke(IPC_CHANNELS.pluginInstallConfirm, token, acceptAdditionalPermissions, acceptSignatureChange),
  removeInstalledPlugin: (pluginId: string, keepData: boolean): Promise<PluginPanelResult<{ removed: true; keptData: boolean }>> => ipcRenderer.invoke(IPC_CHANNELS.pluginRemove, pluginId, keepData),
  getPluginDiagnostics: (pluginId: string): Promise<PluginPanelResult<{ logs: PluginBrokerLogEntry[]; diagnostics: PluginBrokerDiagnostic[] }>> => ipcRenderer.invoke(IPC_CHANNELS.pluginDiagnostics, pluginId),
  listPluginNotifications: (): Promise<PluginPanelResult<PluginNotificationRecord[]>> => ipcRenderer.invoke(IPC_CHANNELS.pluginNotificationsList),
  markPluginNotificationRead: (itemId: string): Promise<PluginPanelResult<{ read: boolean }>> => ipcRenderer.invoke(IPC_CHANNELS.pluginNotificationsRead, itemId),
  markAllPluginNotificationsRead: (pluginId?: string): Promise<PluginPanelResult<{ marked: number }>> => ipcRenderer.invoke(IPC_CHANNELS.pluginNotificationsReadAll, pluginId),
  clearPluginNotifications: (pluginId?: string): Promise<PluginPanelResult<{ removed: number }>> => ipcRenderer.invoke(IPC_CHANNELS.pluginNotificationsClear, pluginId),
  onPluginNotificationsChanged: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on(IPC_CHANNELS.pluginNotificationsChanged, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.pluginNotificationsChanged, handler)
  },
  publishPresentationStatus: (snapshot: PresentationStatusUpdate) => {
    ipcRenderer.send(IPC_CHANNELS.presentationStatusUpdate, snapshot)
  },

  startDrag: () => {
    ipcRenderer.send(IPC_CHANNELS.petDragStart)
  },

  notifyDragEnd: (moved: boolean) => {
    ipcRenderer.send(IPC_CHANNELS.petDragEnd, { moved })
  },

  notifyPetHover: () => {
    ipcRenderer.send(IPC_CHANNELS.petWindowHover)
  },

  shimejiWalkStep: (deltaX: number) => {
    if (!Number.isFinite(deltaX)) return
    ipcRenderer.send(IPC_CHANNELS.shimejiWalkStep, { deltaX })
  },

  setPetWindowMode: (mode: PetWindowMode): Promise<PetWindowModeState> => {
    return ipcRenderer.invoke(IPC_CHANNELS.petWindowModeSet, mode)
  },

  initializePetWindowMode: (): Promise<PetWindowModeState> => {
    return ipcRenderer.invoke(IPC_CHANNELS.petWindowModeInit)
  },

  onPetWindowModeUpdated: (callback: (state: PetWindowModeState) => void) => {
    const handler = (_event: unknown, state: PetWindowModeState) => callback(state)
    ipcRenderer.on(IPC_CHANNELS.petWindowModeUpdated, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.petWindowModeUpdated, handler)
    }
  },

  resizeWindow: (width: number, height: number) => {
    ipcRenderer.send(IPC_CHANNELS.petResize, { width, height })
  },

  reportContentHeight: (height: number) => {
    ipcRenderer.send(IPC_CHANNELS.petContentHeight, { height })
  },

  setMousePassthrough: (ignore: boolean) => {
    ipcRenderer.send(IPC_CHANNELS.petMousePassthrough, { ignore })
  },

  requestPetHide: () => {
    ipcRenderer.send(IPC_CHANNELS.petHideRequest)
  },

  showPetContextMenu: () => {
    ipcRenderer.send(IPC_CHANNELS.petContextMenu)
  },

  getOnboardingState: (): Promise<OnboardingState | null> => ipcRenderer.invoke(IPC_CHANNELS.onboardingGet),

  updateOnboardingState: (action: OnboardingAction): Promise<OnboardingState | null> => {
    return ipcRenderer.invoke(IPC_CHANNELS.onboardingUpdate, action)
  },

  togglePanel: () => {
    ipcRenderer.send(IPC_CHANNELS.panelToggle)
  },

  // Asks for a transient minimum size (wizard / MCP) or releases it ({ release: true });
  // the user's own panel size is owned by the main process. The positional
  // (height, width) form is kept for existing callers.
  resizePanel: (size: { height?: number; width?: number; release?: boolean } | number, legacyWidth?: number) => {
    const data = typeof size === 'number' ? { height: size, width: legacyWidth } : size
    ipcRenderer.send(IPC_CHANNELS.panelResize, {
      ...(data.release === true ? { release: true } : {}),
      ...(data.height === undefined ? {} : { height: data.height }),
      ...(data.width === undefined ? {} : { width: data.width }),
    })
  },

  resetPanelSize: () => {
    ipcRenderer.send(IPC_CHANNELS.panelResetSize)
  },

  setPanelBlurLock: (lock: { pinned?: boolean; modal?: boolean }) => {
    ipcRenderer.send(IPC_CHANNELS.panelBlurLock, lock)
  },

  hidePanel: () => {
    ipcRenderer.send(IPC_CHANNELS.panelHide)
  },

  reportRendererError: (report: { message: string; stack?: string; kind: 'vue' | 'unhandledrejection' | 'error' }): void => {
    ipcRenderer.send(IPC_CHANNELS.rendererErrorReport, report)
  },

  reloadRenderer: (): void => {
    ipcRenderer.send(IPC_CHANNELS.rendererReload)
  },

  exportDiagnostics: (): Promise<{ ok: boolean; canceled?: boolean }> => ipcRenderer.invoke(IPC_CHANNELS.diagnosticsExport),

  getSessionSnapshot: (): Promise<SessionSnapshotEntry[]> => ipcRenderer.invoke(IPC_CHANNELS.sessionSnapshotGet),

  runSessionJump: (request: SessionJumpRequest): Promise<SessionJumpResult> => ipcRenderer.invoke(IPC_CHANNELS.sessionJump, request),

  getServerHealth: (): Promise<LocalServerHealthSnapshot> => ipcRenderer.invoke(IPC_CHANNELS.serverHealthGet),

  retryServerHealth: (id?: LocalServerId): Promise<LocalServerHealthSnapshot> => ipcRenderer.invoke(IPC_CHANNELS.serverHealthRetry, id),

  onServerHealthChanged: (callback: (snapshot: LocalServerHealthSnapshot) => void) => {
    const handler = (_event: unknown, payload: unknown) => {
      if (payload && typeof payload === 'object' && Array.isArray((payload as { servers?: unknown }).servers)) {
        callback(payload as LocalServerHealthSnapshot)
      }
    }
    ipcRenderer.on(IPC_CHANNELS.serverHealthChanged, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.serverHealthChanged, handler)
    }
  },

  onPanelOpened: (callback: (options: { restore: boolean }) => void) => {
    const handler = (_event: unknown, payload: unknown) => callback({
      restore: Boolean(payload && typeof payload === 'object' && (payload as { restore?: unknown }).restore === true),
    })
    ipcRenderer.on(IPC_CHANNELS.panelOpened, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.panelOpened, handler)
    }
  },

  onPanelOpenSettings: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on(IPC_CHANNELS.panelOpenSettings, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.panelOpenSettings, handler)
    }
  },

  onPanelOpenPluginView: (callback: (pluginId: string) => void) => {
    const handler = (_event: unknown, pluginId: string) => callback(pluginId)
    ipcRenderer.on(IPC_CHANNELS.panelOpenPluginView, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.panelOpenPluginView, handler)
  },

  initializeDesktopPreferences: (legacySoundEnabled: boolean): Promise<DesktopPreferences> => {
    return ipcRenderer.invoke(IPC_CHANNELS.desktopPreferencesInit, legacySoundEnabled)
  },

  openLoginItemsSettings: (): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.desktopOpenLoginItemsSettings)
  },

  setDesktopPreferences: (patch: DesktopPreferencesPatch): Promise<DesktopPreferences> => {
    return ipcRenderer.invoke(IPC_CHANNELS.desktopPreferencesSet, patch)
  },

  getPowerSaveState: (): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.powerSaveState)
  },

  onPowerSaveStateUpdated: (callback: (powerSave: boolean) => void) => {
    const handler = (_event: unknown, powerSave: boolean) => callback(powerSave)
    ipcRenderer.on(IPC_CHANNELS.powerSaveStateUpdated, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.powerSaveStateUpdated, handler)
    }
  },

  initializeProgression: (petId?: string): Promise<ProgressionSnapshot | null> => {
    return ipcRenderer.invoke(IPC_CHANNELS.progressionInit, petId)
  },

  setProgressionPet: (petId: string): Promise<ProgressionSnapshot | null> => {
    return ipcRenderer.invoke(IPC_CHANNELS.progressionSetPet, petId)
  },

  initializeAchievements: (petId?: string): Promise<AchievementSnapshot | null> => {
    return ipcRenderer.invoke(IPC_CHANNELS.achievementsInit, petId)
  },

  onAchievementsUpdated: (callback: (snapshot: AchievementSnapshot) => void) => {
    const handler = (_event: unknown, snapshot: AchievementSnapshot) => callback(snapshot)
    ipcRenderer.on(IPC_CHANNELS.achievementsUpdated, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.achievementsUpdated, handler)
    }
  },

  onAchievementUnlocked: (callback: (unlock: AchievementUnlock) => void) => {
    const handler = (_event: unknown, unlock: AchievementUnlock) => callback(unlock)
    ipcRenderer.on(IPC_CHANNELS.achievementUnlocked, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.achievementUnlocked, handler)
    }
  },

  getProgressionInsights: (petId?: string): Promise<ProgressionInsights | null> => {
    return ipcRenderer.invoke(IPC_CHANNELS.progressionInsights, petId)
  },

  onProgressionAwarded: (callback: (event: ProgressionAwardEvent) => void) => {
    const handler = (_event: unknown, payload: ProgressionAwardEvent) => callback(payload)
    ipcRenderer.on(IPC_CHANNELS.progressionAwarded, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.progressionAwarded, handler)
    }
  },

  onProgressionUpdated: (callback: (snapshot: ProgressionSnapshot) => void) => {
    const handler = (_event: unknown, snapshot: ProgressionSnapshot) => callback(snapshot)
    ipcRenderer.on(IPC_CHANNELS.progressionUpdated, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.progressionUpdated, handler)
    }
  },

  onDesktopPreferencesUpdated: (callback: (preferences: DesktopPreferences) => void) => {
    const handler = (_event: unknown, preferences: DesktopPreferences) => callback(preferences)
    ipcRenderer.on(IPC_CHANNELS.desktopPreferencesUpdated, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.desktopPreferencesUpdated, handler)
    }
  },

  initializePermissionRequests: (): Promise<PermissionRequestView[]> => {
    return ipcRenderer.invoke(IPC_CHANNELS.permissionRequestsInit)
  },

  onPermissionRequestsUpdated: (callback: (requests: PermissionRequestView[]) => void) => {
    const handler = (_event: unknown, requests: PermissionRequestView[]) => callback(requests)
    ipcRenderer.on(IPC_CHANNELS.permissionRequestsUpdated, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.permissionRequestsUpdated, handler)
    }
  },

  decidePermission: (requestId: string, decision: PermissionDecisionValue) => {
    return ipcRenderer.invoke(IPC_CHANNELS.permissionDecide, { requestId, decision })
  },

  listPermissionAudit: (): Promise<PermissionAuditEntry[]> => {
    return ipcRenderer.invoke(IPC_CHANNELS.permissionAuditList)
  },

  clearPermissionAudit: (): Promise<{ ok: boolean }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.permissionAuditClear)
  },

  quitApp: () => {
    ipcRenderer.send(IPC_CHANNELS.petQuit)
  },

  restartApp: () => {
    ipcRenderer.send(IPC_CHANNELS.petRestart)
  },

  checkIntegration: () => {
    return ipcRenderer.invoke(IPC_CHANNELS.integrationStatus)
  },

  diagnoseAdapter: (id: AgentAdapterId): Promise<AdapterDiagnoseIpcResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.adapterDiagnose, id)
  },

  installAdapter: (id: AgentAdapterId): Promise<AdapterInstallIpcResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.adapterInstall, id)
  },

  uninstallAdapter: (id: AgentAdapterId): Promise<AdapterInstallIpcResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.adapterUninstall, id)
  },

  getQuotaUsage: (force = false) => {
    return ipcRenderer.invoke(IPC_CHANNELS.quotaUsage, force)
  },

  onQuotaUsageUpdated: (callback: (usage: unknown) => void) => {
    const handler = (_event: unknown, usage: unknown) => callback(usage)
    ipcRenderer.on(IPC_CHANNELS.quotaUsageUpdated, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.quotaUsageUpdated, handler)
    }
  },

  getHistorySummary: (projectId?: string, rangeDays?: number): Promise<HistorySummary | null> => {
    return ipcRenderer.invoke(IPC_CHANNELS.historySummary, projectId, rangeDays)
  },

  getUsageBlocks: (): Promise<HistoryUsageBlock[]> => {
    return ipcRenderer.invoke(IPC_CHANNELS.historyUsageBlocks)
  },

  listHistorySessions: (query?: HistorySessionQuery): Promise<HistorySessionPage> => {
    return ipcRenderer.invoke(IPC_CHANNELS.historySessions, query)
  },

  getHistorySessionDetail: (sessionId: string): Promise<HistorySessionDetail | null> => {
    return ipcRenderer.invoke(IPC_CHANNELS.historySessionDetail, sessionId)
  },

  listProjectPets: (): Promise<ProjectPetView[]> => {
    return ipcRenderer.invoke(IPC_CHANNELS.projectPetsList)
  },

  pickProjectPet: (): Promise<ProjectPetCommandResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.projectPetsPick)
  },

  setProjectPetBinding: (projectId: string, petId: string | null): Promise<ProjectPetCommandResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.projectPetsBind, { projectId, petId })
  },

  archiveProjectPet: (projectId: string): Promise<ProjectPetArchiveResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.projectPetsArchive, projectId)
  },

  getProjectPetsEnabled: (): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.projectPetsGetEnabled)
  },

  setProjectPetsEnabled: (enabled: boolean): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.projectPetsSetEnabled, enabled)
  },

  clearHistory: (): Promise<HistoryClearResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.historyClear)
  },

  exportHistory: (request?: HistoryExportRequest): Promise<HistoryCommandResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.historyExport, request)
  },

  revealHistoryExport: (): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.historyRevealExport)
  },

  onHistoryUpdated: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on(IPC_CHANNELS.historyUpdated, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.historyUpdated, handler)
    }
  },

  testIntegration: (source: 'opencode-cli' | 'opencode-desktop' | 'codex' | 'codex-desktop' | 'claude' | 'claude-desktop') => {
    return ipcRenderer.invoke(IPC_CHANNELS.testIntegration, source)
  },

  installIntegrations: (target?: 'opencode' | 'codex' | 'claude' | 'claudeCode') => {
    return ipcRenderer.invoke(IPC_CHANNELS.installIntegrations, target)
  },

  setupProjectMcp: (): Promise<ProjectMcpPlan> => {
    return ipcRenderer.invoke(IPC_CHANNELS.projectMcpSetup)
  },

  applyProjectMcp: (request: ProjectMcpApplyRequest): Promise<ProjectMcpSetupSummary> => {
    return ipcRenderer.invoke(IPC_CHANNELS.projectMcpApply, request)
  },

  listProjectMcp: (): Promise<ProjectMcpRegistrySnapshot> => {
    return ipcRenderer.invoke(IPC_CHANNELS.projectMcpList)
  },

  removeProjectMcp: (projectPath: string): Promise<ProjectMcpRemovalSummary> => {
    return ipcRenderer.invoke(IPC_CHANNELS.projectMcpRemove, projectPath)
  },

  forgetProjectMcp: (projectPath: string): Promise<{ ok: boolean; removed: boolean; error?: string }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.projectMcpForget, projectPath)
  },

  uninstallIntegrations: (target?: 'opencode' | 'codex' | 'claude' | 'claudeCode' | 'all') => {
    return ipcRenderer.invoke(IPC_CHANNELS.uninstallIntegrations, target)
  },

  loadPets: (): Promise<Array<{
    id: string
    displayName: string
    folder: string
    builtIn: boolean
    behaviorManifest?: PetBehaviorManifest
      pluginSkin?: PluginSkinPetSource
  }>> => {
    return ipcRenderer.invoke(IPC_CHANNELS.loadPets)
  },

  addCustomPet: (petData: { id: string; displayName: string }) => {
    return ipcRenderer.invoke(IPC_CHANNELS.addCustomPet, petData)
  },

  renameCustomPet: (petId: string, newName: string) => {
    return ipcRenderer.invoke(IPC_CHANNELS.renameCustomPet, petId, newName)
  },

  removeCustomPet: (petId: string) => {
    return ipcRenderer.invoke(IPC_CHANNELS.removeCustomPet, petId)
  },

  getCustomPetSprite: (petId: string) => {
    return ipcRenderer.invoke(IPC_CHANNELS.getCustomPetSprite, petId)
  },

  importPetSprite: (petId: string, displayName: string) => {
    return ipcRenderer.invoke(IPC_CHANNELS.importPetSprite, petId, displayName)
  },

  prepareImportPetZip: () => {
    return ipcRenderer.invoke(IPC_CHANNELS.prepareImportPetZip)
  },

  commitImportPetZip: (token: string, decision: PetImportDecision, expectedState: string) => {
    return ipcRenderer.invoke(IPC_CHANNELS.commitImportPetZip, token, decision, expectedState)
  },

  cancelImportPetZip: (token: string) => {
    return ipcRenderer.invoke(IPC_CHANNELS.cancelImportPetZip, token)
  },
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
