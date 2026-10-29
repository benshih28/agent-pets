import type { BrowserWindow } from 'electron'
import type { Server } from 'node:http'
import type { AgentAdapterRegistry } from '../agent-adapter'
import type { AchievementStore } from '../achievements'
import type { DesktopNotificationService } from '../desktop-notifications'
import type { DesktopPreferencesStore } from '../desktop-preferences'
import type { DesktopTrayController } from '../desktop-tray'
import type { HistoryStore } from '../history'
import type { LocalUsageReader } from '../local-usage'
import type { PermissionBroker } from '../permission-broker'
import type { PermissionAdapterRelay } from '../permission-adapter-server'
import type { PluginBadgeController } from '../plugin-badges.ts'
import type { PluginBroker, PluginBrokerContext } from '../plugin-broker.ts'
import type { PluginCatalogDocument } from '../../src/types/plugin-catalog.ts'
import type { PluginCatalogAutoCheckSchedule } from '../plugin-catalog-updates'
import type { PluginCommandController } from '../plugin-commands.ts'
import type { PluginDeveloperModeWatcher } from '../plugin-developer-mode'
import type { PluginEventSourceController } from '../plugin-event-source.ts'
import type { PluginExternalLinkController } from '../plugin-external-links.ts'
import type { PluginFeedController } from '../plugin-feed.ts'
import type { PluginHostGrantController } from '../plugin-host-grants.ts'
import type { PluginHostWindowController } from '../plugin-host-window'
import type { PluginNetworkClient } from '../plugin-net.ts'
import type { PluginPanelViewController } from '../plugin-panel-view.ts'
import { PluginPanelWindowSizer } from '../plugin-panel-window.ts'
import { PluginUiMessageGuard } from '../plugin-ui-messages.ts'
import type { PluginPreferencesStore } from '../plugin-preferences'
import type { PluginRegistry } from '../plugin-registry'
import type { PluginSecretConsentStore } from '../plugin-secret-consent.ts'
import type { PluginSecretsStore } from '../plugin-secrets.ts'
import type { PluginSettingsStore } from '../plugin-settings.ts'
import type { ProgressionStore } from '../progression'
import type { PresentationController } from '../presentation-controller'
import type { ProjectMcpRegistryStore } from '../project-mcp-registry'
import type { ProjectRoutingStore } from '../project-routing'
import type { PetEdge, PetWindowMode } from '../../src/types/pet-window'
import type { PresentationStatusSnapshot } from '../../src/types/presentation'
import type { WindowBounds } from '../pet-window-mode'
import type { WindowsFullscreenDetector, WindowsFullscreenState } from '../windows-fullscreen-detector'
import type { PluginAgentStatusController } from '../plugin-agent-status.ts'

export interface PluginSkinFallbackInfo {
  pluginId: string
  pluginName: { 'zh-TW': string; 'en-US': string }
  skinName: { 'zh-TW': string; 'en-US': string }
}

