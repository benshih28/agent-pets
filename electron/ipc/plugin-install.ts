import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import type { PluginPanelResult, PluginPanelSnapshot } from '../../src/types/plugin.ts'
import type { PluginBroker } from '../plugin-broker.ts'
import type { PluginDeveloperModeWatcher } from '../plugin-developer-mode.ts'
import type { PluginFeedController } from '../plugin-feed.ts'
import type { PluginHostGrantController } from '../plugin-host-grants.ts'
import type { PluginPreferencesStore } from '../plugin-preferences.ts'
import type { PluginRegistry } from '../plugin-registry.ts'
import type { PluginSecretsStore } from '../plugin-secrets.ts'
import { PLUGIN_ARCHIVE_SKIN_MAX_BYTES } from '../plugin-registry.ts'
import { isPluginPanelInstallConfirmation, isPluginPanelPluginId } from '../plugin-panel-validation.ts'
import { rememberPluginPlan } from './plugin-catalog.ts'
import { handleWithSenderGuard } from './trusted.ts'
import { IPC_CHANNELS } from './channels.ts'

type DialogOptions = {
  title: string
  filters?: Array<{ name: string; extensions: string[] }>
  properties: Array<'openFile' | 'openDirectory'>
}
type FilePickerResult = { canceled: boolean; filePaths: string[] }
type InstallFileSystem = Pick<typeof import('node:fs/promises'), 'lstat' | 'readFile'>

export interface PluginInstallIpcDependencies {
  ipcMain: Pick<IpcMain, 'handle'>
  assertPluginPanelSender(event: IpcMainInvokeEvent): void
  getRegistry(): PluginRegistry | null
  getPreferencesStore(): PluginPreferencesStore | null
  getPanelWindow(): BrowserWindow | null
  isDialogOpen(): boolean
  setDialogOpen(value: boolean): void
  showOpenDialog(window: BrowserWindow, options: DialogOptions): Promise<FilePickerResult>
  translate(key: 'pluginNativePickerTitle' | 'pluginDeveloperFolderPickerTitle'): string
  fs: InstallFileSystem
  maxArchiveBytes: number
  pendingPlanIds: Map<string, string>
  pendingDeveloperFolders: Map<string, string>
  developerSourceFolders: Map<string, string>
  getDeveloperModeWatcher(): PluginDeveloperModeWatcher | null
  getSecretsStore(): PluginSecretsStore | null
  getPluginBroker(): PluginBroker | null
  getPluginHostGrantController(): PluginHostGrantController | null
  getPluginFeedController(): PluginFeedController | null
  isInstallConfirmation(token: unknown, acceptAdditionalPermissions: unknown, acceptSignatureChange: unknown): token is string
  isPluginPanelPluginId(value: unknown): value is string
  pluginPanelError(error: unknown): string
  syncPluginHost(): void | Promise<void>
  pluginPanelSnapshot(): PluginPanelResult<PluginPanelSnapshot> | Promise<PluginPanelResult<PluginPanelSnapshot>>
}

