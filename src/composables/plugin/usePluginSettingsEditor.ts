// Secret 值只存在 secretDrafts，儲存成功後立即清空，不進 log、toast 或其他 state。
import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { locale, t } from '@/i18n'
import type { PluginLocalizedText, PluginPanelPlugin, PluginPanelSettingsSnapshot, PluginSettingScalar } from '@/types/plugin'
import {
  defaultSettingsDraft, isSettingsDirty, validateSettings, type SettingErrorCode,
} from '@/utils/plugin-settings-form'
import {
  createLatestRequest, pluginScope, type PluginBusyScopes, type PluginPanelFeedback,
} from '@/composables/plugin/panel-deps'

export interface PluginSettingsEditorDeps {
  selectedPluginId: Readonly<Ref<string>>
  selectedPlugin: ComputedRef<PluginPanelPlugin | null>
  pluginById(pluginId: string): PluginPanelPlugin | null
  busy: Pick<PluginBusyScopes, 'isBusy' | 'setBusy'>
  feedback: Pick<PluginPanelFeedback, 'setError' | 'setStatus'>
}

export function usePluginSettingsEditor(deps: PluginSettingsEditorDeps) {
  const { selectedPluginId, selectedPlugin, pluginById } = deps
  const { isBusy, setBusy } = deps.busy
  const { setError, setStatus } = deps.feedback

  const pluginSettings = ref<PluginPanelSettingsSnapshot | null>(null)
  const settingsDraft = ref<Record<string, PluginSettingScalar>>({})
  const secretDrafts = ref<Record<string, string>>({})
  const settingsErrors = ref<Record<string, SettingErrorCode>>({})
  const pendingLeave = ref<(() => void) | null>(null)
  const pendingSecretRemoveKey = ref('')
  const pendingSecretConsentKey = ref('')
  const settingsLoad = createLatestRequest()

  const settingsProperties = computed(() => selectedPlugin.value?.manifest?.contributes.settings?.properties ?? {})
  const settingsDirty = computed(() => isSettingsDirty(
    settingsProperties.value, pluginSettings.value?.values ?? {}, settingsDraft.value, secretDrafts.value,
  ))

  function emptySecretDrafts(secrets: Record<string, boolean>): Record<string, string> {
    return Object.fromEntries(Object.keys(secrets).map(key => [key, '']))
  }

  function guardUnsavedSettings(action: () => void): void {
    if (settingsDirty.value) pendingLeave.value = action
    else action()
  }

  function confirmDiscardSettings(): void {
    const action = pendingLeave.value
    pendingLeave.value = null
    resetSettingsDraft()
    action?.()
  }

  function resetSettingsDraft(): void {
    settingsDraft.value = { ...(pluginSettings.value?.values ?? {}) }
    secretDrafts.value = emptySecretDrafts(pluginSettings.value?.secrets ?? {})
    settingsErrors.value = {}
  }

  function resetSettingsToDefaults(): void {
    settingsDraft.value = defaultSettingsDraft(settingsProperties.value)
    settingsErrors.value = {}
  }

  async function refreshPluginSettings(pluginId = selectedPluginId.value): Promise<void> {
    const request = settingsLoad.next()
    pluginSettings.value = null
    settingsDraft.value = {}
    secretDrafts.value = {}
    settingsErrors.value = {}
    if (!pluginById(pluginId)?.manifest?.contributes.settings) return
    try {
      const result = await window.electronAPI?.getPluginSettings(pluginId)
      if (!settingsLoad.isCurrent(request)) return
      if (!result?.ok) {
        if (result && !result.ok) setError(result.error)
        return
      }
      pluginSettings.value = result.value
      settingsDraft.value = { ...result.value.values }
      secretDrafts.value = emptySecretDrafts(result.value.secrets)
    } catch {
      if (settingsLoad.isCurrent(request)) setError('plugin_action_failed')
    }
  }

  function settingTitle(title: string | PluginLocalizedText | undefined, fallback: string): string {
    if (typeof title === 'string') return title
    return title?.[locale.value] ?? fallback
  }

  function settingValue(key: string, definition: { default?: PluginSettingScalar }): string {
    return String(settingsDraft.value[key] ?? definition.default ?? '')
  }

  function updateSetting(key: string, type: string, raw: string | boolean | number): void {
    const value: PluginSettingScalar = type === 'boolean' ? Boolean(raw) : type === 'number' ? Number(raw) : String(raw)
    settingsDraft.value = { ...settingsDraft.value, [key]: value }
    if (Object.hasOwn(settingsErrors.value, key)) {
      const { [key]: _removed, ...rest } = settingsErrors.value
      settingsErrors.value = rest
    }
  }

  async function savePluginSettings(): Promise<void> {
    const pluginId = selectedPluginId.value
    const scope = pluginScope(pluginId)
    if (!pluginId || isBusy(scope)) return
    settingsErrors.value = validateSettings(settingsProperties.value, settingsDraft.value)
    if (Object.keys(settingsErrors.value).length > 0) return
    const loaded = settingsLoad.current()
    setBusy(scope, true)
    try {
      // reactive Proxy 無法 structured clone，需淺拷貝成純物件。
      const result = await window.electronAPI?.setPluginSettings(pluginId, { ...settingsDraft.value })
      if (!result?.ok) {
        if (result && !result.ok) setError(result.error)
        return
      }
      // 儲存期間換了插件：結果屬於原本的插件，不寫進現在的表單。
      if (settingsLoad.isCurrent(loaded)) {
        settingsDraft.value = { ...result.value }
        if (pluginSettings.value) pluginSettings.value.values = { ...result.value }
      }
      setStatus(t('pluginSettingsSaved'))
    } catch {
      setError('plugin_action_failed')
    } finally {
      setBusy(scope, false)
    }
  }

  function applySecretResult(loaded: number, key: string, configured: boolean): void {
    if (!settingsLoad.isCurrent(loaded)) return
    if (pluginSettings.value) pluginSettings.value.secrets[key] = configured
    secretDrafts.value = { ...secretDrafts.value, [key]: '' }
  }

  async function savePluginSecret(key: string): Promise<void> {
    const pluginId = selectedPluginId.value
    const scope = pluginScope(pluginId)
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
    const loaded = settingsLoad.current()
    setBusy(scope, true)
    try {
      const result = await window.electronAPI?.setPluginSecret(pluginId, key, secretDrafts.value[key] ?? '')
      if (!result?.ok) {
        if (result && !result.ok) setError(result.error)
        return
      }
      applySecretResult(loaded, key, result.value.configured)
      setStatus(result.value.configured ? t('pluginSecretSaved') : t('pluginSettingsSaved'))
    } catch {
      setError('plugin_action_failed')
    } finally {
      setBusy(scope, false)
    }
  }

  async function removePluginSecret(key: string): Promise<void> {
    const pluginId = selectedPluginId.value
    const scope = pluginScope(pluginId)
    pendingSecretRemoveKey.value = ''
    if (!pluginId || isBusy(scope)) return
    const loaded = settingsLoad.current()
    setBusy(scope, true)
    try {
      const result = await window.electronAPI?.setPluginSecret(pluginId, key, '')
      if (!result?.ok) {
        setError(result && !result.ok ? result.error : 'plugin_service_unavailable')
        return
      }
      applySecretResult(loaded, key, result.value.configured)
      setStatus(t('plugins.secretRemoved'))
    } catch {
      setError('plugin_action_failed')
    } finally {
      setBusy(scope, false)
    }
  }

  async function confirmSecretConsent(): Promise<void> {
    const key = pendingSecretConsentKey.value
    const scope = pluginScope(selectedPluginId.value)
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
    // 草稿已被清空時不能繼續：空值送出等同移除既有的密鑰。
    if (!pendingSecretConsentKey.value && (secretDrafts.value[key] ?? '').length > 0) await savePluginSecret(key)
  }

  return {
    pluginSettings,
    settingsDraft,
    secretDrafts,
    settingsErrors,
    settingsDirty,
    pendingLeave,
    pendingSecretRemoveKey,
    pendingSecretConsentKey,
    guardUnsavedSettings,
    confirmDiscardSettings,
    resetSettingsDraft,
    resetSettingsToDefaults,
    refreshPluginSettings,
    settingTitle,
    settingValue,
    updateSetting,
    savePluginSettings,
    savePluginSecret,
    removePluginSecret,
    confirmSecretConsent,
  }
}
