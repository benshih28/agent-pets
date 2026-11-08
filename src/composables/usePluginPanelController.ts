
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { locale, t, type TranslationKey } from '@/i18n'
import {
  isCurrentPluginPanelViewClose,
  maximizedPluginPanelWindowSize,
  pluginPanelViewCloseError,
  shouldResetPluginPanelMaximized,
} from '@/utils/plugin-panel-view'
import { resolvePluginIconUrl } from '@/utils/plugin-icon'
import type {
  PluginBadgeView,
  PluginBrokerDiagnostic,
  PluginEventSourceStatusView,
  PluginBrokerLogEntry,
  PluginInstallPlan,
  PluginGlobalPreferencesPatch,
  PluginNotificationRecord,
  PluginPanelPlugin,
  PluginPanelSettingsSnapshot,
  PluginPanelSnapshot,
  PluginPanelViewClosedEvent,
  PluginResourceLimits,
  PluginInstancePreferences,
  PluginPreferences,
  PluginSettingScalar,
} from '@/types/plugin'
import type { PluginCatalogPanelItem } from '@/types/plugin-catalog'
import { DEFAULT_PLUGIN_CATALOG_URL, shouldShowCatalogPermissionCheck } from '@/types/plugin-catalog'
import { isValidPetId } from '@/utils/pet-id'
import {
  groupPermissionUnits, installAcknowledgementReasons, parsePermissionUnit, permissionUnitsOfPlan,
  type PermissionGroupId, type PermissionRisk,
} from '@/utils/plugin-permissions'
import {
  applyPreferencePatch, createSerialQueue, mergePreferencesResult, rollbackPreferencePatch,
  type PluginPreferencePatch,
} from '@/composables/plugin/plugin-state-sync'
import {
  defaultSettingsDraft, isSettingsDirty, validateSettings, type SettingErrorCode,
} from '@/utils/plugin-settings-form'
import { usePluginNotify } from '@/composables/plugin/usePluginNotify'
import { takePluginDetailRequest } from '@/utils/plugin-detail-request'
import { formatDateParts, formatDateTime, formatNumber } from '@/utils/intl-format'
export interface PermissionEntryView {
  unit: string
  label: string
  hint: string
  risk: PermissionRisk
  known: boolean
}

export interface PermissionGroupView {
  id: PermissionGroupId
  risk: PermissionRisk
  entries: PermissionEntryView[]
}

// 跨元件重新掛載保留：已處理過的最後一個面板開啟請求序號。
let consumedPanelRequestNonce = 0

export type PluginInstalledFilter = 'all' | 'enabled' | 'updates' | 'issues'

export type PluginDetailSection = 'overview' | 'settings' | 'commands' | 'diagnostics'