export const mainState = {
  petWindow: null as BrowserWindow | null,
  panelWindow: null as BrowserWindow | null,
  anchorBottomCenter: null as { x: number; y: number } | null,
  petContentHeight: null as number | null,
  resizeAnimHandle: null as ReturnType<typeof setInterval> | null,
  dragPollHandle: null as ReturnType<typeof setInterval> | null,
  shimejiPersistHandle: null as ReturnType<typeof setTimeout> | null,
  dialogOpen: false,
  eventToken: '',
  eventServer: null as Server | null,
  agentAdapterRegistry: null as AgentAdapterRegistry | null,
  permissionAdapterServer: null as Server | null,
  permissionBroker: null as PermissionBroker | null,
  permissionRelay: null as PermissionAdapterRelay | null,
  progressionStore: null as ProgressionStore | null,
  achievementStore: null as AchievementStore | null,
  achievementStoreRetryTimer: null as ReturnType<typeof setTimeout> | null,
  achievementStoreRetryAttempt: 0,
  historyStore: null as HistoryStore | null,
  localUsageReader: null as LocalUsageReader | null,
  localUsageScanTimer: null as ReturnType<typeof setInterval> | null,
  localUsageScanPromise: null as Promise<void> | null,
  presentationController: null as PresentationController | null,
  presentationMcpServer: null as Server | null,
  projectMcpRegistry: null as ProjectMcpRegistryStore | null,
  projectRoutingStore: null as ProjectRoutingStore | null,
  pluginRegistry: null as PluginRegistry | null,
  pluginPreferences: null as PluginPreferencesStore | null,
  pluginSecretsStore: null as PluginSecretsStore | null,
  pluginSecretConsentStore: null as PluginSecretConsentStore | null,
  pluginSettingsStore: null as PluginSettingsStore | null,
  pluginHostWindow: null as PluginHostWindowController | null,
  pluginPanelViewController: null as PluginPanelViewController | null,
  pluginPanelViewOpenSequence: 0,
  pluginUiMessageGuard: new PluginUiMessageGuard() as PluginUiMessageGuard,
  pluginPanelWindowSizer: new PluginPanelWindowSizer() as PluginPanelWindowSizer,
  programmaticPluginPanelSize: null as { width: number; height: number } | null,
  pluginPanelResizeResetTimer: null as ReturnType<typeof setTimeout> | null,
  pluginBroker: null as PluginBroker | null,
  pluginCommandController: null as PluginCommandController | null,
  pluginBadgeController: null as PluginBadgeController | null,
  diagnosedPluginTrayOverflowIds: new Set<string>(),
  pluginNetworkClient: null as PluginNetworkClient | null,
  pluginCatalogCache: null as { url: string; document: PluginCatalogDocument } | null,
  pluginCatalogAutoCheckSchedule: null as PluginCatalogAutoCheckSchedule | null,
  pluginHostGrantController: null as PluginHostGrantController | null,
  pluginFeedController: null as PluginFeedController | null,
  pluginAgentStatusController: null as PluginAgentStatusController | null,
  pluginEventSourceController: null as PluginEventSourceController | null,
  pluginExternalLinkController: null as PluginExternalLinkController | null,
  pendingPluginPlanIds: new Map<string, string>(),
  pendingDeveloperFolders: new Map<string, string>(),
  developerSourceFolders: new Map<string, string>(),
  developerReloadsInFlight: new Set<string>(),
  pluginRootsByToken: new Map<string, string>(),
  pluginEnableOrder: new Map<string, number>(),
  diagnosedPluginLimitIds: new Set<string>(),
  pendingPluginSkinFallbacks: new Map<string, PluginSkinFallbackInfo>(),
  nextPluginEnableOrder: 0,
  pluginRuntimeContexts: new Map<string, PluginBrokerContext & { muted: boolean; rateLimitPer10Min: number; targetPetId: string | null; grantedHosts: string[] }>(),
  pluginPreferencesSnapshot: null as ReturnType<PluginPreferencesStore['get']> | null,
  pluginDeveloperModeWatcher: null as PluginDeveloperModeWatcher | null,
  presentationStatusProjection: { activePets: [], dnd: false, enabled: true } as PresentationStatusSnapshot,
  desktopPreferences: null as DesktopPreferencesStore | null,
  desktopNotifications: null as DesktopNotificationService | null,
  desktopTray: null as DesktopTrayController | null,
  windowsFullscreenDetector: null as WindowsFullscreenDetector | null,
  windowsFullscreenState: { fullscreen: false, petDisplayFullscreen: false, panelDisplayFullscreen: false } as WindowsFullscreenState,
  windowsFullscreenAutoHiddenPet: false,
  windowsFullscreenAutoHiddenPanel: false,
  panelBlurHideHandle: null as ReturnType<typeof setTimeout> | null,
  petCaptureProtectionApplied: null as boolean | null,
  petWindowMode: 'normal' as PetWindowMode,
  petWindowEdge: null as PetEdge | null,
  normalPetBounds: null as WindowBounds | null,
  edgeRestoreBounds: null as WindowBounds | null,
  edgeDwellHandle: null as ReturnType<typeof setTimeout> | null,
  edgeDwellCandidate: null as { displayId: number; edge: PetEdge } | null,
  isQuitting: false,
  notificationAttentionCount: 0,
  permissionAttentionCount: 0,
  pendingIntegrationTests: new Map<string, () => void>(),
  persistBoundsHandle: null as ReturnType<typeof setTimeout> | null,
  availablePetIdsCache: null as { ids: Set<string>; expiresAt: number } | null,
}

export type MainState = typeof mainState
