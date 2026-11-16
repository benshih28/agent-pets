// 插件偏好：全域偏好（串行佇列）、目錄網址、資源上限，以及單一插件的樂觀更新與主機授權撤銷。
//
// 契約：
// - 讀：snapshot（偏好來源，採用主行程回傳的結果就地合併）、enabledGlobally、plugins。
// - 寫：snapshot 的偏好欄位、catalogUrlDraft；全域偏好使變更目錄網址／關閉線上目錄時呼叫 resetCatalog。
// - 排序：全域偏好以 'global' 佇列、單一插件以 plugin:{id} 佇列依序送出，不會被「忙碌」丟棄。
import { ref, type ComputedRef, type Ref } from 'vue'
import { t, tPlural, type TranslationKey } from '@/i18n'
import type {
  PluginGlobalPreferencesPatch, PluginPanelPlugin, PluginPanelSnapshot, PluginResourceLimits,
} from '@/types/plugin'
import { DEFAULT_PLUGIN_CATALOG_URL } from '@/types/plugin-catalog'
import { resourceValueFromInput } from '@/utils/plugin-resource-limits'
import {
  applyPreferencePatch, mergePreferencesResult, rollbackPreferencePatch, type PluginPreferencePatch,
} from '@/composables/plugin/plugin-state-sync'
import { pluginScope, type PluginBusyScopes, type PluginPanelFeedback } from '@/composables/plugin/panel-deps'
import type { PluginNotifyInput } from '@/composables/plugin/usePluginNotify'

export interface PluginPreferencesDeps {
  snapshot: Ref<PluginPanelSnapshot | null>
  plugins: ComputedRef<PluginPanelPlugin[]>
  enabledGlobally: ComputedRef<boolean>
  busy: Pick<PluginBusyScopes, 'setBusy'>
  enqueueSerial: (scope: string, task: () => Promise<void>) => Promise<void>
  feedback: Pick<PluginPanelFeedback, 'setError'>
  notify(input: PluginNotifyInput): number
  resetCatalog(): void
  /** 控制器的 refreshPanel；以回呼傳入，避免與快照刷新互相依賴。 */
  refreshPanel(options?: { silent?: boolean }): Promise<void>
}

const RESOURCE_FIELDS: ReadonlyArray<{
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
const RESOURCE_FIELD_BY_KEY = new Map(RESOURCE_FIELDS.map(field => [field.key, field]))

export function usePluginPreferences(deps: PluginPreferencesDeps) {
  const { snapshot, plugins, enabledGlobally, enqueueSerial, notify, resetCatalog, refreshPanel } = deps
  const { setBusy } = deps.busy
  const { setError } = deps.feedback

  const catalogUrlDraft = ref('')
  // 對外維持可變陣列型別（控制器契約），內容固定。
  const resourceFields = RESOURCE_FIELDS as Array<(typeof RESOURCE_FIELDS)[number]>

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
          notify({
            tone: 'success',
            text: tPlural('plugins.globalStopped', stoppedCount),
            durationMs: 6000,
            action: { label: t('plugins.undo'), run: () => void updateGlobalPreferences({ pluginsEnabled: true }) },
          })
        }
        if (patch.onlineCatalogEnabled === false
          || (patch.catalogUrl !== undefined && patch.catalogUrl !== previousCatalogUrl)) {
          resetCatalog()
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
    if (previousUrl !== snapshot.value?.preferences.catalogUrl) resetCatalog()
  }

  async function restoreCatalogUrl(): Promise<void> {
    catalogUrlDraft.value = DEFAULT_PLUGIN_CATALOG_URL
    await saveCatalogUrl()
  }

  function updateResourceLimit(key: keyof PluginResourceLimits, raw: string): void {
    const field = RESOURCE_FIELD_BY_KEY.get(key)
    const value = resourceValueFromInput(key, Number(raw))
    if (!field || !Number.isSafeInteger(value) || value < field.min || value > field.max) {
      if (field) {
        notify({ tone: 'error', text: t('pluginResourceRangeInvalid', { min: String(field.min), max: String(field.max) }) })
      }
      return
    }
    void updateGlobalPreferences({ resources: { [key]: value } })
  }

  // 單一插件的偏好採樂觀更新：先改畫面，失敗再回滾該欄位並顯示錯誤；同一插件的變更依序送出。
  async function updatePluginPreference(pluginId: string, patch: PluginPreferencePatch): Promise<void> {
    const current = snapshot.value
    if (!current) return
    const previous = applyPreferencePatch(current, pluginId, patch)
    const scope = pluginScope(pluginId)
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
      notify({ tone: 'error', text: t('pluginPerPluginRateRange') })
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
    notify({
      tone: 'success',
      text: t('plugins.hostRevoked', { host }),
      durationMs: 5000,
      action: { label: t('plugins.undo'), run: () => void updatePluginPreference(plugin.id, { grantedHosts: previous }) },
    })
  }

  // 安裝成功 Toast 的「立即啟用」：全域關閉時一併開啟全域開關。
  async function enableInstalledPlugin(pluginId: string): Promise<void> {
    if (!enabledGlobally.value) await updateGlobalPreferences({ pluginsEnabled: true })
    await updatePluginPreference(pluginId, { enabled: true })
  }

  return {
    catalogUrlDraft,
    resourceFields,
    updateGlobalPreferences,
    saveCatalogUrl,
    restoreCatalogUrl,
    updateResourceLimit,
    updatePluginPreference,
    updatePluginRate,
    updatePluginTarget,
    revokeGrantedHost,
    enableInstalledPlugin,
  }
}