export function usePluginPanelController(props: { requestedPluginId?: string; requestNonce?: number }) {

const snapshot = ref<PluginPanelSnapshot | null>(null)
const notifications = ref<PluginNotificationRecord[]>([])
const liveBadges = ref<PluginBadgeView[]>([])
const eventSourceStatuses = ref<PluginEventSourceStatusView[]>([])
let removeBadgesListener: (() => void) | null = null
let removeEventSourceListener: (() => void) | null = null
const hiddenNotificationIds = ref(new Set<string>())
const visibleNotifications = computed(() => notifications.value.filter(record => !hiddenNotificationIds.value.has(record.item.id)))
const logs = ref<PluginBrokerLogEntry[]>([])
const diagnostics = ref<PluginBrokerDiagnostic[]>([])
const petOptions = ref<Array<{ id: string; displayName: string }>>([])
const pluginSettings = ref<PluginPanelSettingsSnapshot | null>(null)
const settingsDraft = ref<Record<string, PluginSettingScalar>>({})
const secretDrafts = ref<Record<string, string>>({})
const selectedPluginId = ref('')
const settingsErrors = ref<Record<string, SettingErrorCode>>({})
// 有未儲存變更時要離開詳情頁，先暫存要執行的動作，等使用者在對話框確認放棄。
const pendingLeave = ref<(() => void) | null>(null)
const pendingSecretRemoveKey = ref('')
const pendingReportPluginId = ref('')
const detailPluginId = ref('')
const detailSection = ref<PluginDetailSection>('overview')
const panelViewPluginId = ref('')
const panelViewOpenToken = ref(0)
const panelViewFrame = ref<HTMLElement | null>(null)
const panelViewContent = ref<HTMLElement | null>(null)
const panelViewMaximized = ref(false)
// 面板開啟失敗、崩潰或被關閉時，外框留在畫面上顯示錯誤（原因 + 重新載入/返回/回報），而不是直接跳回列表。
const panelViewError = ref('')
let panelViewReturnFocus: HTMLElement | null = null
// 忙碌狀態依範圍追蹤（global / catalog / install / plugin:{id}），UI 只鎖住相關控制項。
// `busy` 只代表非單一插件的範圍；各插件卡片請用 pluginBusy(id)。
const busyCounts = ref(new Map<string, number>())
const busy = computed(() => [...busyCounts.value.keys()].some(scope => !scope.startsWith('plugin:')))
const enqueueSerial = createSerialQueue()
let refreshQueued = false
let refreshInFlight = false

function isBusy(scope: string): boolean {
  return busyCounts.value.has(scope)
}

function pluginBusy(pluginId: string): boolean {
  return busyCounts.value.has(`plugin:${pluginId}`) || busyCounts.value.has('global')
}

function setBusy(scope: string, on: boolean): void {
  const next = new Map(busyCounts.value)
  const count = (next.get(scope) ?? 0) + (on ? 1 : -1)
  if (count > 0) next.set(scope, count)
  else next.delete(scope)
  busyCounts.value = next
}
const invokingCommandId = ref('')
const loading = ref(false)
const notifier = usePluginNotify()
const pendingPlan = ref<PluginInstallPlan | null>(null)
const pendingRemove = ref<PluginPanelPlugin | null>(null)
const pendingSecretConsentKey = ref('')
const catalogItems = ref<PluginCatalogPanelItem[]>([])
const catalogCheckComplete = ref(false)
const catalogLoadedAt = ref<number | null>(null)
const catalogError = ref('')
const updateQueue = ref<PluginCatalogPanelItem[]>([])
const catalogSearch = ref('')
const catalogUrlDraft = ref('')
const keepData = ref(false)
let removeNotificationsListener: (() => void) | null = null
let removePanelClosedListener: (() => void) | null = null
let panelViewBoundsObserver: ResizeObserver | null = null
let panelViewRequestSequence = 0
let panelViewScrollContainer: HTMLElement | null = null
let panelViewScrollTop: number | null = null
let panelViewWindowSizeBeforeMaximize: { width: number; height: number } | null = null

const plugins = computed(() => snapshot.value?.plugins ?? [])
const selectedPlugin = computed(() => plugins.value.find(plugin => plugin.id === selectedPluginId.value) ?? null)
const settingsProperties = computed(() => selectedPlugin.value?.manifest?.contributes.settings?.properties ?? {})
const settingsDirty = computed(() => isSettingsDirty(
  settingsProperties.value, pluginSettings.value?.values ?? {}, settingsDraft.value, secretDrafts.value,
))
const detailPlugin = computed(() => plugins.value.find(plugin => plugin.id === detailPluginId.value) ?? null)
const panelViewPlugin = computed(() => plugins.value.find(plugin => plugin.id === panelViewPluginId.value) ?? null)
const enabledGlobally = computed(() => snapshot.value?.preferences.pluginsEnabled ?? false)
const onlineCatalogEnabled = computed(() => snapshot.value?.preferences.onlineCatalogEnabled ?? false)
const dailyUpdateCheck = computed(() => snapshot.value?.preferences.dailyUpdateCheck ?? false)
const installedSearch = ref('')
const installedFilter = ref<PluginInstalledFilter>('all')
const filteredPlugins = computed(() => {
  const query = installedSearch.value.trim().toLocaleLowerCase()
  const matches = plugins.value.filter(plugin => {
    if (installedFilter.value === 'enabled' && !plugin.preference.enabled) return false
    if (installedFilter.value === 'issues' && pluginStatusTone(plugin) !== 'warn') return false
    if (installedFilter.value === 'updates' && !catalogItems.value.some(item => item.plugin.id === plugin.id && item.updateAvailable)) return false
    if (!query) return true
    return [plugin.id, pluginName(plugin), plugin.manifest?.author ?? ''].some(value => value.toLocaleLowerCase().includes(query))
  })
  // 需要處理的插件（崩潰、不相容）排在最前面。
  return [...matches].sort((left, right) => Number(pluginStatusTone(right) === 'warn') - Number(pluginStatusTone(left) === 'warn'))
})
const filteredCatalogItems = computed(() => {
  const query = catalogSearch.value.trim().toLocaleLowerCase()
  if (!query) return catalogItems.value
  return catalogItems.value.filter(item => [
    item.plugin.id,
    item.plugin.name[locale.value],
    item.plugin.description[locale.value],
    item.plugin.author,
  ].some(value => value.toLocaleLowerCase().includes(query)))
})
const hasCompatiblePlan = computed(() => Boolean(pendingPlan.value && pendingPlan.value.kind !== 'incompatible'))
const pendingPluginName = computed(() => pendingPlan.value?.name?.[locale.value] ?? pendingPlan.value?.pluginId ?? '')
const resourceFields: Array<{
  key: keyof PluginResourceLimits
  label: TranslationKey
  defaultValue: number
  min: number
  max: number
}> = [
  { key: 'maxEnabledPlugins', label: 'pluginResourceMaxEnabled', defaultValue: 10, min: 1, max: 50 },
  { key: 'memoryMbPerPlugin', label: 'pluginResourceMemory', defaultValue: 64, min: 16, max: 512 },
  { key: 'netMaxResponseBytes', label: 'pluginResourceNetBytes', defaultValue: 2 * 1024 * 1024, min: 64 * 1024, max: 20 * 1024 * 1024 },
  { key: 'netTimeoutSeconds', label: 'pluginResourceNetTimeout', defaultValue: 15, min: 5, max: 60 },
  { key: 'netRequestsPerMinute', label: 'pluginResourceNetRate', defaultValue: 30, min: 1, max: 300 },
  { key: 'storageBytesPerPlugin', label: 'pluginResourceStorage', defaultValue: 1024 * 1024, min: 64 * 1024, max: 50 * 1024 * 1024 },
  { key: 'globalFeedPer10Min', label: 'pluginResourceGlobalFeed', defaultValue: 60, min: 10, max: 300 },
  { key: 'scheduleMinIntervalSeconds', label: 'pluginResourceSchedule', defaultValue: 60, min: 30, max: 3_600 },
]

function pluginName(plugin: PluginPanelPlugin): string {
  return plugin.manifest?.name[locale.value] ?? plugin.id
}

function pluginIconUrl(plugin: PluginPanelPlugin): string | null {
  return resolvePluginIconUrl(
    plugin.id,
    plugin.manifest?.icon,
    plugin.preference.enabled,
    snapshot.value?.preferences.pluginsEnabled === true,
    failedPluginIconIds.value.has(plugin.id),
  )
}

const failedPluginIconIds = ref(new Set<string>())

function hidePluginIcon(pluginId: string): void {
  failedPluginIconIds.value = new Set([...failedPluginIconIds.value, pluginId])
}

async function restoreCatalogUrl(): Promise<void> {
  catalogUrlDraft.value = DEFAULT_PLUGIN_CATALOG_URL
  await saveCatalogUrl()
}

function displayFingerprint(value: string | undefined): string {
  return typeof value === 'string' && /^[a-f0-9]{16}$/.test(value)
    ? value.match(/.{4}/g)?.join(' ') ?? ''
    : ''
}

function readPluginPanelViewBounds(): { frame: DOMRect; content: DOMRect } | null {
  const frame = panelViewFrame.value?.getBoundingClientRect()
  const content = panelViewContent.value?.getBoundingClientRect()
  if (!frame || !content || frame.width < 1 || frame.height < 1 || content.width < 1 || content.height < 1) return null
  return { frame, content }
}

function sendPluginPanelViewBounds(): void {
  const openToken = panelViewOpenToken.value
  const bounds = readPluginPanelViewBounds()
  if (!openToken || !bounds) return
  window.electronAPI?.setPluginPanelViewBounds(
    openToken,
    { x: bounds.frame.left, y: bounds.frame.top, width: bounds.frame.width, height: bounds.frame.height },
    { x: bounds.content.left, y: bounds.content.top, width: bounds.content.width, height: bounds.content.height },
    { width: window.innerWidth, height: window.innerHeight },
  )
}

// resizePanel 只送出「暫時的最小尺寸」，不覆寫使用者自己調整的面板大小；
// 還原、Esc、關閉或切換插件時釋放這個最小尺寸，視窗回到使用者的大小。
// 插件頁已被主行程關閉（隱藏、崩潰等）時主行程自己會還原尺寸，這裡不再調整。
async function restorePluginPanelViewMaximized(restoreWindowSize = false): Promise<void> {
  if (!panelViewMaximized.value) return
  panelViewMaximized.value = false
  const previousSize = panelViewWindowSizeBeforeMaximize
  panelViewWindowSizeBeforeMaximize = null
  if (restoreWindowSize && previousSize) window.electronAPI?.resizePanel({ release: true })
  const scrollContainer = panelViewScrollContainer
  const scrollTop = panelViewScrollTop
  panelViewScrollContainer = null
  panelViewScrollTop = null
  await nextTick()
  if (scrollContainer?.isConnected && scrollTop !== null) scrollContainer.scrollTop = scrollTop
  sendPluginPanelViewBounds()
}

function setPluginPanelViewMaximized(maximized: boolean): void {
  if (!panelViewPluginId.value || panelViewMaximized.value === maximized) return
  if (!maximized) {
    void restorePluginPanelViewMaximized(true)
    return
  }
  panelViewScrollContainer = panelViewFrame.value?.closest<HTMLElement>('.settings-content') ?? null
  panelViewScrollTop = panelViewScrollContainer?.scrollTop ?? null
  const current = { width: window.outerWidth, height: window.outerHeight }
  const target = maximizedPluginPanelWindowSize(current, { width: window.screen.availWidth, height: window.screen.availHeight })
  if (target.width !== current.width || target.height !== current.height) {
    panelViewWindowSizeBeforeMaximize = current
    window.electronAPI?.resizePanel(target.height, target.width)
  }
  panelViewMaximized.value = true
  void nextTick(() => sendPluginPanelViewBounds())
}

function togglePluginPanelViewMaximized(): void {
  setPluginPanelViewMaximized(!panelViewMaximized.value)
}

function onPluginPanelViewKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.defaultPrevented || !panelViewPluginId.value) return
  // 確認對話框或安裝 Sheet 開啟時，Esc 先留給它們關閉。
  if (document.querySelector('[aria-modal="true"]')) return
  event.preventDefault()
  event.stopPropagation()
  if (panelViewMaximized.value) void restorePluginPanelViewMaximized(true)
  else closePluginPanelView()
}

