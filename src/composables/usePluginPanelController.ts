// Plugin 面板控制器：建立共用依賴（忙碌範圍、序列佇列、refresh、錯誤通知），組裝各功能 composable，
// 並保留跨功能的狀態（快照、目前選取／詳情頁的插件）、快照刷新、指令、回報與生命週期。
// 目錄、偏好、安裝／移除、已安裝清單已拆到 composables/plugin/。
// 對元件的回傳欄位與型別固定（tests/plugin-panel-controller-characterization.test.mts）。
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { locale, t } from '@/i18n'
import type {
  PluginBadgeView,
  PluginEventSourceStatusView,
  PluginPanelPlugin,
  PluginPanelSnapshot,
  PluginLocalizedText,
} from '@/types/plugin'
import { isValidPetId } from '@/utils/pet-id'
import { permissionHint, permissionLabel } from '@/utils/plugin-permission-copy'
import { resourceBoundText, resourceInputValue } from '@/utils/plugin-resource-limits'
import { createSerialQueue } from '@/composables/plugin/plugin-state-sync'
import { createBusyScopes, createPluginPanelFeedback, createQueuedRefresh, pluginScope } from '@/composables/plugin/panel-deps'
import { usePluginNotify } from '@/composables/plugin/usePluginNotify'
import { usePluginSettingsEditor } from '@/composables/plugin/usePluginSettingsEditor'
import { usePluginPanelView } from '@/composables/plugin/usePluginPanelView'
import { usePluginNotifications } from '@/composables/plugin/usePluginNotifications'
import { usePluginDiagnostics } from '@/composables/plugin/usePluginDiagnostics'
import { usePluginCatalog } from '@/composables/plugin/usePluginCatalog'
import { usePluginPreferences } from '@/composables/plugin/usePluginPreferences'
import { usePluginInstall } from '@/composables/plugin/usePluginInstall'
import { usePluginInstalledList, type PluginInstalledFilter } from '@/composables/plugin/usePluginInstalledList'
import { pluginDetailRequestNonce, takePluginDetailRequest } from '@/utils/plugin-detail-request'
export type { PermissionEntryView, PermissionGroupView } from '@/utils/plugin-permission-copy'
export type { PluginInstalledFilter }

// 跨元件重新掛載保留：已處理過的最後一個面板開啟請求序號。
let consumedPanelRequestNonce = 0


export type PluginDetailSection = 'overview' | 'settings' | 'commands' | 'themes' | 'diagnostics'

// 這四個欄位一直回傳「建立當下的初始值」（不是 ref；原本的型別也因控制流收斂成 null），元件不讀；
// 保留只為了不改對外欄位與型別。
interface LegacyInitialValues {
  removeNotificationsListener: null
  removePanelClosedListener: null
  panelViewBoundsObserver: null
  panelViewRequestSequence: number
}

