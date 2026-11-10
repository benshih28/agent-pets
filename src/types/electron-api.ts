/// <reference types="vite/client" />

import type { OnboardingAction, OnboardingState } from './onboarding'
import type { DesktopPreferences, DesktopPreferencesPatch } from './desktop'
import type { SessionJumpRequest, SessionJumpResult } from './session-jump'
import type { PermissionDecisionValue, PermissionRequestStatus, PermissionRequestView, PermissionAuditEntry } from './permission'
import type { ProgressionAwardEvent, ProgressionInsights, ProgressionSnapshot } from './progression'
import type { AchievementSnapshot, AchievementUnlock } from './achievement'
import type { HistoryClearResult, HistoryCommandResult, HistoryExportRequest, HistorySessionDetail, HistorySessionPage, HistorySessionQuery, HistorySummary, HistoryUsageBlock } from './history'
import type { PetWindowMode, PetWindowModeState } from './pet-window'
import type { PetBehaviorManifest, PluginSkinPetSource } from './pet'
import type { PetImportCommitResult, PetImportDecision, PetImportPrepareResult } from './pet-import'
import type { AgentSession, AgentSource, QuotaFamilyKey } from './agent'
import type { AgentAdapterId } from './agent-adapter'
import type { LocalServerHealthSnapshot, LocalServerId } from './reliability'
import type { PresentationIntent, PresentationStatusUpdate } from './presentation'
import type { PanelThemeIpcResult, PanelThemeMode, PanelThemeRef, PanelThemeState, PanelThemeUserImageOptions, PetThemeState } from './panel-theme'
import type { PanelThemeValidateIpcResult, UserPanelThemeDefinition, UserPanelThemeIpcResult } from './panel-theme-user'
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
} from './plugin'
import type { PluginCatalogPanelItem } from './plugin-catalog'
import type {
  ProjectMcpApplyRequest,
  ProjectMcpPlan,
  ProjectMcpRegistrySnapshot,
  ProjectMcpRemovalSummary,
  ProjectMcpSetupSummary,
} from './project-mcp'
import type { ProjectPetArchiveResult, ProjectPetCommandResult, ProjectPetView } from './project-pet'

import type {
  AdapterDiagnoseIpcResult,
  AdapterInstallIpcResult,
  AdapterIntegrationStatusIpcResult,
  AdapterUninstallIpcResult,
} from './ipc'