async function openPluginPanelView(pluginId: string): Promise<void> {
  const plugin = plugins.value.find(item => item.id === pluginId)
  if (!plugin?.manifest?.contributes.panelView || !plugin.preference.enabled || !enabledGlobally.value) {
    setError('disabled')
    return
  }
  const requestSequence = ++panelViewRequestSequence
  if (!panelViewPluginId.value && document.activeElement instanceof HTMLElement) panelViewReturnFocus = document.activeElement
  panelViewError.value = ''
  const previousOpenToken = panelViewOpenToken.value
  panelViewOpenToken.value = 0
  if (previousOpenToken) window.electronAPI?.closePluginPanelView(previousOpenToken)
  if (panelViewMaximized.value) await restorePluginPanelViewMaximized(true)
  if (requestSequence !== panelViewRequestSequence) return
  selectedPluginId.value = pluginId
  panelViewPluginId.value = pluginId
  await nextTick()
  if (requestSequence !== panelViewRequestSequence) return
  const bounds = readPluginPanelViewBounds()
  if (!bounds) {
    panelViewPluginId.value = ''
    setError('panel_unavailable')
    return
  }
  try {
    const result = await window.electronAPI?.openPluginPanelView(
      pluginId,
      { x: bounds.frame.left, y: bounds.frame.top, width: bounds.frame.width, height: bounds.frame.height },
      { x: bounds.content.left, y: bounds.content.top, width: bounds.content.width, height: bounds.content.height },
    )
    if (requestSequence !== panelViewRequestSequence) {
      if (result?.ok) window.electronAPI?.closePluginPanelView(result.value.openToken)
      return
    }
    if (!result?.ok) {
      panelViewError.value = result && !result.ok ? result.error : 'plugin_service_unavailable'
      return
    }
    panelViewOpenToken.value = result.value.openToken
    await nextTick()
    sendPluginPanelViewBounds()
  } catch {
    if (requestSequence !== panelViewRequestSequence) return
    panelViewError.value = 'plugin_service_unavailable'
  }
}

function closePluginPanelView(): void {
  panelViewRequestSequence += 1
  void restorePluginPanelViewMaximized(true)
  const openToken = panelViewOpenToken.value
  panelViewOpenToken.value = 0
  panelViewPluginId.value = ''
  panelViewError.value = ''
  if (openToken) window.electronAPI?.closePluginPanelView(openToken)
  const returnTo = panelViewReturnFocus
  panelViewReturnFocus = null
  void nextTick(() => {
    if (returnTo?.isConnected) returnTo.focus()
  })
}

function reloadPluginPanelView(): void {
  const pluginId = panelViewPluginId.value
  if (pluginId) void openPluginPanelView(pluginId)
}

// 從面板外框直接跳到該插件的詳情頁（權限、設定、診斷）。
function openPluginDetailFromPanel(): void {
  const pluginId = panelViewPluginId.value
  closePluginPanelView()
  if (pluginId) openPluginDetail(pluginId)
}

function handlePluginPanelViewClosed(event: PluginPanelViewClosedEvent): void {
  if (!isCurrentPluginPanelViewClose(event, panelViewPluginId.value, panelViewOpenToken.value)) return
  panelViewRequestSequence += 1
  void restorePluginPanelViewMaximized()
  panelViewOpenToken.value = 0
  if (event.reason === 'hidden') {
    panelViewPluginId.value = ''
    return
  }
  panelViewError.value = pluginPanelViewCloseError(event.reason)
}

// 詳情頁是目前插件唯一的來源；診斷、設定、指令都跟著它走，不再由別處的下拉決定。
function guardUnsavedSettings(action: () => void): void {
  if (settingsDirty.value) pendingLeave.value = action
  else action()
}

