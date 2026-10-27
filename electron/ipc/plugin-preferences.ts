import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { canEnablePluginWithinLimit } from '../plugin-host-selection.ts'
import type { PluginPreferencesStore } from '../plugin-preferences.ts'
import type { PluginRegistry } from '../plugin-registry.ts'
import { handleWithSenderGuard } from './trusted.ts'
import { IPC_CHANNELS } from './channels.ts'

export interface PluginPreferencesIpcDependencies {
  ipcMain: Pick<IpcMain, 'handle'>
  assertPluginPanelSender(event: IpcMainInvokeEvent): void
  isPluginPanelPluginId(value: unknown): value is string
  isPluginPanelPreferencePatch(value: unknown): value is Record<string, unknown>
  getPreferencesStore(): PluginPreferencesStore | null
  getRegistry(): PluginRegistry | null
  enabledPluginContext(pluginId: string): boolean
  enabledPluginCount(): number
  maxEnabledPlugins(): number
  pluginEnableOrder: Map<string, number>
  nextPluginEnableOrder: { value: number }
  onCatalogPreferencesChanged(previous: ReturnType<PluginPreferencesStore['get']>, next: ReturnType<PluginPreferencesStore['get']>): void
  checkCatalogIfDue(): void
  syncPluginHost(): void | Promise<void>
  pluginPanelError(error: unknown): string
}

export function registerPluginPreferencesIpc(deps: PluginPreferencesIpcDependencies): void {
  handleWithSenderGuard(deps.ipcMain, IPC_CHANNELS.pluginPreferencesGlobalSet, deps.assertPluginPanelSender, async (_event, patch: unknown) => {
    const preferencesStore = deps.getPreferencesStore()
    if (!preferencesStore || !deps.isPluginPanelPreferencePatch(patch)) {
      return { ok: false, error: preferencesStore ? 'invalid_request' : 'plugin_service_unavailable' }
    }
    try {
      const previous = preferencesStore.get()
      const preferences = preferencesStore.updateGlobal(patch)
      deps.onCatalogPreferencesChanged(previous, preferences)
      await deps.syncPluginHost()
      if (preferences.dailyUpdateCheck) deps.checkCatalogIfDue()
      return { ok: true, value: preferences }
    } catch (error) {
      return { ok: false, error: deps.pluginPanelError(error) }
    }
  })

  handleWithSenderGuard(deps.ipcMain, IPC_CHANNELS.pluginPreferencesInstanceSet, deps.assertPluginPanelSender, async (_event, pluginId: unknown, patch: unknown) => {
    const registry = deps.getRegistry()
    const preferencesStore = deps.getPreferencesStore()
    if (!registry || !preferencesStore) return { ok: false, error: 'plugin_service_unavailable' }
    if (!deps.isPluginPanelPluginId(pluginId) || !deps.isPluginPanelPreferencePatch(patch)
      || !registry.list().some(entry => entry.id === pluginId)) {
      return { ok: false, error: 'invalid_request' }
    }
    try {
      if (patch.enabled === true && !deps.enabledPluginContext(pluginId)) {
        if (!canEnablePluginWithinLimit(false, deps.enabledPluginCount(), deps.maxEnabledPlugins())) {
          return { ok: false, error: 'too_many_enabled' }
        }
      }
      const preferences = preferencesStore.updatePlugin(pluginId, patch)
      if (typeof patch.enabled === 'boolean') {
        registry.setStatus(pluginId, patch.enabled ? 'enabled' : 'installed')
        if (patch.enabled) deps.pluginEnableOrder.set(pluginId, deps.nextPluginEnableOrder.value++)
        else deps.pluginEnableOrder.delete(pluginId)
      }
      await deps.syncPluginHost()
      return { ok: true, value: preferences }
    } catch (error) {
      return { ok: false, error: deps.pluginPanelError(error) }
    }
  })
}
