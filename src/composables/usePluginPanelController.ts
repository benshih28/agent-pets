
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { locale, t, type TranslationKey } from '@/i18n'
import { isCurrentPluginPanelViewClose, pluginPanelViewCloseError } from '@/utils/plugin-panel-view'
import { resolvePluginIconUrl } from '@/utils/plugin-icon'
import type {
  PluginBrokerDiagnostic,
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
export function usePluginPanelController(props: { requestedPluginId?: string }) {

const snapshot = ref<PluginPanelSnapshot | null>(null)
const notifications = ref<PluginNotificationRecord[]>([])
const logs = ref<PluginBrokerLogEntry[]>([])
const diagnostics = ref<PluginBrokerDiagnostic[]>([])
const petOptions = ref<Array<{ id: string; displayName: string }>>([])
const pluginSettings = ref<PluginPanelSettingsSnapshot | null>(null)
const settingsDraft = ref<Record<string, PluginSettingScalar>>({})
const secretDrafts = ref<Record<string, string>>({})
const selectedPluginId = ref('')
const panelViewPluginId = ref('')
const panelViewOpenToken = ref(0)
const panelViewFrame = ref<HTMLElement | null>(null)
const panelViewContent = ref<HTMLElement | null>(null)
const busy = ref(false)
const invokingCommandId = ref('')
const loading = ref(false)
const errorMessage = ref('')
const statusMessage = ref('')
const pendingPlan = ref<PluginInstallPlan | null>(null)
const pendingRemove = ref<PluginPanelPlugin | null>(null)
const pendingSecretConsentKey = ref('')
const catalogItems = ref<PluginCatalogPanelItem[]>([])
const catalogCheckComplete = ref(false)
const catalogSearch = ref('')
const catalogUrlDraft = ref('')
const keepData = ref(false)
let removeNotificationsListener: (() => void) | null = null
let removePanelClosedListener: (() => void) | null = null
let panelViewBoundsObserver: ResizeObserver | null = null
let panelViewRequestSequence = 0

const plugins = computed(() => snapshot.value?.plugins ?? [])
const selectedPlugin = computed(() => plugins.value.find(plugin => plugin.id === selectedPluginId.value) ?? null)
const panelViewPlugin = computed(() => plugins.value.find(plugin => plugin.id === panelViewPluginId.value) ?? null)
const enabledGlobally = computed(() => snapshot.value?.preferences.pluginsEnabled ?? false)
const onlineCatalogEnabled = computed(() => snapshot.value?.preferences.onlineCatalogEnabled ?? false)
const dailyUpdateCheck = computed(() => snapshot.value?.preferences.dailyUpdateCheck ?? false)
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

async function openPluginPanelView(pluginId: string): Promise<void> {
  const plugin = plugins.value.find(item => item.id === pluginId)
  if (!plugin?.manifest?.contributes.panelView || !plugin.preference.enabled || !enabledGlobally.value) {
    setError('disabled')
    return
  }
  const requestSequence = ++panelViewRequestSequence
  const previousOpenToken = panelViewOpenToken.value
  panelViewOpenToken.value = 0
  if (previousOpenToken) window.electronAPI?.closePluginPanelView(previousOpenToken)
  selectedPluginId.value = pluginId
  panelViewPluginId.value = pluginId
  errorMessage.value = ''
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
      panelViewPluginId.value = ''
      setError(result && !result.ok ? result.error : 'plugin_service_unavailable')
      return
    }
    panelViewOpenToken.value = result.value.openToken
    await nextTick()
    sendPluginPanelViewBounds()
  } catch {
    if (requestSequence !== panelViewRequestSequence) return
    panelViewPluginId.value = ''
    setError('plugin_service_unavailable')
  }
}

function closePluginPanelView(): void {
  panelViewRequestSequence += 1
  const openToken = panelViewOpenToken.value
  panelViewOpenToken.value = 0
  panelViewPluginId.value = ''
  if (openToken) window.electronAPI?.closePluginPanelView(openToken)
}