export function usePluginPanelController(props: { requestedPluginId?: string; requestNonce?: number }) {

// --- 共用依賴與跨功能狀態 ------------------------------------------------------

const snapshot = ref<PluginPanelSnapshot | null>(null)
const notifier = usePluginNotify()
const { busy, isBusy, pluginBusy, setBusy } = createBusyScopes()
const enqueueSerial = createSerialQueue()
const maxEnabledPlugins = () => snapshot.value?.preferences.resources.maxEnabledPlugins ?? 10
const feedback = createPluginPanelFeedback(notifier.notify, maxEnabledPlugins)
const { localizedError, setError, setStatus } = feedback

const plugins = computed(() => snapshot.value?.plugins ?? [])
const pluginsById = computed(() => new Map(plugins.value.map(plugin => [plugin.id, plugin])))
function pluginById(pluginId: string): PluginPanelPlugin | null {
  return pluginsById.value.get(pluginId) ?? null
}
const selectedPluginId = ref('')
const selectedPlugin = computed(() => pluginById(selectedPluginId.value))
const detailPluginId = ref('')
const detailSection = ref<PluginDetailSection>('overview')
const detailPlugin = computed(() => pluginById(detailPluginId.value))
const enabledGlobally = computed(() => snapshot.value?.preferences.pluginsEnabled ?? false)
const onlineCatalogEnabled = computed(() => snapshot.value?.preferences.onlineCatalogEnabled ?? false)
const dailyUpdateCheck = computed(() => snapshot.value?.preferences.dailyUpdateCheck ?? false)
const loading = ref(false)
const liveBadges = ref<PluginBadgeView[]>([])
const eventSourceStatuses = ref<PluginEventSourceStatusView[]>([])
const petOptions = ref<Array<{ id: string; displayName: string }>>([])
let removeBadgesListener: (() => void) | null = null
let removeEventSourceListener: (() => void) | null = null

// --- 功能 composable ----------------------------------------------------------

const {
  pluginSettings, settingsDraft, secretDrafts, settingsErrors, settingsDirty, pendingLeave, pendingSecretRemoveKey,
  pendingSecretConsentKey, guardUnsavedSettings, confirmDiscardSettings, resetSettingsDraft, resetSettingsToDefaults,
  refreshPluginSettings, settingTitle, settingValue, updateSetting, savePluginSettings, savePluginSecret,
  removePluginSecret, confirmSecretConsent,
} = usePluginSettingsEditor({ selectedPluginId, selectedPlugin, pluginById, busy: { isBusy, setBusy }, feedback })

const {
  panelViewPluginId, panelViewOpenToken, panelViewFrame, panelViewContent, panelViewMaximized, panelViewError,
  panelViewPlugin, readPluginPanelViewBounds, sendPluginPanelViewBounds, openPluginPanelView, closePluginPanelView,
  reloadPluginPanelView, togglePluginPanelViewMaximized, handlePluginPanelViewClosed,
} = usePluginPanelView({
  pluginById,
  enabledGlobally,
  selectPlugin: pluginId => { selectedPluginId.value = pluginId },
  setError: code => setError(code),
})

const {
  notifications, visibleNotifications, refreshNotifications, markNotificationRead, openNotificationLink,
  clearNotifications, markAllNotificationsRead, notificationSource, notificationTime,
} = usePluginNotifications({ pluginById, feedback })

const {
  logs, diagnostics, refreshDiagnostics, diagnosticTime, diagnosticCodeLabel, diagnosticTechnical,
} = usePluginDiagnostics({ selectedPluginId, maxEnabledPlugins, feedback })

const legacyInitialValues: LegacyInitialValues = {
  removeNotificationsListener: null,
  removePanelClosedListener: null,
  panelViewBoundsObserver: null,
  panelViewRequestSequence: 0,
}

// --- 目錄、已安裝清單、偏好、安裝／移除 -------------------------------------------------
// 順序有依賴：目錄 → 已安裝清單（用目錄的可更新索引）→ 偏好（目錄網址變更時重設目錄）→ 安裝／移除。
// refreshPanel 在下方才宣告，這裡以回呼延後取用。

const {
  catalogItems, catalogCheckComplete, catalogLoadedAt, catalogError, catalogSearch, updatableItems, updatableIds,
  filteredCatalogItems, catalogItemFor, resetCatalog, loadPluginCatalog, ensureCatalogLoaded,
} = usePluginCatalog({ onlineCatalogEnabled, busy: { isBusy, setBusy }, feedback })

const {
  installedSearch, installedFilter, filteredPlugins, failedPluginIconIds, pluginName, pluginIconUrl, hidePluginIcon,
  displayFingerprint, pluginStatusLabel, pluginStatusTone,
} = usePluginInstalledList({ snapshot, plugins, enabledGlobally, updatableIds })

const {
  catalogUrlDraft, resourceFields, updateGlobalPreferences, saveCatalogUrl, restoreCatalogUrl, updateResourceLimit,
  updatePluginPreference, updatePluginRate, updatePluginTarget, revokeGrantedHost, enableInstalledPlugin,
} = usePluginPreferences({
  snapshot, plugins, enabledGlobally, busy: { setBusy }, enqueueSerial, feedback, notify: notifier.notify,
  resetCatalog,
  refreshPanel: options => refreshPanel(options),
})

const {
  pendingPlan, updateQueue, pendingRemove, keepData, hasCompatiblePlan, pendingPluginName, pendingPermissionSections,
  installAcknowledgements, planKindLabel, selectArchive, selectDeveloperFolder, installCatalogPlugin,
  updateAllCatalogPlugins, confirmInstall, requestRemove, confirmRemove,
} = usePluginInstall({
  enabledGlobally, catalogLoadedAt, updatableItems, busy: { isBusy, setBusy }, feedback, pluginName,
  loadPluginCatalog, enableInstalledPlugin, refreshPanel: () => refreshPanel(),
})

// --- 其餘狀態：指令、回報 -----------------------------------------------------------

const invokingCommandId = ref('')
const pendingReportPluginId = ref('')

// --- 詳情頁 -------------------------------------------------------------------

// 詳情頁是目前插件唯一的來源；診斷、設定、指令都跟著它走，不再由別處的下拉決定。
function openPluginDetail(pluginId: string, section: PluginDetailSection = 'overview'): void {
  if (!pluginsById.value.has(pluginId)) return
  const open = () => {
    detailSection.value = section
    detailPluginId.value = pluginId
    selectedPluginId.value = pluginId
  }
  if (pluginId !== selectedPluginId.value) guardUnsavedSettings(open)
  else open()
}

function closePluginDetail(): void {
  guardUnsavedSettings(() => { detailPluginId.value = '' })
}

// 從面板外框直接跳到該插件的詳情頁（權限、設定、診斷）。
function openPluginDetailFromPanel(): void {
  const pluginId = panelViewPluginId.value
  closePluginPanelView()
  if (pluginId) openPluginDetail(pluginId)
}

// --- 快照與寵物清單 -------------------------------------------------------------

// 重新抓取快照。進行中又被呼叫時排成「結尾再抓一次」，而不是直接丟掉；
// silent 用於背景同步（例如切換啟用後更新崩潰狀態），不會讓整頁進入 loading。
const refreshPanel = createQueuedRefresh<{ silent?: boolean }>(async (options = {}) => {
  if (!options.silent) loading.value = true
  try {
    const result = await window.electronAPI?.getPluginPanelSnapshot()
    if (!result?.ok) {
      if (result && !result.ok) setError(result.error, () => void refreshPanel())
      else setError('plugin_service_unavailable', () => void refreshPanel())
      return
    }
    snapshot.value = result.value
    catalogUrlDraft.value = result.value.preferences.catalogUrl
    const installedIds = new Set(result.value.plugins.map(plugin => plugin.id))
    if (!installedIds.has(selectedPluginId.value)) selectedPluginId.value = ''
    if (detailPluginId.value && !installedIds.has(detailPluginId.value)) detailPluginId.value = ''
    await refreshNotifications()
  } catch {
    setError('plugin_service_unavailable')
  } finally {
    if (!options.silent) loading.value = false
  }
}, { silent: true })

async function loadPetOptions(): Promise<void> {
  try {
    const pets = await window.electronAPI?.loadPets()
    petOptions.value = (pets ?? []).filter(pet => isValidPetId(pet.id, 64))
      .map(pet => ({
        id: pet.id,
        displayName: pet.pluginSkin
          ? `${pet.displayName || pet.id} · ${t('pluginPetFromPlugin', { name: pet.pluginSkin.pluginName })}`
          : pet.displayName || pet.id,
      }))
  } catch {
    petOptions.value = []
  }
}

// --- 指令 ---------------------------------------------------------------------

function commandOf(plugin: PluginPanelPlugin, commandId: string) {
  return plugin.manifest?.contributes.commands?.find(command => command.id === commandId) ?? { title: { 'zh-TW': commandId, 'en-US': commandId } }
}

function commandTitle(command: { title: PluginLocalizedText }): string {
  return command.title[locale.value]
}

async function invokePluginCommand(commandId: string): Promise<void> {
  const plugin = selectedPlugin.value
  if (!plugin || invokingCommandId.value) return
  invokingCommandId.value = commandId
  try {
    const result = await window.electronAPI?.invokePluginCommand(plugin.id, commandId)
    if (!result?.ok) {
      setError(result && !result.ok ? result.error : 'plugin_service_unavailable')
      return
    }
    setStatus(t('plugins.commandSentNamed', { command: commandTitle(commandOf(plugin, commandId)), name: pluginName(plugin) }))
  } catch {
    setError('plugin_action_failed')
  } finally {
    invokingCommandId.value = ''
  }
}
// --- 回報問題 -----------------------------------------------------------------

// 回報問題先預覽會帶出的資訊，使用者確認後才開啟瀏覽器。
function requestReport(pluginId: string): void {
  pendingReportPluginId.value = pluginId
}

async function confirmReport(): Promise<void> {
  const pluginId = pendingReportPluginId.value
  pendingReportPluginId.value = ''
  if (pluginId) await reportPluginIssue(pluginId)
}

async function reportPluginIssue(pluginId: string): Promise<void> {
  const scope = pluginScope(pluginId)
  if (isBusy(scope)) return
  setBusy(scope, true)
  try {
    const result = await window.electronAPI?.reportInstalledPluginIssue(pluginId)
    if (!result?.ok) {
      if (result && !result.ok) setError(result.error)
      return
    }
    setStatus(t('pluginReportOpened'))
  } catch {
    setError('plugin_action_failed')
  } finally {
    setBusy(scope, false)
  }
}
// --- 跨功能的監聽與生命週期 ------------------------------------------------------

watch(selectedPluginId, pluginId => {
  if (panelViewPluginId.value && panelViewPluginId.value !== pluginId) closePluginPanelView()
  void refreshDiagnostics(pluginId)
  void refreshPluginSettings(pluginId)
})

// 面板開啟請求只消費一次：以請求序號判斷，重新掛載或重新整理都不會把已關閉的面板再開一次。
function consumePanelRequest(): void {
  const nonce = props.requestNonce ?? 0
  if (nonce <= consumedPanelRequestNonce) return
  consumedPanelRequestNonce = nonce
  const pluginId = props.requestedPluginId
  if (!pluginId) {
    if (panelViewPluginId.value) closePluginPanelView()
    return
  }
  if (pluginsById.value.has(pluginId)) void openPluginPanelView(pluginId)
}

watch(() => [props.requestedPluginId, props.requestNonce] as const, consumePanelRequest)

// 此面板已掛載時才發出的詳細頁請求（例如從搜尋觸發 Appearance 卡片的
// "Open plugin settings"）在這裡處理。
watch(pluginDetailRequestNonce, () => {
  if (!snapshot.value) return
  const detailRequest = takePluginDetailRequest()
  if (detailRequest) openPluginDetail(detailRequest.pluginId, detailRequest.section)
})

onMounted(() => {
  void refreshPanel().then(() => {
    if (dailyUpdateCheck.value) void ensureCatalogLoaded()
    consumePanelRequest()
    // 從儀表板的插件分頁開啟：直接跳到該插件的詳情頁。
    const detailRequest = takePluginDetailRequest()
    if (detailRequest) openPluginDetail(detailRequest.pluginId, detailRequest.section)
  })
  void loadPetOptions()
  void window.electronAPI?.getPluginBadges?.().then(badges => { liveBadges.value = badges }).catch(() => {})
  removeBadgesListener = window.electronAPI?.onPluginBadgesChanged?.(badges => { liveBadges.value = badges }) ?? null
  void window.electronAPI?.getPluginEventSourceStatuses?.().then(statuses => { eventSourceStatuses.value = statuses }).catch(() => {})
  removeEventSourceListener = window.electronAPI?.onPluginEventSourceChanged?.(statuses => { eventSourceStatuses.value = statuses }) ?? null
})

onUnmounted(() => {
  notifier.dispose()
  removeBadgesListener?.()
  removeEventSourceListener?.()
})
  return {
    snapshot,
    notifications,
    visibleNotifications,
    liveBadges,
    eventSourceStatuses,
    markAllNotificationsRead,
    logs,
    diagnostics,
    petOptions,
    pluginSettings,
    settingsDraft,
    secretDrafts,
    selectedPluginId,
    settingsErrors,
    settingsDirty,
    pendingLeave,
    pendingSecretRemoveKey,
    confirmDiscardSettings,
    resetSettingsDraft,
    resetSettingsToDefaults,
    removePluginSecret,
    detailPluginId,
    detailSection,
    detailPlugin,
    openPluginDetail,
    closePluginDetail,
    panelViewPluginId,
    panelViewOpenToken,
    panelViewFrame,
    panelViewContent,
    panelViewMaximized,
    panelViewError,
    reloadPluginPanelView,
    openPluginDetailFromPanel,
    busy,
    isBusy,
    pluginBusy,
    invokingCommandId,
    loading,
    toasts: notifier.toasts,
    dismissToast: notifier.dismiss,
    runToastAction: notifier.runAction,
    notify: notifier.notify,
    setStatus,
    pendingPlan,
    pendingRemove,
    pendingSecretConsentKey,
    catalogItems,
    catalogCheckComplete,
    catalogLoadedAt,
    catalogError,
    updateQueue,
    ensureCatalogLoaded,
    updateAllCatalogPlugins,
    catalogItemFor,
    catalogSearch,
    catalogUrlDraft,
    keepData,
    ...legacyInitialValues,
    plugins,
    selectedPlugin,
    panelViewPlugin,
    enabledGlobally,
    onlineCatalogEnabled,
    dailyUpdateCheck,
    filteredCatalogItems,
    installedSearch,
    installedFilter,
    filteredPlugins,
    hasCompatiblePlan,
    pendingPluginName,
    resourceFields,
    failedPluginIconIds,
    pendingPermissionSections,
    installAcknowledgements,
    pluginName,
    pluginIconUrl,
    hidePluginIcon,
    restoreCatalogUrl,
    displayFingerprint,
    readPluginPanelViewBounds,
    sendPluginPanelViewBounds,
    openPluginPanelView,
    closePluginPanelView,
    togglePluginPanelViewMaximized,
    handlePluginPanelViewClosed,
    pluginStatusLabel,
    pluginStatusTone,
    localizedError,
    setError,
    refreshNotifications,
    refreshPanel,
    loadPetOptions,
    refreshDiagnostics,
    refreshPluginSettings,
    commandTitle,
    invokePluginCommand,
    settingTitle,
    settingValue,
    updateSetting,
    savePluginSettings,
    savePluginSecret,
    confirmSecretConsent,
    updateGlobalPreferences,
    saveCatalogUrl,
    loadPluginCatalog,
    installCatalogPlugin,
    reportPluginIssue,
    pendingReportPluginId,
    requestReport,
    confirmReport,
    updateResourceLimit,
    resourceInputValue,
    resourceBoundText,
    updatePluginPreference,
    updatePluginRate,
    updatePluginTarget,
    revokeGrantedHost,
    selectArchive,
    selectDeveloperFolder,
    planKindLabel,
    permissionLabel,
    permissionHint,
    confirmInstall,
    requestRemove,
    confirmRemove,
    markNotificationRead,
    openNotificationLink,
    clearNotifications,
    notificationSource,
    notificationTime,
    diagnosticTime,
    diagnosticCodeLabel,
    diagnosticTechnical
  }
}