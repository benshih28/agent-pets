import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { PluginBrokerContext } from '../plugin-broker.ts'
import type { PluginSecretConsentStore } from '../plugin-secret-consent.ts'
import type { PluginSecretsStore } from '../plugin-secrets.ts'
import { publishPluginSettingsChanged, type PluginSettingsStore } from '../plugin-settings.ts'
import type { PluginPanelSettingsSnapshot, PluginSettingScalar } from '../../src/types/plugin.ts'
import { handleWithSenderGuard } from './trusted.ts'
import { IPC_CHANNELS } from './channels.ts'

export interface PluginSettingsIpcDependencies {
  ipcMain: Pick<IpcMain, 'handle'>
  assertPluginPanelSender(event: IpcMainInvokeEvent): void
  isPluginPanelPluginId(value: unknown): value is string
  getPluginContext(pluginId: string): PluginBrokerContext | null
  getSettingsStore(): PluginSettingsStore | null
  getSecretsStore(): PluginSecretsStore | null
  getSecretConsentStore(): PluginSecretConsentStore | null
  notifySettingsChanged(pluginId: string, values: Record<string, PluginSettingScalar>): void
  pluginPanelError(error: unknown): string
}

function isUnsafePluginDataError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'plugin_data_unsafe')
}

export function registerPluginSettingsIpc(deps: PluginSettingsIpcDependencies): void {
  handleWithSenderGuard(deps.ipcMain, IPC_CHANNELS.pluginSettingsGet, deps.assertPluginPanelSender, (_event, pluginId: unknown) => {
    if (!deps.isPluginPanelPluginId(pluginId)) return { ok: false, error: 'invalid_request' }
    const context = deps.getPluginContext(pluginId)
    const settingsStore = deps.getSettingsStore()
    const secretsStore = deps.getSecretsStore()
    if (!context || !settingsStore || !secretsStore) return { ok: false, error: 'plugin_not_found' }
    if (!context.manifest.contributes.settings) return { ok: false, error: 'not_permitted' }
    try {
      const value: PluginPanelSettingsSnapshot = {
        values: settingsStore.get(pluginId, context.manifest),
        secrets: secretsStore.listConfigured(pluginId, context.manifest.permissions.secrets ?? []),
      }
      return { ok: true, value }
    } catch (error) {
      return { ok: false, error: isUnsafePluginDataError(error) ? 'settings_invalid' : deps.pluginPanelError(error) }
    }
  })
  handleWithSenderGuard(deps.ipcMain, IPC_CHANNELS.pluginSettingsSet, deps.assertPluginPanelSender, (_event, pluginId: unknown, value: unknown) => {
    if (!deps.isPluginPanelPluginId(pluginId)) return { ok: false, error: 'invalid_request' }
    const context = deps.getPluginContext(pluginId)
    const settingsStore = deps.getSettingsStore()
    if (!context || !settingsStore) return { ok: false, error: 'plugin_not_found' }
    if (!context.manifest.contributes.settings) return { ok: false, error: 'not_permitted' }
    try {
      const values = settingsStore.set(pluginId, context.manifest, value)
      publishPluginSettingsChanged(pluginId, context.manifest, settingsStore, deps.notifySettingsChanged)
      return { ok: true, value: values }
    } catch (error) {
      return { ok: false, error: isUnsafePluginDataError(error) ? 'settings_invalid' : deps.pluginPanelError(error) }
    }
  })
  handleWithSenderGuard(deps.ipcMain, IPC_CHANNELS.pluginSecretConsentGet, deps.assertPluginPanelSender, () => {
    const consentStore = deps.getSecretConsentStore()
    if (!consentStore) return { ok: false, error: 'plugin_service_unavailable' }
    return { ok: true, value: consentStore.hasAccepted() }
  })
  handleWithSenderGuard(deps.ipcMain, IPC_CHANNELS.pluginSecretConsentAccept, deps.assertPluginPanelSender, () => {
    const consentStore = deps.getSecretConsentStore()
    if (!consentStore) return { ok: false, error: 'plugin_service_unavailable' }
    try {
      consentStore.accept()
      return { ok: true, value: true }
    } catch {
      return { ok: false, error: 'plugin_action_failed' }
    }
  })
  handleWithSenderGuard(deps.ipcMain, IPC_CHANNELS.pluginSecretSet, deps.assertPluginPanelSender, (_event, pluginId: unknown, key: unknown, value: unknown) => {
    if (!deps.isPluginPanelPluginId(pluginId) || typeof key !== 'string' || typeof value !== 'string') {
      return { ok: false, error: 'invalid_request' }
    }
    const context = deps.getPluginContext(pluginId)
    const secretsStore = deps.getSecretsStore()
    if (!context || !secretsStore) return { ok: false, error: 'plugin_not_found' }
    const definition = context.manifest.contributes.settings?.properties[key]
    const declared = context.manifest.permissions.secrets ?? []
    if (!definition || definition.format !== 'secret' || !declared.includes(key)) return { ok: false, error: 'not_permitted' }
    if (value.length > (definition.maxLength ?? 4_096)) return { ok: false, error: 'settings_invalid' }
    if (value.length > 0 && deps.getSecretConsentStore()?.hasAccepted() !== true) {
      return { ok: false, error: 'secret_consent_required' }
    }
    try {
      secretsStore.set(pluginId, key, value, declared)
      try {
        const settingsStore = deps.getSettingsStore()
        if (settingsStore) {
          publishPluginSettingsChanged(pluginId, context.manifest, settingsStore, deps.notifySettingsChanged)
        }
      } catch {}
      return { ok: true, value: { configured: secretsStore.has(pluginId, key) } }
    } catch (error) {
      return { ok: false, error: isUnsafePluginDataError(error) ? 'secret_unavailable' : deps.pluginPanelError(error) }
    }
  })
}
