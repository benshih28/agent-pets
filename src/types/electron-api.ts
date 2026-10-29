/// <reference types="vite/client" />

import type { DesktopPreferences, DesktopPreferencesPatch } from './desktop'
import type { PermissionDecisionValue, PermissionRequestStatus, PermissionRequestView } from './permission'
import type { ProgressionSnapshot } from './progression'
import type { AchievementSnapshot, AchievementUnlock } from './achievement'
import type { HistoryClearResult, HistoryCommandResult, HistorySummary } from './history'
import type { PetWindowMode, PetWindowModeState } from './pet-window'
import type { PetBehaviorManifest, PluginSkinPetSource } from './pet'
import type { AgentAdapterId } from './agent-adapter'
import type { PresentationIntent, PresentationStatusUpdate } from './presentation'
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
      togglePanel: () => void
      resizePanel: (height: number, width?: number) => void
      hidePanel: () => void
      onPanelOpened: (callback: (options: { restore: boolean }) => void) => () => void
      onPanelOpenSettings: (callback: () => void) => () => void
      onPanelOpenPluginView: (callback: (pluginId: string) => void) => () => void
      initializeDesktopPreferences: (legacySoundEnabled: boolean) => Promise<DesktopPreferences>
      setDesktopPreferences: (patch: DesktopPreferencesPatch) => Promise<DesktopPreferences>
      getPowerSaveState: () => Promise<boolean>
      onPowerSaveStateUpdated: (callback: (powerSave: boolean) => void) => () => void
      initializeProgression: (petId?: string) => Promise<ProgressionSnapshot | null>
      setProgressionPet: (petId: string) => Promise<ProgressionSnapshot | null>
      initializeAchievements: (petId?: string) => Promise<AchievementSnapshot | null>
      onAchievementsUpdated: (callback: (snapshot: AchievementSnapshot) => void) => () => void
      onAchievementUnlocked: (callback: (unlock: AchievementUnlock) => void) => () => void
      onProgressionUpdated: (callback: (snapshot: ProgressionSnapshot) => void) => () => void
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
      quitApp: () => void
      restartApp: () => void
      checkIntegration: () => Promise<AdapterIntegrationStatusIpcResult>
      diagnoseAdapter: (id: AgentAdapterId) => Promise<AdapterDiagnoseIpcResult>
      installAdapter: (id: AgentAdapterId) => Promise<AdapterInstallIpcResult>
      uninstallAdapter: (id: AgentAdapterId) => Promise<AdapterInstallIpcResult>
      getQuotaUsage: (force?: boolean) => Promise<{
        updatedAt: string
        providers: Array<{
          id: 'codex' | 'claude'
          name: string
          plan?: string
          windows: Array<{
            id: string
            label: string
            usedPercent: number
            remainingPercent: number
            resetsAt?: string
          }>
          error?: string
        }>
      }>
      onQuotaUsageUpdated: (callback: (usage: unknown) => void) => () => void
      getHistorySummary: (projectId?: string) => Promise<HistorySummary | null>
      listProjectPets: () => Promise<ProjectPetView[]>
      pickProjectPet: () => Promise<ProjectPetCommandResult>
      setProjectPetBinding: (projectId: string, petId: string | null) => Promise<ProjectPetCommandResult>
      archiveProjectPet: (projectId: string) => Promise<ProjectPetArchiveResult>
      getProjectPetsEnabled: () => Promise<boolean>
      setProjectPetsEnabled: (enabled: boolean) => Promise<boolean>
      clearHistory: () => Promise<HistoryClearResult>
      exportHistory: () => Promise<HistoryCommandResult>
      onHistoryUpdated: (callback: () => void) => () => void
      testIntegration: (source: 'opencode-cli' | 'opencode-desktop' | 'codex' | 'codex-desktop' | 'claude' | 'claude-desktop') => Promise<{
        ok: boolean
        verifiedAt?: number
        error?: string
      }>
      installIntegrations: (target?: 'opencode' | 'codex' | 'claude' | 'claudeCode') => Promise<{ ok: boolean; error?: string }>
      setupProjectMcp: () => Promise<ProjectMcpSetupSummary>
      listProjectMcp: () => Promise<ProjectMcpRegistrySnapshot>
      removeProjectMcp: (projectPath: string) => Promise<ProjectMcpRemovalSummary>
      forgetProjectMcp: (projectPath: string) => Promise<{ ok: boolean; removed: boolean; error?: string }>
      uninstallIntegrations: (target?: 'opencode' | 'codex' | 'claude' | 'claudeCode') => Promise<{ ok: boolean; error?: string }>
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
      importPetZip: () => Promise<{ ok: boolean; id?: string; displayName?: string; error?: string }>
    }