function openPluginDetail(pluginId: string, section: PluginDetailSection = 'overview'): void {
  if (!plugins.value.some(plugin => plugin.id === pluginId)) return
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

function confirmDiscardSettings(): void {
  const action = pendingLeave.value
  pendingLeave.value = null
  resetSettingsDraft()
  action?.()
}

function resetSettingsDraft(): void {
  settingsDraft.value = { ...(pluginSettings.value?.values ?? {}) }
  secretDrafts.value = Object.fromEntries(Object.keys(pluginSettings.value?.secrets ?? {}).map(key => [key, '']))
  settingsErrors.value = {}
}

function resetSettingsToDefaults(): void {
  settingsDraft.value = defaultSettingsDraft(settingsProperties.value)
  settingsErrors.value = {}
}

function pluginStatusLabel(plugin: PluginPanelPlugin): string {
  if (plugin.status === 'disabled_crashed') return t('pluginStatusCrashed')
  if (plugin.status === 'incompatible' || !plugin.manifest) return t('pluginStatusIncompatible')
  if (!plugin.preference.enabled || !enabledGlobally.value) return t('pluginStatusDisabled')
  return t('pluginStatusEnabled')
}

function pluginStatusTone(plugin: PluginPanelPlugin): 'success' | 'warn' | 'neutral' {
  if (plugin.status === 'disabled_crashed' || plugin.status === 'incompatible' || !plugin.manifest) return 'warn'
  return plugin.preference.enabled && enabledGlobally.value ? 'success' : 'neutral'
}

function localizedError(code: string): string {
  if (code === 'too_many_enabled') {
    return t('pluginTooManyEnabled', {
      limit: String(snapshot.value?.preferences.resources.maxEnabledPlugins ?? 10),
    })
  }
  const keys: Record<string, TranslationKey> = {
    disabled: 'pluginPanelUnavailable',
    host_unavailable: 'pluginCommandHostUnavailable',
    not_permitted: 'pluginCommandNotPermitted',
    rate_limited: 'pluginCommandRateLimited',
    panel_unavailable: 'pluginPanelViewUnavailable',
    panel_load_failed: 'pluginPanelViewLoadFailed',
    panel_crashed: 'pluginPanelViewCrashed',
    panel_closed: 'pluginPanelViewClosed',
    preferences_unsafe: 'pluginPreferencesUnsafe',
    plugin_service_unavailable: 'pluginServiceUnavailable',
    archive_too_large: 'pluginArchiveTooLarge',
    signature_invalid: 'pluginSignatureInvalid',
    signature_confirmation_required: 'pluginSignatureConfirmationRequired',
    invalid_archive: 'pluginInvalidArchive',
    invalid_manifest: 'pluginInvalidArchive',
    incompatible: 'pluginIncompatible',
    permission_reconsent_required: 'pluginReconsentRequired',
    filesystem_unsafe: 'pluginFilesystemUnsafe',
    plan_not_found: 'pluginPlanExpired',
    plugin_not_found: 'pluginNotFound',
    report_unavailable: 'pluginReportUnavailable',
    invalid_request: 'plugins.errInvalidRequest',
    secret_unavailable: 'pluginSecretUnavailable',
    secret_not_found: 'pluginSecretNotFound',
    secret_consent_required: 'pluginSecretConsentRequired',
    settings_invalid: 'pluginSettingsInvalid',
    dialog_unavailable: 'plugins.errDialogUnavailable',
    install_failed: 'plugins.errInstallFailed',
    registry_unavailable: 'plugins.errRegistryUnavailable',
    catalog_disabled: 'pluginCatalogDisabledError',
    catalog_url_invalid: 'pluginCatalogUrlInvalid',
    catalog_unavailable: 'pluginCatalogUnavailable',
    catalog_not_found: 'pluginCatalogNotFound',
    catalog_invalid: 'pluginCatalogInvalid',
    download_mismatch: 'pluginCatalogDownloadMismatch',
    signature_mismatch: 'pluginCatalogSignatureMismatch',
    plugin_not_in_catalog: 'pluginCatalogUnavailable',
    host_not_allowed: 'pluginCatalogHostNotAllowed',
  }
  return t(keys[code] ?? 'pluginActionFailed')
}

function setError(code: string, retry?: () => void): void {
  notifier.notify({
    tone: 'error',
    text: localizedError(code),
    detail: code,
    action: retry ? { label: t('plugins.retry'), run: retry } : undefined,
  })
}

function setStatus(text: string, action?: { label: string; run: () => void }): void {
  notifier.notify({ tone: 'success', text, action })
}

async function refreshNotifications(): Promise<void> {
  try {
    const result = await window.electronAPI?.listPluginNotifications()
    if (result?.ok) notifications.value = result.value
    else if (result && !result.ok) setError(result.error)
  } catch {
    setError('plugin_action_failed')
  }
}

// 重新抓取快照。進行中又被呼叫時排成「結尾再抓一次」，而不是直接丟掉；
// silent 用於背景同步（例如切換啟用後更新崩潰狀態），不會讓整頁進入 loading。
async function refreshPanel(options: { silent?: boolean } = {}): Promise<void> {
  if (refreshInFlight) {
    refreshQueued = true
    return
  }
  refreshInFlight = true
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
    if (!result.value.plugins.some(plugin => plugin.id === selectedPluginId.value)) selectedPluginId.value = ''
    if (detailPluginId.value && !result.value.plugins.some(plugin => plugin.id === detailPluginId.value)) {
      detailPluginId.value = ''
    }
    await refreshNotifications()
  } catch {
    setError('plugin_service_unavailable')
  } finally {
    refreshInFlight = false
    if (!options.silent) loading.value = false
    if (refreshQueued) {
      refreshQueued = false
      void refreshPanel({ silent: true })
    }
  }
}

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

async function refreshDiagnostics(pluginId = selectedPluginId.value): Promise<void> {
  logs.value = []
  diagnostics.value = []
  if (!pluginId) return
  try {
    const result = await window.electronAPI?.getPluginDiagnostics(pluginId)
    if (result?.ok) {
      logs.value = result.value.logs
      diagnostics.value = result.value.diagnostics
    } else if (result && !result.ok) setError(result.error)
  } catch {
    setError('plugin_action_failed')
  }
}

async function refreshPluginSettings(pluginId = selectedPluginId.value): Promise<void> {
  pluginSettings.value = null
  settingsDraft.value = {}
  secretDrafts.value = {}
  settingsErrors.value = {}
  const plugin = plugins.value.find(item => item.id === pluginId)
  if (!plugin?.manifest?.contributes.settings) return
  try {
    const result = await window.electronAPI?.getPluginSettings(pluginId)
    if (!result?.ok) {
      if (result && !result.ok) setError(result.error)
      return
    }
    pluginSettings.value = result.value
    settingsDraft.value = { ...result.value.values }
    secretDrafts.value = Object.fromEntries(Object.keys(result.value.secrets).map(key => [key, '']))
  } catch {
    setError('plugin_action_failed')
  }
}

function commandOf(plugin: PluginPanelPlugin, commandId: string) {
  return plugin.manifest?.contributes.commands?.find(command => command.id === commandId) ?? { title: { 'zh-TW': commandId, 'en-US': commandId } }
}