export function registerPluginInstallIpc(deps: PluginInstallIpcDependencies): void {
  handleWithSenderGuard(deps.ipcMain, IPC_CHANNELS.pluginInstallSelect, deps.assertPluginPanelSender, async () => {
    const registry = deps.getRegistry()
    const panelWindow = deps.getPanelWindow()
    if (!registry || !panelWindow || panelWindow.isDestroyed()) {
      return { ok: false, error: 'plugin_service_unavailable' }
    }
    if (deps.isDialogOpen()) return { ok: false, error: 'dialog_unavailable' }
    deps.setDialogOpen(true)
    let selection: FilePickerResult
    try {
      selection = await deps.showOpenDialog(panelWindow, {
        title: deps.translate('pluginNativePickerTitle'),
        filters: [{ name: 'Agent Pets Plugins', extensions: ['agentpet-plugin'] }],
        properties: ['openFile'],
      })
    } catch {
      return { ok: false, error: 'plugin_action_failed' }
    } finally {
      deps.setDialogOpen(false)
    }
    if (selection.canceled || selection.filePaths.length === 0) {
      return { ok: false, error: 'cancelled', cancelled: true }
    }
    try {
      const archivePath = selection.filePaths[0]
      if (!archivePath) return { ok: false, error: 'invalid_archive' }
      const stat = await deps.fs.lstat(archivePath)
      if (!stat.isFile() || stat.isSymbolicLink()) return { ok: false, error: 'invalid_archive' }
      if (stat.size > deps.maxArchiveBytes) return { ok: false, error: 'archive_too_large' }
      const archive = await deps.fs.readFile(archivePath)
      if (archive.length > deps.maxArchiveBytes) return { ok: false, error: 'archive_too_large' }
      const planned = registry.planInstall(archive)
      if (!planned.ok) return { ok: false, error: planned.error }
      if (planned.value.pluginId && planned.value.kind !== 'incompatible') {
        rememberPluginPlan(deps.pendingPlanIds, deps.pendingDeveloperFolders, planned.value.token, planned.value.pluginId)
      }
      return { ok: true, value: planned.value }
    } catch {
      return { ok: false, error: 'invalid_archive' }
    }
  })

  handleWithSenderGuard(deps.ipcMain, IPC_CHANNELS.pluginInstallSelectFolder, deps.assertPluginPanelSender, async () => {
    const registry = deps.getRegistry()
    const preferences = deps.getPreferencesStore()
    const panelWindow = deps.getPanelWindow()
    if (!registry || !preferences || !panelWindow || panelWindow.isDestroyed()) {
      return { ok: false, error: 'plugin_service_unavailable' }
    }
    if (preferences.get().developerMode !== true) return { ok: false, error: 'not_permitted' }
    if (deps.isDialogOpen()) return { ok: false, error: 'dialog_unavailable' }
    deps.setDialogOpen(true)
    let selection: FilePickerResult
    try {
      selection = await deps.showOpenDialog(panelWindow, {
        title: deps.translate('pluginDeveloperFolderPickerTitle'),
        properties: ['openDirectory'],
      })
    } catch {
      return { ok: false, error: 'plugin_action_failed' }
    } finally {
      deps.setDialogOpen(false)
    }
    if (selection.canceled || selection.filePaths.length === 0) {
      return { ok: false, error: 'cancelled', cancelled: true }
    }
    try {
      const sourceFolder = selection.filePaths[0]
      if (!sourceFolder) return { ok: false, error: 'invalid_archive' }
      const planned = await registry.planInstallDirectory(sourceFolder)
      if (!planned.ok) return { ok: false, error: planned.error }
      if (planned.value.pluginId && planned.value.kind !== 'incompatible') {
        rememberPluginPlan(deps.pendingPlanIds, deps.pendingDeveloperFolders, planned.value.token, planned.value.pluginId)
        deps.pendingDeveloperFolders.set(planned.value.token, sourceFolder)
      }
      return { ok: true, value: planned.value }
    } catch {
      return { ok: false, error: 'invalid_archive' }
    }
  })

  handleWithSenderGuard(deps.ipcMain, IPC_CHANNELS.pluginInstallConfirm, deps.assertPluginPanelSender, async (_event, token: unknown, acceptAdditionalPermissions: unknown, acceptSignatureChange: unknown) => {
    const registry = deps.getRegistry()
    const preferences = deps.getPreferencesStore()
    if (!registry || !preferences) return { ok: false, error: 'plugin_service_unavailable' }
    if (!deps.isInstallConfirmation(token, acceptAdditionalPermissions, acceptSignatureChange)
      || typeof acceptAdditionalPermissions !== 'boolean' || typeof acceptSignatureChange !== 'boolean') {
      return { ok: false, error: 'invalid_request' }
    }
    const pluginId = deps.pendingPlanIds.get(token)
    const developerFolder = deps.pendingDeveloperFolders.get(token)
    if (!pluginId) return { ok: false, error: 'plan_not_found' }
    try {
      preferences.updatePlugin(pluginId, {})
    } catch (error) {
      return { ok: false, error: deps.pluginPanelError(error) }
    }
    const installed = registry.install(token, acceptAdditionalPermissions, acceptSignatureChange)
    if (!installed.ok) return { ok: false, error: installed.error }
    deps.pendingPlanIds.delete(token)
    deps.pendingDeveloperFolders.delete(token)
    if (developerFolder) deps.developerSourceFolders.set(pluginId, developerFolder)
    else {
      deps.developerSourceFolders.delete(pluginId)
      deps.getDeveloperModeWatcher()?.unwatch(pluginId)
    }
    await deps.syncPluginHost()
    const snapshot = await deps.pluginPanelSnapshot()
    if (!snapshot.ok) return snapshot
    const plugin = snapshot.value.plugins.find(item => item.id === pluginId)
    return plugin ? { ok: true, value: plugin } : { ok: false, error: 'plugin_action_failed' }
  })

  handleWithSenderGuard(deps.ipcMain, IPC_CHANNELS.pluginRemove, deps.assertPluginPanelSender, async (_event, pluginId: unknown, keepData: unknown) => {
    const registry = deps.getRegistry()
    const preferences = deps.getPreferencesStore()
    if (!registry || !preferences) return { ok: false, error: 'plugin_service_unavailable' }
    if (!deps.isPluginPanelPluginId(pluginId) || typeof keepData !== 'boolean') return { ok: false, error: 'invalid_request' }
    if (!registry.list().some(entry => entry.id === pluginId)) return { ok: false, error: 'plugin_not_found' }
    try { deps.getSecretsStore()?.remove(pluginId) } catch (error) {
      return { ok: false, error: deps.pluginPanelError(error) }
    }
    if (!keepData) {
      try { preferences.updatePlugin(pluginId, {}) } catch (error) {
        return { ok: false, error: deps.pluginPanelError(error) }
      }
    }
    const removed = registry.remove(pluginId, keepData)
    if (!removed.ok) return { ok: false, error: removed.error }
    deps.developerSourceFolders.delete(pluginId)
    deps.getDeveloperModeWatcher()?.unwatch(pluginId)
    deps.getPluginBroker()?.removePlugin(pluginId, keepData)
    deps.getPluginHostGrantController()?.clearPlugin(pluginId)
    if (!keepData) {
      try { preferences.removePlugin(pluginId) } catch (error) {
        return { ok: false, error: deps.pluginPanelError(error) }
      }
      deps.getPluginFeedController()?.clear(pluginId)
    }
    await deps.syncPluginHost()
    return { ok: true, value: removed.value }
  })

  handleWithSenderGuard(deps.ipcMain, IPC_CHANNELS.pluginDiagnostics, deps.assertPluginPanelSender, (_event, pluginId: unknown) => {
    const registry = deps.getRegistry()
    if (!deps.isPluginPanelPluginId(pluginId) || !registry?.list().some(entry => entry.id === pluginId)) {
      return { ok: false, error: 'invalid_request' }
    }
    return {
      ok: true,
      value: {
        logs: deps.getPluginBroker()?.listLogs(pluginId) ?? [],
        diagnostics: deps.getPluginBroker()?.listDiagnostics(pluginId) ?? [],
      },
    }
  })
}

export const pluginInstallMaxArchiveBytes = PLUGIN_ARCHIVE_SKIN_MAX_BYTES
export const isPluginInstallConfirmation = isPluginPanelInstallConfirmation
export const isPluginIdForInstall = isPluginPanelPluginId