function handlePluginPanelViewClosed(event: PluginPanelViewClosedEvent): void {
  if (!isCurrentPluginPanelViewClose(event, panelViewPluginId.value, panelViewOpenToken.value)) return
  panelViewRequestSequence += 1
  panelViewOpenToken.value = 0
  panelViewPluginId.value = ''
  if (event.reason !== 'hidden') setError(pluginPanelViewCloseError(event.reason))
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
    invalid_request: 'pluginActionFailed',
    secret_unavailable: 'pluginSecretUnavailable',
    secret_not_found: 'pluginSecretNotFound',
    secret_consent_required: 'pluginSecretConsentRequired',
    settings_invalid: 'pluginSettingsInvalid',
    dialog_unavailable: 'pluginActionFailed',
    install_failed: 'pluginActionFailed',
    registry_unavailable: 'pluginActionFailed',
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

function setError(code: string): void {
  errorMessage.value = localizedError(code)
  statusMessage.value = ''
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

async function refreshPanel(): Promise<void> {
  if (loading.value) return
  loading.value = true
  errorMessage.value = ''
  try {
    const result = await window.electronAPI?.getPluginPanelSnapshot()
    if (!result?.ok) {
      if (result && !result.ok) setError(result.error)
      else setError('plugin_service_unavailable')
      return
    }
    snapshot.value = result.value
    catalogUrlDraft.value = result.value.preferences.catalogUrl
    const requestedPluginId = props.requestedPluginId
    if (requestedPluginId && result.value.plugins.some(plugin => plugin.id === requestedPluginId)) {
      selectedPluginId.value = requestedPluginId
      void openPluginPanelView(requestedPluginId)
    } else if (!result.value.plugins.some(plugin => plugin.id === selectedPluginId.value)) {
      selectedPluginId.value = result.value.plugins[0]?.id ?? ''
    }
    await refreshNotifications()
  } catch {
    setError('plugin_service_unavailable')
  } finally {
    loading.value = false
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

function commandTitle(command: { title: { 'zh-TW': string; 'en-US': string } }): string {
  return command.title[locale.value]
}

async function invokePluginCommand(commandId: string): Promise<void> {
  const plugin = selectedPlugin.value
  if (!plugin || invokingCommandId.value) return
  invokingCommandId.value = commandId
  errorMessage.value = ''
  statusMessage.value = ''
  try {
    const result = await window.electronAPI?.invokePluginCommand(plugin.id, commandId)
    if (!result?.ok) {
      setError(result && !result.ok ? result.error : 'plugin_service_unavailable')
      return
    }
    statusMessage.value = t('pluginCommandSent')
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

function updateSetting(key: string, type: string, raw: string | boolean): void {
  const value = type === 'boolean' ? Boolean(raw) : type === 'number' ? Number(raw) : String(raw)
  settingsDraft.value = { ...settingsDraft.value, [key]: value as PluginSettingScalar }
}

async function savePluginSettings(): Promise<void> {
  const pluginId = selectedPluginId.value
  if (!pluginId || busy.value) return
  busy.value = true
  errorMessage.value = ''
  statusMessage.value = ''
  try {
    const result = await window.electronAPI?.setPluginSettings(pluginId, settingsDraft.value)
    if (!result?.ok) {
      if (result && !result.ok) setError(result.error)
      return
    }
    settingsDraft.value = { ...result.value }
    if (pluginSettings.value) pluginSettings.value.values = { ...result.value }
    statusMessage.value = t('pluginSettingsSaved')
  } catch {
    setError('plugin_action_failed')
  } finally {
    busy.value = false
  }
}

async function savePluginSecret(key: string): Promise<void> {
  const pluginId = selectedPluginId.value
  if (!pluginId || busy.value) return
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
  busy.value = true
  errorMessage.value = ''
  statusMessage.value = ''
  try {
    const result = await window.electronAPI?.setPluginSecret(pluginId, key, secretDrafts.value[key] ?? '')
    if (!result?.ok) {
      if (result && !result.ok) setError(result.error)
      return
    }
    if (pluginSettings.value) pluginSettings.value.secrets[key] = result.value.configured
    secretDrafts.value = { ...secretDrafts.value, [key]: '' }
    statusMessage.value = result.value.configured ? t('pluginSecretSaved') : t('pluginSettingsSaved')
  } catch {
    setError('plugin_action_failed')
  } finally {
    busy.value = false
  }
}

async function confirmSecretConsent(): Promise<void> {
  const key = pendingSecretConsentKey.value
  if (!key || busy.value) return
  busy.value = true
  errorMessage.value = ''
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
    busy.value = false
  }
  if (!pendingSecretConsentKey.value) await savePluginSecret(key)
}

async function updateGlobalPreferences(patch: PluginGlobalPreferencesPatch): Promise<void> {
  if (busy.value) return
  const previousCatalogUrl = snapshot.value?.preferences.catalogUrl
  busy.value = true
  errorMessage.value = ''
  statusMessage.value = ''
  try {
    const result = await window.electronAPI?.setPluginGlobalPreferences(patch)
    if (!result?.ok) {
      if (result && !result.ok) setError(result.error)
      return
    }
    if (snapshot.value) snapshot.value.preferences = result.value
    if (patch.onlineCatalogEnabled === false
      || (patch.catalogUrl !== undefined && patch.catalogUrl !== previousCatalogUrl)) {
      catalogItems.value = []
      catalogCheckComplete.value = false
    }
    await refreshPanel()
  } catch {
    setError('plugin_action_failed')
  } finally {
    busy.value = false
  }
}

async function saveCatalogUrl(): Promise<void> {
  const previousUrl = snapshot.value?.preferences.catalogUrl ?? ''
  await updateGlobalPreferences({ catalogUrl: catalogUrlDraft.value })
  if (previousUrl !== snapshot.value?.preferences.catalogUrl) {
    catalogItems.value = []
    catalogCheckComplete.value = false
  }
}

async function loadPluginCatalog(): Promise<void> {
  if (busy.value || !onlineCatalogEnabled.value) return
  busy.value = true
  errorMessage.value = ''
  statusMessage.value = ''
  try {
    const result = await window.electronAPI?.listPluginCatalog()
    if (!result?.ok) {
      if (result && !result.ok) setError(result.error)
      return
    }
    catalogItems.value = result.value
    catalogCheckComplete.value = true
    statusMessage.value = t('pluginCatalogChecked', {
      entries: String(result.value.length),
      updates: String(result.value.filter(item => item.updateAvailable).length),
    })
  } catch {
    setError('catalog_unavailable')
  } finally {
    busy.value = false
  }
}

async function installCatalogPlugin(item: PluginCatalogPanelItem): Promise<void> {
  if (busy.value) return
  busy.value = true
  errorMessage.value = ''
  statusMessage.value = ''
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
    busy.value = false
  }
}

async function reportPluginIssue(pluginId: string): Promise<void> {
  if (busy.value) return
  busy.value = true
  errorMessage.value = ''
  statusMessage.value = ''
  try {
    const result = await window.electronAPI?.reportInstalledPluginIssue(pluginId)
    if (!result?.ok) {
      if (result && !result.ok) setError(result.error)
      return
    }
    statusMessage.value = t('pluginReportOpened')
  } catch {
    setError('plugin_action_failed')
  } finally {
    busy.value = false
  }
}

function updateResourceLimit(key: keyof PluginResourceLimits, raw: string): void {
  const field = resourceFields.find(item => item.key === key)
  const parsed = Number(raw)
  const value = key === 'netMaxResponseBytes' || key === 'storageBytesPerPlugin' ? parsed * 1024 : parsed
  if (!field || !Number.isSafeInteger(value) || value < field.min || value > field.max) {
    if (field) {
      errorMessage.value = t('pluginResourceRangeInvalid', { min: String(field.min), max: String(field.max) })
      statusMessage.value = ''
    }
    return
  }
  void updateGlobalPreferences({ resources: { [key]: value } })
}

function resourceInputValue(key: keyof PluginResourceLimits, value: number): string {
  return String(key === 'netMaxResponseBytes' || key === 'storageBytesPerPlugin' ? value / 1024 : value)
}

function resourceBoundText(key: keyof PluginResourceLimits, value: number): string {
  if (key === 'memoryMbPerPlugin') return `${value} MB`
  if (key === 'netMaxResponseBytes' || key === 'storageBytesPerPlugin') {
    const unit = value % (1024 * 1024) === 0 ? 'MB' : 'KB'
    return `${value / (unit === 'MB' ? 1024 * 1024 : 1024)} ${unit}`
  }
  if (key === 'netTimeoutSeconds' || key === 'scheduleMinIntervalSeconds') return `${value} s`
  if (key === 'netRequestsPerMinute') return `${value} / min`
  if (key === 'globalFeedPer10Min') return `${value} / 10 min`
  return String(value)
}

async function updatePluginPreference(
  pluginId: string,
  patch: Partial<Pick<PluginInstancePreferences, 'enabled' | 'muted' | 'rateLimitPer10Min' | 'targetPetId' | 'grantedHosts'>>,
): Promise<void> {
  if (busy.value) return
  busy.value = true
  errorMessage.value = ''
  statusMessage.value = ''
  try {
    const result = await window.electronAPI?.setPluginInstancePreferences(pluginId, patch)
    if (!result?.ok) {
      if (result && !result.ok) setError(result.error)
      return
    }
    if (snapshot.value) snapshot.value.preferences = result.value
    await refreshPanel()
  } catch {
    setError('plugin_action_failed')
  } finally {
    busy.value = false
  }
}

async function updatePluginRate(pluginId: string, raw: string): Promise<void> {
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1 || value > 30) {
    errorMessage.value = t('pluginPerPluginRateRange')
    statusMessage.value = ''
    return
  }
  await updatePluginPreference(pluginId, { rateLimitPer10Min: value })
}

async function updatePluginTarget(pluginId: string, targetPetId: string): Promise<void> {
  await updatePluginPreference(pluginId, { targetPetId: targetPetId || null })
}

async function revokeGrantedHost(plugin: PluginPanelPlugin, host: string): Promise<void> {
  await updatePluginPreference(plugin.id, {
    grantedHosts: plugin.preference.grantedHosts.filter(item => item !== host),
  })
}

async function selectArchive(): Promise<void> {
  if (busy.value) return
  busy.value = true
  errorMessage.value = ''
  statusMessage.value = ''
  pendingPlan.value = null
  try {
    const result = await window.electronAPI?.selectPluginArchive()
    if (!result?.ok) {
      if (result && !result.ok && !result.cancelled) setError(result.error)
      return
    }
    pendingPlan.value = result.value
    if (result.value.kind === 'incompatible') setError('incompatible')
  } catch {
    setError('plugin_action_failed')
  } finally {
    busy.value = false
  }
}

async function selectDeveloperFolder(): Promise<void> {
  if (busy.value) return
  busy.value = true
  errorMessage.value = ''
  statusMessage.value = ''
  pendingPlan.value = null
  try {
    const result = await window.electronAPI?.selectPluginFolder()
    if (!result?.ok) {
      if (result && !result.ok && !result.cancelled) setError(result.error)
      return
    }
    pendingPlan.value = result.value
    if (result.value.kind === 'incompatible') setError('incompatible')
  } catch {
    setError('plugin_action_failed')
  } finally {
    busy.value = false
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
  const separator = unit.indexOf(':')
  const kind = separator < 0 ? unit : unit.slice(0, separator)
  const detail = separator < 0 ? '' : unit.slice(separator + 1)
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
  return unit
}

const pendingPermissions = computed(() => {
  const plan = pendingPlan.value
  if (!plan) return []
  const permissionUnits: string[] = []
  for (const host of plan.permissions?.network?.hosts ?? []) permissionUnits.push(`network:${host}`)
  for (const host of plan.permissions?.links?.hosts ?? []) permissionUnits.push(`links:${host}`)
  if (plan.permissions?.storage) permissionUnits.push('storage')
  if (plan.permissions?.agentStatus) permissionUnits.push('agentStatus')
  if (plan.permissions?.schedule) permissionUnits.push('schedule')
  for (const secret of plan.permissions?.secrets ?? []) permissionUnits.push(`secrets:${secret}`)
  if (plan.contributes?.feed) permissionUnits.push('contributes:feed')
  if (plan.contributes?.reaction) permissionUnits.push('contributes:reaction')
  if (plan.contributes?.panelView) permissionUnits.push('contributes:panelView')
  if (plan.contributes?.commands?.length) permissionUnits.push('contributes:commands')
  if (plan.contributes?.tray?.commands.length) permissionUnits.push('contributes:tray')
  if (plan.contributes?.badge) permissionUnits.push('contributes:badge')
  if (plan.contributes?.skins?.length) permissionUnits.push(`contributes:skins:${plan.contributes.skins.length}`)
  if (plan.contributes?.eventSource) permissionUnits.push('contributes:eventSource')
  return permissionUnits.map(permissionLabel)
})

const pendingAddedPermissions = computed(() => (pendingPlan.value?.addedPermissions ?? []).map(permissionLabel))

async function confirmInstall(): Promise<void> {
  const plan = pendingPlan.value
  if (!plan || plan.kind === 'incompatible' || busy.value) return
  busy.value = true
  errorMessage.value = ''
  statusMessage.value = ''
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
    statusMessage.value = t('pluginInstallSucceeded', { name: pluginName(result.value) })
    await refreshPanel()
  } catch {
    setError('plugin_action_failed')
  } finally {
    busy.value = false
  }
}

function requestRemove(plugin: PluginPanelPlugin): void {
  pendingRemove.value = plugin
  keepData.value = false
}

async function confirmRemove(): Promise<void> {
  const plugin = pendingRemove.value
  if (!plugin || busy.value) return
  busy.value = true
  errorMessage.value = ''
  statusMessage.value = ''
  try {
    const result = await window.electronAPI?.removeInstalledPlugin(plugin.id, keepData.value)
    if (!result?.ok) {
      if (result && !result.ok) setError(result.error)
      return
    }
    pendingRemove.value = null
    statusMessage.value = t('pluginRemoveSucceeded')
    await refreshPanel()
  } catch {
    setError('plugin_action_failed')
  } finally {
    busy.value = false
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

async function clearNotifications(pluginId?: string): Promise<void> {
  try {
    const result = await window.electronAPI?.clearPluginNotifications(pluginId)
    if (!result?.ok) {
      if (result && !result.ok) setError(result.error)
      return
    }
    await refreshNotifications()
  } catch {
    setError('plugin_action_failed')
  }
}

function notificationSource(item: PluginNotificationRecord): string {
  return plugins.value.find(plugin => plugin.id === item.item.pluginId)?.manifest?.name[locale.value]
    ?? item.item.pluginName[locale.value]
}

function notificationTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(locale.value, { dateStyle: 'short', timeStyle: 'short' })
}

function diagnosticTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function diagnosticCodeLabel(item: PluginBrokerDiagnostic): string {
  if (item.code === 'host_unavailable') return t('pluginHostUnavailableTitle')
  if (item.code === 'too_many_enabled') {
    if (item.method === 'plugin.tray') return t('pluginTrayOverflowDiagnostic')
    return t('pluginTooManyEnabled', {
      limit: String(snapshot.value?.preferences.resources.maxEnabledPlugins ?? 10),
    })
  }
  return t('pluginDiagnosticRejected', { code: item.code, method: item.method ?? t('pluginDiagnosticUnknownMethod') })
}

watch(selectedPluginId, pluginId => {
  if (panelViewPluginId.value && panelViewPluginId.value !== pluginId) closePluginPanelView()
  void refreshDiagnostics(pluginId)
  void refreshPluginSettings(pluginId)
})

watch(panelViewPluginId, async pluginId => {
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

watch(() => props.requestedPluginId, pluginId => {
  if (!pluginId && panelViewPluginId.value) closePluginPanelView()
  else if (pluginId && plugins.value.some(plugin => plugin.id === pluginId)) void openPluginPanelView(pluginId)
})

onMounted(() => {
  void refreshPanel()
  void loadPetOptions()
  removePanelClosedListener = window.electronAPI?.onPluginPanelViewClosed(handlePluginPanelViewClosed) ?? null
  removeNotificationsListener = window.electronAPI?.onPluginNotificationsChanged(() => {
    void refreshNotifications()
  }) ?? null
})

onUnmounted(() => {
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
    logs,
    diagnostics,
    petOptions,
    pluginSettings,
    settingsDraft,
    secretDrafts,
    selectedPluginId,
    panelViewPluginId,
    panelViewOpenToken,
    panelViewFrame,
    panelViewContent,
    busy,
    invokingCommandId,
    loading,
    errorMessage,
    statusMessage,
    pendingPlan,
    pendingRemove,
    pendingSecretConsentKey,
    catalogItems,
    catalogCheckComplete,
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
    hasCompatiblePlan,
    pendingPluginName,
    resourceFields,
    failedPluginIconIds,
    pendingPermissions,
    pendingAddedPermissions,
    pluginName,
    pluginIconUrl,
    hidePluginIcon,
    restoreCatalogUrl,
    displayFingerprint,
    readPluginPanelViewBounds,
    sendPluginPanelViewBounds,
    openPluginPanelView,
    closePluginPanelView,
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
    confirmInstall,
    requestRemove,
    confirmRemove,
    markNotificationRead,
    openNotificationLink,
    clearNotifications,
    notificationSource,
    notificationTime,
    diagnosticTime,
    diagnosticCodeLabel
  }
}