function commandTitle(command: { title: { 'zh-TW': string; 'en-US': string } }): string {
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

function settingTitle(title: string | { 'zh-TW': string; 'en-US': string } | undefined, fallback: string): string {
  if (typeof title === 'string') return title
  return title?.[locale.value] ?? fallback
}

function settingValue(key: string, definition: { default?: PluginSettingScalar }): string {
  const value = settingsDraft.value[key] ?? definition.default ?? ''
  return String(value)
}

function updateSetting(key: string, type: string, raw: string | boolean | number): void {
  const value = type === 'boolean' ? Boolean(raw) : type === 'number' ? Number(raw) : String(raw)
  settingsDraft.value = { ...settingsDraft.value, [key]: value as PluginSettingScalar }
  if (settingsErrors.value[key]) {
    const { [key]: _removed, ...rest } = settingsErrors.value
    settingsErrors.value = rest
  }
}

async function savePluginSettings(): Promise<void> {
  const pluginId = selectedPluginId.value
  const scope = `plugin:${pluginId}`
  if (!pluginId || isBusy(scope)) return
  settingsErrors.value = validateSettings(settingsProperties.value, settingsDraft.value)
  if (Object.keys(settingsErrors.value).length > 0) return
  setBusy(scope, true)
  try {
    const result = await window.electronAPI?.setPluginSettings(pluginId, settingsDraft.value)
    if (!result?.ok) {
      if (result && !result.ok) setError(result.error)
      return
    }
    settingsDraft.value = { ...result.value }
    if (pluginSettings.value) pluginSettings.value.values = { ...result.value }
    setStatus(t('pluginSettingsSaved'))
  } catch {
    setError('plugin_action_failed')
  } finally {
    setBusy(scope, false)
  }
}

async function savePluginSecret(key: string): Promise<void> {
  const pluginId = selectedPluginId.value
  const scope = `plugin:${pluginId}`
  if (!pluginId || isBusy(scope)) return
  if ((secretDrafts.value[key] ?? '').length > 0) {
    try {
      const consent = await window.electronAPI?.getPluginSecretConsent()
      if (!consent?.ok) {
        setError(consent && !consent.ok ? consent.error : 'plugin_service_unavailable')
        return
      }
      if (!consent.value) {
        pendingSecretConsentKey.value = key
        return
      }
    } catch {
      setError('plugin_action_failed')
      return
    }
  }
  setBusy(scope, true)
  try {
    const result = await window.electronAPI?.setPluginSecret(pluginId, key, secretDrafts.value[key] ?? '')
    if (!result?.ok) {
      if (result && !result.ok) setError(result.error)
      return
    }
    if (pluginSettings.value) pluginSettings.value.secrets[key] = result.value.configured
    secretDrafts.value = { ...secretDrafts.value, [key]: '' }
    setStatus(result.value.configured ? t('pluginSecretSaved') : t('pluginSettingsSaved'))
  } catch {
    setError('plugin_action_failed')
  } finally {
    setBusy(scope, false)
  }
}

// 移除密鑰是獨立動作（不是「儲存空值」），先由對話框確認再清除。
async function removePluginSecret(key: string): Promise<void> {
  const pluginId = selectedPluginId.value
  const scope = `plugin:${pluginId}`
  pendingSecretRemoveKey.value = ''
  if (!pluginId || isBusy(scope)) return
  setBusy(scope, true)
  try {
    const result = await window.electronAPI?.setPluginSecret(pluginId, key, '')
    if (!result?.ok) {
      setError(result && !result.ok ? result.error : 'plugin_service_unavailable')
      return
    }
    if (pluginSettings.value) pluginSettings.value.secrets[key] = result.value.configured
    secretDrafts.value = { ...secretDrafts.value, [key]: '' }
    setStatus(t('plugins.secretRemoved'))
  } catch {
    setError('plugin_action_failed')
  } finally {
    setBusy(scope, false)
  }
}

async function confirmSecretConsent(): Promise<void> {
  const key = pendingSecretConsentKey.value
  const scope = `plugin:${selectedPluginId.value}`
  if (!key || isBusy(scope)) return
  setBusy(scope, true)
  try {
    const result = await window.electronAPI?.acceptPluginSecretConsent()
    if (!result?.ok) {
      setError(result && !result.ok ? result.error : 'plugin_service_unavailable')
      return
    }
    pendingSecretConsentKey.value = ''
  } catch {
    setError('plugin_action_failed')
  } finally {
    setBusy(scope, false)
  }
  if (!pendingSecretConsentKey.value) await savePluginSecret(key)
}

// 全域偏好以串行佇列送出：連續修改（例如多個欄位）依序生效，不會被「忙碌」丟棄。
// 成功後直接採用主行程回傳的偏好，不再整頁重新抓取。
async function updateGlobalPreferences(patch: PluginGlobalPreferencesPatch): Promise<void> {
  await enqueueSerial('global', async () => {
    const previousCatalogUrl = snapshot.value?.preferences.catalogUrl
    const stoppedCount = patch.pluginsEnabled === false && enabledGlobally.value
      ? plugins.value.filter(plugin => plugin.preference.enabled).length
      : 0
    setBusy('global', true)
    try {
      const result = await window.electronAPI?.setPluginGlobalPreferences(patch)
      if (!result?.ok) {
        if (result && !result.ok) setError(result.error)
        return
      }
      if (snapshot.value) mergePreferencesResult(snapshot.value, result.value)
      catalogUrlDraft.value = result.value.catalogUrl
      if (patch.pluginsEnabled === false && stoppedCount > 0) {
        notifier.notify({
          tone: 'success',
          text: t('plugins.globalStopped', { count: stoppedCount }),
          durationMs: 6000,
          action: { label: t('plugins.undo'), run: () => void updateGlobalPreferences({ pluginsEnabled: true }) },
        })
      }
      if (patch.onlineCatalogEnabled === false
        || (patch.catalogUrl !== undefined && patch.catalogUrl !== previousCatalogUrl)) {
        catalogItems.value = []
        catalogCheckComplete.value = false
        catalogLoadedAt.value = null
      }
    } catch {
      setError('plugin_action_failed')
    } finally {
      setBusy('global', false)
    }
  })
}

async function saveCatalogUrl(): Promise<void> {
  const previousUrl = snapshot.value?.preferences.catalogUrl ?? ''
  await updateGlobalPreferences({ catalogUrl: catalogUrlDraft.value })
  if (previousUrl !== snapshot.value?.preferences.catalogUrl) {
    catalogItems.value = []
    catalogCheckComplete.value = false
    catalogLoadedAt.value = null
  }
}

// 目錄載入失敗以 inline 錯誤 + 重試呈現（catalogError），不再只丟 Toast。
// silent：自動載入（進入探索分頁、背景同步）不顯示成功訊息。
async function loadPluginCatalog(options: { silent?: boolean } = {}): Promise<void> {
  const scope = 'catalog'
  if (isBusy(scope) || !onlineCatalogEnabled.value) return
  setBusy(scope, true)
  catalogError.value = ''
  try {
    const result = await window.electronAPI?.listPluginCatalog()
    if (!result?.ok) {
      catalogError.value = result && !result.ok ? result.error : 'catalog_unavailable'
      return
    }
    catalogItems.value = result.value
    catalogCheckComplete.value = true
    catalogLoadedAt.value = Date.now()
    if (!options.silent) {
      setStatus(t('pluginCatalogChecked', {
        entries: String(result.value.length),
        updates: String(result.value.filter(item => item.updateAvailable).length),
      }))
    }
  } catch {
    catalogError.value = 'catalog_unavailable'
  } finally {
    setBusy(scope, false)
  }
}

// 進入探索分頁時：目錄已啟用且尚未載入才自動載入一次（已載入的結果沿用，使用者可手動重新檢查）。
async function ensureCatalogLoaded(): Promise<void> {
  if (!onlineCatalogEnabled.value || catalogLoadedAt.value !== null || isBusy('catalog')) return
  await loadPluginCatalog({ silent: true })
}

// 「全部更新」：逐一為每個可更新項目產生安裝計畫並開啟同一個確認 Sheet，絕不跳過同意。
async function installNextQueuedUpdate(): Promise<void> {
  const next = updateQueue.value[0]
  if (!next) return
  updateQueue.value = updateQueue.value.slice(1)
  await installCatalogPlugin(next)
}

async function updateAllCatalogPlugins(): Promise<void> {
  if (pendingPlan.value) return
  updateQueue.value = catalogItems.value.filter(item => item.updateAvailable)
  await installNextQueuedUpdate()
}

function catalogItemFor(pluginId: string): PluginCatalogPanelItem | undefined {
  return catalogItems.value.find(item => item.plugin.id === pluginId)
}

async function installCatalogPlugin(item: PluginCatalogPanelItem): Promise<void> {
  const scope = 'install'
  if (isBusy(scope)) return
  setBusy(scope, true)
  try {
    const result = await window.electronAPI?.installPluginFromCatalog(item.plugin.id, item.latestVersion.version)
    if (!result?.ok) {
      if (result && !result.ok) setError(result.error)
      return
    }
    pendingPlan.value = result.value
  } catch {
    setError('plugin_action_failed')
  } finally {
    setBusy(scope, false)
  }
}

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
  const scope = `plugin:${pluginId}`
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

function updateResourceLimit(key: keyof PluginResourceLimits, raw: string): void {
  const field = resourceFields.find(item => item.key === key)
  const parsed = Number(raw)
  const value = key === 'netMaxResponseBytes' || key === 'storageBytesPerPlugin' ? parsed * 1024 : parsed
  if (!field || !Number.isSafeInteger(value) || value < field.min || value > field.max) {
    if (field) {
      notifier.notify({ tone: 'error', text: t('pluginResourceRangeInvalid', { min: String(field.min), max: String(field.max) }) })
    }
    return
  }
  void updateGlobalPreferences({ resources: { [key]: value } })
}

function resourceInputValue(key: keyof PluginResourceLimits, value: number): string {
  return String(key === 'netMaxResponseBytes' || key === 'storageBytesPerPlugin' ? value / 1024 : value)
}

function resourceBoundText(key: keyof PluginResourceLimits, value: number): string {
  const number = (amount: number) => formatNumber(amount, locale.value, { maximumFractionDigits: 1 })
  const unit = (amount: number, name: 'megabyte' | 'kilobyte' | 'second') =>
    formatNumber(amount, locale.value, { style: 'unit', unit: name, unitDisplay: 'short', maximumFractionDigits: 1 })
  if (key === 'memoryMbPerPlugin') return unit(value, 'megabyte')
  if (key === 'netMaxResponseBytes' || key === 'storageBytesPerPlugin') {
    return value % (1024 * 1024) === 0 ? unit(value / (1024 * 1024), 'megabyte') : unit(value / 1024, 'kilobyte')
  }
  if (key === 'netTimeoutSeconds' || key === 'scheduleMinIntervalSeconds') return t('plugins.unitSeconds', { value: number(value) })
  if (key === 'netRequestsPerMinute') return t('plugins.unitPerMinute', { value: number(value) })
  if (key === 'globalFeedPer10Min') return t('plugins.unitPerTenMinutes', { value: number(value) })
  return number(value)
}

// 單一插件的偏好採樂觀更新：先改畫面，失敗再回滾該欄位並顯示錯誤；同一插件的變更依序送出。
async function updatePluginPreference(pluginId: string, patch: PluginPreferencePatch): Promise<void> {
  const current = snapshot.value
  if (!current) return
  const previous = applyPreferencePatch(current, pluginId, patch)
  const scope = `plugin:${pluginId}`
  setBusy(scope, true)
  try {
    await enqueueSerial(scope, async () => {
      try {
        const result = await window.electronAPI?.setPluginInstancePreferences(pluginId, patch)
        if (!result?.ok) {
          if (snapshot.value) rollbackPreferencePatch(snapshot.value, pluginId, previous)
          setError(result && !result.ok ? result.error : 'plugin_service_unavailable')
          return
        }
        if (snapshot.value) mergePreferencesResult(snapshot.value, result.value)
        if (patch.enabled !== undefined) void refreshPanel({ silent: true })
      } catch {
        if (snapshot.value) rollbackPreferencePatch(snapshot.value, pluginId, previous)
        setError('plugin_action_failed')
      }
    })
  } finally {
    setBusy(scope, false)
  }
}

async function updatePluginRate(pluginId: string, raw: string): Promise<void> {
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1 || value > 30) {
    notifier.notify({ tone: 'error', text: t('pluginPerPluginRateRange') })
    return
  }
  await updatePluginPreference(pluginId, { rateLimitPer10Min: value })
}