export interface ElectronAPI {
      reportRendererError: (report: { message: string; stack?: string; kind: 'vue' | 'unhandledrejection' | 'error' }) => void
      reloadRenderer: () => void
      exportDiagnostics: () => Promise<{ ok: boolean; canceled?: boolean }>
      getSessionSnapshot: () => Promise<Array<Omit<AgentSession, 'key' | 'permissionNotice'>>>
      runSessionJump: (request: SessionJumpRequest) => Promise<SessionJumpResult>
      getServerHealth: () => Promise<LocalServerHealthSnapshot>
      retryServerHealth: (id?: LocalServerId) => Promise<LocalServerHealthSnapshot>
      onServerHealthChanged: (callback: (snapshot: LocalServerHealthSnapshot) => void) => () => void
      onAgentStatusEvent: (callback: (event: any) => void) => () => void
      onPresentationIntent: (callback: (intent: PresentationIntent) => void) => () => void
      onPluginFeedItem: (callback: (item: PluginFeedItem) => void) => () => void
      onPluginFeedUnreadCount: (callback: (count: number) => void) => () => void
      getPluginFeedUnreadCount: () => Promise<number>
      getPluginBadges: () => Promise<PluginBadgeView[]>
      onPluginBadgesChanged: (callback: (badges: PluginBadgeView[]) => void) => () => void
      getPluginEventSourceStatuses: () => Promise<PluginEventSourceStatusView[]>
      onPluginEventSourceChanged: (callback: (statuses: PluginEventSourceStatusView[]) => void) => () => void
      onPluginSkinsChanged: (callback: (removedPetIds: string[]) => void) => () => void
      notifyPluginSkinFallback: (petIds: string[]) => Promise<number>
      getPanelThemeState: () => Promise<PanelThemeIpcResult>
      setPanelThemeAppearance: (appearance: { mode: PanelThemeMode; forcedColors: boolean }) => void
      setPanelThemeSlot: (mode: PanelThemeMode, ref: PanelThemeRef | null) => Promise<PanelThemeIpcResult>
      importPanelThemeUserImage: (ref: PanelThemeRef, mode: PanelThemeMode) => Promise<PanelThemeIpcResult>
      clearPanelThemeUserImage: (ref: PanelThemeRef, mode: PanelThemeMode) => Promise<PanelThemeIpcResult>
      setPanelThemeUserImageOptions: (ref: PanelThemeRef, mode: PanelThemeMode, options: PanelThemeUserImageOptions) => Promise<PanelThemeIpcResult>
      validatePanelTheme: (definition: unknown) => Promise<PanelThemeValidateIpcResult>
      listUserPanelThemes: () => Promise<UserPanelThemeIpcResult>
      createUserPanelTheme: (name: string, definition: UserPanelThemeDefinition) => Promise<UserPanelThemeIpcResult>
      /** 有 `name` 時名稱與內容在主程序中一次寫入（原子性的存檔）。 */
      updateUserPanelTheme: (id: string, definition: UserPanelThemeDefinition, name?: string) => Promise<UserPanelThemeIpcResult>
      renameUserPanelTheme: (id: string, name: string) => Promise<UserPanelThemeIpcResult>
      duplicateUserPanelTheme: (id: string, name: string) => Promise<UserPanelThemeIpcResult>
      deleteUserPanelTheme: (id: string) => Promise<UserPanelThemeIpcResult>
      exportUserPanelTheme: (id: string) => Promise<UserPanelThemeIpcResult>
      importUserPanelTheme: () => Promise<UserPanelThemeIpcResult>
      getPetStatusTheme: () => Promise<PetThemeState>
      onPetStatusThemeChanged: (callback: (state: PetThemeState) => void) => () => void
      onPanelThemeChanged: (callback: (state: PanelThemeState) => void) => () => void
      completePluginFeed: (itemId: string) => Promise<boolean>
      openPluginFeedLink: (itemId: string) => Promise<boolean>
      getPluginPanelSnapshot: () => Promise<PluginPanelResult<PluginPanelSnapshot>>
      invokePluginCommand: (pluginId: string, commandId: string) => Promise<PluginPanelResult<{ accepted: true }>>
      openPluginPanelView: (pluginId: string, frame: unknown, content: unknown) => Promise<PluginPanelResult<{ opened: true; openToken: number }>>
      closePluginPanelView: (openToken: number) => void
      setPluginPanelViewBounds: (openToken: number, frame: unknown, content: unknown, viewport: unknown) => void
      onPluginPanelViewClosed: (callback: (event: PluginPanelViewClosedEvent) => void) => () => void
      openPluginPanelFromPet: (pluginId: string) => Promise<boolean>
      getPluginSettings: (pluginId: string) => Promise<PluginPanelResult<PluginPanelSettingsSnapshot>>
      setPluginSettings: (pluginId: string, value: Record<string, PluginSettingScalar>) => Promise<PluginPanelResult<Record<string, PluginSettingScalar>>>
      getPluginSecretConsent: () => Promise<PluginPanelResult<boolean>>
      acceptPluginSecretConsent: () => Promise<PluginPanelResult<boolean>>
      setPluginSecret: (pluginId: string, key: string, value: string) => Promise<PluginPanelResult<{ configured: boolean }>>
      setPluginGlobalPreferences: (patch: PluginGlobalPreferencesPatch) => Promise<PluginPanelResult<PluginPreferences>>
      listPluginCatalog: () => Promise<PluginPanelResult<PluginCatalogPanelItem[]>>
      installPluginFromCatalog: (pluginId: string, version: string) => Promise<PluginPanelResult<PluginInstallPlan>>
      reportInstalledPluginIssue: (pluginId: string) => Promise<PluginPanelResult<{ opened: true }>>
      setPluginInstancePreferences: (pluginId: string, patch: unknown) => Promise<PluginPanelResult<PluginPreferences>>
      selectPluginArchive: () => Promise<PluginPanelResult<PluginInstallPlan>>
      selectPluginFolder: () => Promise<PluginPanelResult<PluginInstallPlan>>
      installPluginPlan: (token: string, acceptAdditionalPermissions: boolean, acceptSignatureChange: boolean) => Promise<PluginPanelResult<PluginPanelPlugin>>
      removeInstalledPlugin: (pluginId: string, keepData: boolean) => Promise<PluginPanelResult<{ removed: true; keptData: boolean }>>
      getPluginDiagnostics: (pluginId: string) => Promise<PluginPanelResult<{ logs: PluginBrokerLogEntry[]; diagnostics: PluginBrokerDiagnostic[] }>>
      listPluginNotifications: () => Promise<PluginPanelResult<PluginNotificationRecord[]>>
      markPluginNotificationRead: (itemId: string) => Promise<PluginPanelResult<{ read: boolean }>>
      markAllPluginNotificationsRead: (pluginId?: string) => Promise<PluginPanelResult<{ marked: number }>>
      clearPluginNotifications: (pluginId?: string) => Promise<PluginPanelResult<{ removed: number }>>
      onPluginNotificationsChanged: (callback: () => void) => () => void
      publishPresentationStatus: (snapshot: PresentationStatusUpdate) => void
      startDrag: () => void
      notifyDragEnd: (moved: boolean) => void
      notifyPetHover: () => void
      shimejiWalkStep: (deltaX: number) => void
      setPetWindowMode: (mode: PetWindowMode) => Promise<PetWindowModeState>
      initializePetWindowMode: () => Promise<PetWindowModeState>
      onPetWindowModeUpdated: (callback: (state: PetWindowModeState) => void) => () => void
      resizeWindow: (width: number, height: number) => void
      reportContentHeight: (height: number) => void
      setMousePassthrough: (ignore: boolean) => void
      requestPetHide: () => void
      showPetContextMenu: () => void
      getOnboardingState: () => Promise<OnboardingState | null>
      updateOnboardingState: (action: OnboardingAction) => Promise<OnboardingState | null>
      togglePanel: () => void
      resizePanel: ((size: { height?: number; width?: number; release?: boolean }) => void) & ((height: number, width?: number) => void)
      resetPanelSize: () => void
      setPanelBlurLock: (lock: { pinned?: boolean; modal?: boolean }) => void
      hidePanel: () => void
      onPanelOpened: (callback: (options: { restore: boolean }) => void) => () => void
      onPanelOpenSettings: (callback: () => void) => () => void
      onPanelOpenPluginView: (callback: (pluginId: string) => void) => () => void
      initializeDesktopPreferences: (legacySoundEnabled: boolean) => Promise<DesktopPreferences>
      openLoginItemsSettings: () => Promise<boolean>
      setDesktopPreferences: (patch: DesktopPreferencesPatch) => Promise<DesktopPreferences>
      getPowerSaveState: () => Promise<boolean>
      onPowerSaveStateUpdated: (callback: (powerSave: boolean) => void) => () => void
      initializeProgression: (petId?: string) => Promise<ProgressionSnapshot | null>
      setProgressionPet: (petId: string) => Promise<ProgressionSnapshot | null>
      initializeAchievements: (petId?: string) => Promise<AchievementSnapshot | null>
      onAchievementsUpdated: (callback: (snapshot: AchievementSnapshot) => void) => () => void
      onAchievementUnlocked: (callback: (unlock: AchievementUnlock) => void) => () => void
      onProgressionUpdated: (callback: (snapshot: ProgressionSnapshot) => void) => () => void
      getProgressionInsights: (petId?: string) => Promise<ProgressionInsights | null>
      onProgressionAwarded: (callback: (event: ProgressionAwardEvent) => void) => () => void
      onDesktopPreferencesUpdated: (callback: (preferences: DesktopPreferences) => void) => () => void
      initializePermissionRequests: () => Promise<PermissionRequestView[]>
      onPermissionRequestsUpdated: (callback: (requests: PermissionRequestView[]) => void) => () => void
      decidePermission: (
        requestId: string,
        decision: PermissionDecisionValue,
      ) => Promise<{
        ok: boolean
        status?: PermissionRequestStatus
        error?: 'not_found' | 'invalid_decision' | 'conflict'
      }>
      listPermissionAudit: () => Promise<PermissionAuditEntry[]>
      clearPermissionAudit: () => Promise<{ ok: boolean }>
      quitApp: () => void
      restartApp: () => void
      checkIntegration: () => Promise<AdapterIntegrationStatusIpcResult>
      diagnoseAdapter: (id: AgentAdapterId) => Promise<AdapterDiagnoseIpcResult>
      installAdapter: (id: AgentAdapterId) => Promise<AdapterInstallIpcResult>
      uninstallAdapter: (id: AgentAdapterId) => Promise<AdapterInstallIpcResult>
      getQuotaUsage: (force?: boolean) => Promise<{
        updatedAt: string
        providers: Array<{
          id: QuotaFamilyKey
          name: string
          plan?: string
          windows: Array<{
            id: string
            label: string
            usedPercent: number
            remainingPercent: number
            resetsAt?: string
            overage?: boolean
          }>
          error?: string
          errorKind?: 'not-signed-in' | 'expired' | 'timeout' | 'rate-limited' | 'unavailable'
          fetchedAt?: string
          stale?: boolean
        }>
        throttled?: { retryInSec: number }
      }>
      onQuotaUsageUpdated: (callback: (usage: unknown) => void) => () => void
      getHistorySummary: (projectId?: string, rangeDays?: number) => Promise<HistorySummary | null>
      getUsageBlocks: () => Promise<HistoryUsageBlock[]>
      listHistorySessions: (query?: HistorySessionQuery) => Promise<HistorySessionPage>
      getHistorySessionDetail: (sessionId: string) => Promise<HistorySessionDetail | null>
      listProjectPets: () => Promise<ProjectPetView[]>
      pickProjectPet: () => Promise<ProjectPetCommandResult>
      setProjectPetBinding: (projectId: string, petId: string | null) => Promise<ProjectPetCommandResult>
      archiveProjectPet: (projectId: string) => Promise<ProjectPetArchiveResult>
      getProjectPetsEnabled: () => Promise<boolean>
      setProjectPetsEnabled: (enabled: boolean) => Promise<boolean>
      clearHistory: () => Promise<HistoryClearResult>
      exportHistory: (request?: HistoryExportRequest) => Promise<HistoryCommandResult>
      revealHistoryExport: () => Promise<boolean>
      onHistoryUpdated: (callback: () => void) => () => void
      testIntegration: (source: AgentSource) => Promise<{
        ok: boolean
        verifiedAt?: number
        error?: string
      }>
      installIntegrations: (target?: 'opencode' | 'codex' | 'claude' | 'claudeCode') => Promise<{ ok: boolean; error?: string }>
      setupProjectMcp: () => Promise<ProjectMcpPlan>
      applyProjectMcp: (request: ProjectMcpApplyRequest) => Promise<ProjectMcpSetupSummary>
      listProjectMcp: () => Promise<ProjectMcpRegistrySnapshot>
      removeProjectMcp: (projectPath: string) => Promise<ProjectMcpRemovalSummary>
      forgetProjectMcp: (projectPath: string) => Promise<{ ok: boolean; removed: boolean; error?: string }>
      uninstallIntegrations: (target?: 'opencode' | 'codex' | 'claude' | 'claudeCode' | 'all') => Promise<{ ok: boolean; error?: string }>
      loadPets: () => Promise<Array<{
        id: string
        displayName: string
        folder: string
        builtIn: boolean
        behaviorManifest?: PetBehaviorManifest
        pluginSkin?: PluginSkinPetSource
      }>>
      addCustomPet: (petData: { id: string; displayName: string }) => Promise<boolean>
      renameCustomPet: (petId: string, newName: string) => Promise<boolean>
      removeCustomPet: (petId: string) => Promise<boolean>
      getCustomPetSprite: (petId: string) => Promise<string | null>
      importPetSprite: (petId: string, displayName: string) => Promise<string | null>
      prepareImportPetZip: () => Promise<PetImportPrepareResult>
      commitImportPetZip: (token: string, decision: PetImportDecision, expectedState: string) => Promise<PetImportCommitResult>
      cancelImportPetZip: (token: string) => Promise<boolean>
    }