async function updatePluginTarget(pluginId: string, targetPetId: string): Promise<void> {
  await updatePluginPreference(pluginId, { targetPetId: targetPetId || null })
}

// 撤銷主機授權：立即生效，並以 5 秒內可復原的 Toast 取代確認對話框；
// 之後插件再要連線時會重新詢問使用者。
async function revokeGrantedHost(plugin: PluginPanelPlugin, host: string): Promise<void> {
  const previous = [...plugin.preference.grantedHosts]
  await updatePluginPreference(plugin.id, {
    grantedHosts: previous.filter(item => item !== host),
  })
  if (plugin.preference.grantedHosts.includes(host)) return
  notifier.notify({
    tone: 'success',
    text: t('plugins.hostRevoked', { host }),
    durationMs: 5000,
    action: { label: t('plugins.undo'), run: () => void updatePluginPreference(plugin.id, { grantedHosts: previous }) },
  })
}

async function selectArchive(): Promise<void> {
  const scope = 'install'
  if (isBusy(scope)) return
  setBusy(scope, true)
  pendingPlan.value = null
  try {
    const result = await window.electronAPI?.selectPluginArchive()
    if (!result?.ok) {
      if (result && !result.ok && !result.cancelled) setError(result.error)
      return
    }
    pendingPlan.value = result.value
  } catch {
    setError('plugin_action_failed')
  } finally {
    setBusy(scope, false)
  }
}

async function selectDeveloperFolder(): Promise<void> {
  const scope = 'install'
  if (isBusy(scope)) return
  setBusy(scope, true)
  pendingPlan.value = null
  try {
    const result = await window.electronAPI?.selectPluginFolder()
    if (!result?.ok) {
      if (result && !result.ok && !result.cancelled) setError(result.error)
      return
    }
    pendingPlan.value = result.value
  } catch {
    setError('plugin_action_failed')
  } finally {
    setBusy(scope, false)
  }
}

function planKindLabel(plan: PluginInstallPlan): string {
  const keys: Record<PluginInstallPlan['kind'], TranslationKey> = {
    new: 'pluginInstallNew',
    update: 'pluginInstallUpdate',
    downgrade: 'pluginInstallDowngrade',
    reinstall: 'pluginInstallReinstall',
    incompatible: 'pluginIncompatible',
  }
  return t(keys[plan.kind])
}

function permissionLabel(unit: string): string {
  const { kind, detail } = parsePermissionUnit(unit)
  if (kind === 'network' && detail === 'userGranted') return t('plugins.permNetworkUserGranted')
  if (kind === 'network') return t('pluginPermissionNetwork', { host: detail })
  if (kind === 'links') return t('pluginPermissionLinks', { host: detail })
  if (kind === 'storage') return t('pluginPermissionStorage')
  if (kind === 'agentStatus') return t('pluginPermissionAgentStatus')
  if (kind === 'schedule') return t('pluginPermissionSchedule')
  if (kind === 'secrets') return t('pluginPermissionSecret', { name: detail })
  if (detail === 'feed') return t('pluginPermissionFeed')
  if (detail === 'reaction') return t('pluginPermissionReaction')
  if (detail === 'panelView') return t('pluginPermissionPanel')
  if (detail === 'commands') return t('pluginPermissionCommands')
  if (detail === 'tray') return t('pluginPermissionTray')
  if (detail === 'badge') return t('pluginPermissionBadge')
  if (detail === 'eventSource') return t('pluginPermissionEventSource')
  if (detail.startsWith('skins:')) return t('pluginPermissionSkins', { count: detail.slice(6) })
  return t('plugins.permUnknown', { unit })
}

function permissionHint(unit: string): string {
  const { kind, detail } = parsePermissionUnit(unit)
  if (kind === 'network' && detail === 'userGranted') return t('plugins.hintNetworkUserGranted')
  if (kind === 'network') return t('plugins.hintNetwork')
  if (kind === 'links') return t('plugins.hintLinks')
  if (kind === 'storage') return t('plugins.hintStorage')
  if (kind === 'agentStatus') return t('plugins.hintAgentStatus')
  if (kind === 'schedule') return t('plugins.hintSchedule')
  if (kind === 'secrets') return t('plugins.hintSecrets')
  if (detail === 'feed') return t('plugins.hintFeed')
  if (detail === 'reaction') return t('plugins.hintReaction')
  if (detail === 'panelView') return t('plugins.hintPanel')
  if (detail === 'commands') return t('plugins.hintCommands')
  if (detail === 'tray') return t('plugins.hintTray')
  if (detail === 'badge') return t('plugins.hintBadge')
  if (detail === 'eventSource') return t('plugins.hintEventSource')
  if (detail.startsWith('skins:')) return t('plugins.hintSkins')
  return t('plugins.hintUnknown')
}

function toGroupViews(units: readonly string[]): PermissionGroupView[] {
  return groupPermissionUnits(units).map(group => ({
    id: group.id,
    risk: group.risk,
    entries: group.entries.map(entry => ({
      unit: entry.unit,
      label: permissionLabel(entry.unit),
      hint: permissionHint(entry.unit),
      risk: entry.risk,
      known: entry.known,
    })),
  }))
}

// 更新時：新增權限單獨置頂，既有權限折疊；新安裝時所有權限都是「新增」。
const pendingPermissionSections = computed(() => {
  const plan = pendingPlan.value
  if (!plan) return { isUpdate: false, added: [] as PermissionGroupView[], existing: [] as PermissionGroupView[], existingCount: 0 }
  const units = permissionUnitsOfPlan(plan)
  const isUpdate = plan.requiresReconsent && plan.addedPermissions.length > 0
  if (!isUpdate) return { isUpdate: false, added: toGroupViews(units), existing: [], existingCount: 0 }
  const added = new Set(plan.addedPermissions)
  const existingUnits = units.filter(unit => !added.has(unit))
  return {
    isUpdate: true,
    added: toGroupViews(plan.addedPermissions),
    existing: toGroupViews(existingUnits),
    existingCount: existingUnits.length,
  }
})
const installAcknowledgements = computed(() => installAcknowledgementReasons(pendingPlan.value))

async function confirmInstall(): Promise<void> {
  const plan = pendingPlan.value
  const scope = 'install'
  if (!plan || plan.kind === 'incompatible' || isBusy(scope)) return
  setBusy(scope, true)
  try {
    const result = await window.electronAPI?.installPluginPlan(
      plan.token,
      plan.requiresReconsent,
      plan.requiresSignatureConfirmation === true,
    )
    if (!result?.ok) {
      if (result && !result.ok) setError(result.error)
      return
    }
    pendingPlan.value = null
    if (catalogLoadedAt.value) void loadPluginCatalog({ silent: true })
    const installed = result.value
    setStatus(
      enabledGlobally.value
        ? t('pluginInstallSucceeded', { name: pluginName(installed) })
        : t('plugins.installSucceededGlobalOff', { name: pluginName(installed) }),
      { label: t(enabledGlobally.value ? 'plugins.enableNow' : 'plugins.enableAll'), run: () => void enableInstalledPlugin(installed.id) },
    )
    await refreshPanel()
  } catch {
    setError('plugin_action_failed')
  } finally {
    setBusy(scope, false)
  }
}

// 安裝成功 Toast 的「立即啟用」：全域關閉時一併開啟全域開關。
async function enableInstalledPlugin(pluginId: string): Promise<void> {
  if (!enabledGlobally.value) await updateGlobalPreferences({ pluginsEnabled: true })
  await updatePluginPreference(pluginId, { enabled: true })
}

function requestRemove(plugin: PluginPanelPlugin): void {
  pendingRemove.value = plugin
  keepData.value = true
}

async function confirmRemove(): Promise<void> {
  const plugin = pendingRemove.value
  const scope = `plugin:${plugin?.id ?? ''}`
  if (!plugin || isBusy(scope)) return
  setBusy(scope, true)
  try {
    const result = await window.electronAPI?.removeInstalledPlugin(plugin.id, keepData.value)
    if (!result?.ok) {
      if (result && !result.ok) setError(result.error)
      return
    }
    pendingRemove.value = null
    setStatus(t('pluginRemoveSucceeded'))
    await refreshPanel()
  } catch {
    setError('plugin_action_failed')
  } finally {
    setBusy(scope, false)
  }
}

async function markNotificationRead(itemId: string): Promise<void> {
  try {
    const result = await window.electronAPI?.markPluginNotificationRead(itemId)
    if (!result?.ok) {
      if (result && !result.ok) setError(result.error)
      return
    }
    await refreshNotifications()
  } catch {
    setError('plugin_action_failed')
  }
}

async function openNotificationLink(itemId: string): Promise<void> {
  try {
    const opened = await window.electronAPI?.openPluginFeedLink(itemId)
    if (!opened) setError('plugin_action_failed')
  } catch {
    setError('plugin_action_failed')
  }
}

// 清除通知採「延遲提交」：先從畫面隱藏並顯示可復原的 Toast，5 秒後才真正呼叫主行程清除；
// 復原即取消提交。離開頁面或再次清除時，會先提交前一批。
const CLEAR_UNDO_MS = 5000
let pendingClear: { ids: Set<string>; pluginId?: string; timer: ReturnType<typeof setTimeout> } | null = null

async function commitPendingClear(): Promise<void> {
  const pending = pendingClear
  if (!pending) return
  pendingClear = null
  clearTimeout(pending.timer)
  try {
    const result = await window.electronAPI?.clearPluginNotifications(pending.pluginId)
    if (result && !result.ok) setError(result.error)
  } catch {
    setError('plugin_action_failed')
  } finally {
    hiddenNotificationIds.value = new Set()
    await refreshNotifications()
  }
}

async function clearNotifications(pluginId?: string): Promise<void> {
  await commitPendingClear()
  const ids = new Set(notifications.value.filter(record => !pluginId || record.item.pluginId === pluginId).map(record => record.item.id))
  if (ids.size === 0) return
  hiddenNotificationIds.value = ids
  pendingClear = { ids, pluginId, timer: setTimeout(() => void commitPendingClear(), CLEAR_UNDO_MS) }
  notifier.notify({
    tone: 'success',
    text: t('plugins.notificationsCleared', { count: ids.size }),
    durationMs: CLEAR_UNDO_MS,
    action: {
      label: t('plugins.undo'),
      run: () => {
        if (pendingClear) clearTimeout(pendingClear.timer)
        pendingClear = null
        hiddenNotificationIds.value = new Set()
      },
    },
  })
}

async function markAllNotificationsRead(pluginId?: string): Promise<void> {
  // One IPC (and one change broadcast) for the whole set instead of one per record.
  const hasUnread = visibleNotifications.value.some(record => !record.read && (!pluginId || record.item.pluginId === pluginId))
  if (!hasUnread) return
  await window.electronAPI?.markAllPluginNotificationsRead(pluginId)
  await refreshNotifications()
}

function notificationSource(item: PluginNotificationRecord): string {
  return plugins.value.find(plugin => plugin.id === item.item.pluginId)?.manifest?.name[locale.value]
    ?? item.item.pluginName[locale.value]
}

function notificationTime(timestamp: number): string {
  return formatDateTime(timestamp, locale.value)
}

function diagnosticTime(timestamp: number): string {
  return formatDateParts(timestamp, { hour: '2-digit', minute: '2-digit', second: '2-digit' }, locale.value)
}

// 診斷以人話呈現；原始的 method / code 只放在 diagnosticTechnical，由畫面收在 title 與技術細節。
function diagnosticCodeLabel(item: PluginBrokerDiagnostic): string {
  if (item.code === 'host_unavailable') return t('pluginHostUnavailableTitle')
  if (item.code === 'too_many_enabled') {
    if (item.method === 'plugin.tray') return t('pluginTrayOverflowDiagnostic')
    return t('pluginTooManyEnabled', {
      limit: String(snapshot.value?.preferences.resources.maxEnabledPlugins ?? 10),
    })
  }
  const reasons: Record<string, TranslationKey> = {
    not_permitted: 'plugins.reasonNotPermitted',
    rate_limited: 'plugins.reasonRateLimited',
    disabled: 'plugins.reasonDisabled',
  }
  return t('plugins.diagnosticRejectedHuman', { reason: t(reasons[item.code] ?? 'plugins.reasonOther') })
}

function diagnosticTechnical(item: PluginBrokerDiagnostic): string {
  return item.method ? `${item.code} · ${item.method}` : item.code
}

watch(pendingPlan, plan => {
  if (!plan && updateQueue.value.length) void installNextQueuedUpdate()
})

watch(selectedPluginId, pluginId => {
  if (panelViewPluginId.value && panelViewPluginId.value !== pluginId) closePluginPanelView()
  void refreshDiagnostics(pluginId)
  void refreshPluginSettings(pluginId)
})

watch(panelViewPluginId, async (pluginId, previousPluginId) => {
  if (shouldResetPluginPanelMaximized(previousPluginId, pluginId)) {
    await restorePluginPanelViewMaximized()
  }
  panelViewBoundsObserver?.disconnect()
  panelViewBoundsObserver = null
  window.removeEventListener('resize', sendPluginPanelViewBounds)
  window.removeEventListener('scroll', sendPluginPanelViewBounds, true)
  if (!pluginId) return
  await nextTick()
  const frame = panelViewFrame.value
  const content = panelViewContent.value
  if (!frame || !content) return
  panelViewBoundsObserver = new ResizeObserver(sendPluginPanelViewBounds)
  panelViewBoundsObserver.observe(frame)
  panelViewBoundsObserver.observe(content)
  window.addEventListener('resize', sendPluginPanelViewBounds)
  window.addEventListener('scroll', sendPluginPanelViewBounds, true)
  sendPluginPanelViewBounds()
}, { flush: 'post' })

watch(panelViewPlugin, plugin => {
  if (!plugin) void restorePluginPanelViewMaximized()
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
  if (plugins.value.some(plugin => plugin.id === pluginId)) void openPluginPanelView(pluginId)
}

watch(() => [props.requestedPluginId, props.requestNonce] as const, consumePanelRequest)

onMounted(() => {
  void refreshPanel().then(() => {
    if (dailyUpdateCheck.value) void ensureCatalogLoaded()
    consumePanelRequest()
    // Opened from a dashboard plugin tab: jump straight to that plugin's detail page.
    const detailRequest = takePluginDetailRequest()
    if (detailRequest) openPluginDetail(detailRequest.pluginId, detailRequest.section)
  })
  void loadPetOptions()
  window.addEventListener('keydown', onPluginPanelViewKeydown, true)
  void window.electronAPI?.getPluginBadges?.().then(badges => { liveBadges.value = badges }).catch(() => {})
  removeBadgesListener = window.electronAPI?.onPluginBadgesChanged?.(badges => { liveBadges.value = badges }) ?? null
  void window.electronAPI?.getPluginEventSourceStatuses?.().then(statuses => { eventSourceStatuses.value = statuses }).catch(() => {})
  removeEventSourceListener = window.electronAPI?.onPluginEventSourceChanged?.(statuses => { eventSourceStatuses.value = statuses }) ?? null
  removePanelClosedListener = window.electronAPI?.onPluginPanelViewClosed(handlePluginPanelViewClosed) ?? null
  removeNotificationsListener = window.electronAPI?.onPluginNotificationsChanged(() => {
    void refreshNotifications()
  }) ?? null
})

onUnmounted(() => {
  void commitPendingClear()
  notifier.dispose()
  removeBadgesListener?.()
  removeEventSourceListener?.()
  window.removeEventListener('keydown', onPluginPanelViewKeydown, true)
  removeNotificationsListener?.()
  removePanelClosedListener?.()
  panelViewBoundsObserver?.disconnect()
  window.removeEventListener('resize', sendPluginPanelViewBounds)
  window.removeEventListener('scroll', sendPluginPanelViewBounds, true)
  panelViewRequestSequence += 1
  if (panelViewOpenToken.value) window.electronAPI?.closePluginPanelView(panelViewOpenToken.value)
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
    removeNotificationsListener,
    removePanelClosedListener,
    panelViewBoundsObserver,
    panelViewRequestSequence,
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
