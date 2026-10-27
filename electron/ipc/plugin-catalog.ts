import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { PluginCatalogDocument, PluginCatalogPanelItem, PluginCatalogVersion } from '../../src/types/plugin-catalog.ts'
import type { PluginPreferencesStore } from '../plugin-preferences.ts'
import type { PluginRegistry } from '../plugin-registry.ts'
import { createPluginCatalogGateway } from '../plugin-catalog.ts'
import { buildPluginIssueReportUrl } from '../plugin-report.ts'
import { isPluginPanelPluginId } from '../plugin-panel-validation.ts'
import { handleWithSenderGuard } from './trusted.ts'
import { IPC_CHANNELS } from './channels.ts'

type CatalogGateway = ReturnType<typeof createPluginCatalogGateway>
type CatalogCache = { url: string; document: PluginCatalogDocument }

export interface PluginCatalogIpcDependencies {
  ipcMain: Pick<IpcMain, 'handle'>
  assertPluginPanelSender(event: IpcMainInvokeEvent): void
  getRegistry(): PluginRegistry | null
  getPreferencesStore(): PluginPreferencesStore | null
  getCatalogCache(): CatalogCache | null
  setCatalogCache(value: CatalogCache | null): void
  createCatalogGateway(): CatalogGateway
  buildCatalogItems(document: PluginCatalogDocument, installed: ReturnType<PluginRegistry['list']>): PluginCatalogPanelItem[]
  isPluginCatalogUrl(value: unknown): value is string
  selectLatestVersion(plugin: PluginCatalogDocument['plugins'][number], apiVersion: string): PluginCatalogVersion | null
  catalogFingerprintMatches(expected: unknown, actual: unknown): boolean
  pendingPlanIds: Map<string, string>
  pendingDeveloperFolders: Map<string, string>
  issueReportBaseUrl(): string
  openExternal(url: string): Promise<void>
}

export function rememberPluginPlan(
  pendingPlanIds: Map<string, string>,
  pendingDeveloperFolders: Map<string, string>,
  token: string,
  pluginId: string,
): void {
  while (pendingPlanIds.size >= 20) {
    const oldest = pendingPlanIds.keys().next().value as string | undefined
    if (oldest === undefined) break
    pendingPlanIds.delete(oldest)
    pendingDeveloperFolders.delete(oldest)
  }
  pendingPlanIds.set(token, pluginId)
}

export function registerPluginCatalogIpc(deps: PluginCatalogIpcDependencies): void {
  handleWithSenderGuard(deps.ipcMain, IPC_CHANNELS.pluginCatalogList, deps.assertPluginPanelSender, async () => {
    const registry = deps.getRegistry()
    const preferencesStore = deps.getPreferencesStore()
    if (!registry || !preferencesStore) return { ok: false, error: 'plugin_service_unavailable' }
    let preferences: ReturnType<PluginPreferencesStore['get']>
    try { preferences = preferencesStore.get() } catch { return { ok: false, error: 'preferences_unsafe' } }
    if (!preferences.onlineCatalogEnabled) return { ok: false, error: 'catalog_disabled' }
    if (!deps.isPluginCatalogUrl(preferences.catalogUrl)) return { ok: false, error: 'catalog_url_invalid' }
    const catalog = await deps.createCatalogGateway().load(preferences.catalogUrl)
    if (!catalog.ok) return { ok: false, error: catalog.error }
    deps.setCatalogCache({ url: preferences.catalogUrl, document: catalog.value })
    const items = deps.buildCatalogItems(catalog.value, registry.list())
    return { ok: true, value: items }
  })

  handleWithSenderGuard(deps.ipcMain, IPC_CHANNELS.pluginCatalogInstall, deps.assertPluginPanelSender, async (_event, pluginId: unknown, version: unknown) => {
    const registry = deps.getRegistry()
    const preferencesStore = deps.getPreferencesStore()
    if (!registry || !preferencesStore) return { ok: false, error: 'plugin_service_unavailable' }
    if (!isPluginPanelPluginId(pluginId) || typeof version !== 'string' || version.length > 100) {
      return { ok: false, error: 'invalid_request' }
    }
    let preferences: ReturnType<PluginPreferencesStore['get']>
    try { preferences = preferencesStore.get() } catch { return { ok: false, error: 'preferences_unsafe' } }
    if (!preferences.onlineCatalogEnabled) return { ok: false, error: 'catalog_disabled' }
    if (!deps.isPluginCatalogUrl(preferences.catalogUrl)) return { ok: false, error: 'catalog_url_invalid' }
    const cachedCatalog = deps.getCatalogCache()
    if (!cachedCatalog || cachedCatalog.url !== preferences.catalogUrl) return { ok: false, error: 'catalog_unavailable' }
    const plugin = cachedCatalog.document.plugins.find(item => item.id === pluginId)
    const latestVersion = plugin && deps.selectLatestVersion(plugin, '1')
    if (!plugin || !latestVersion || latestVersion.version !== version) return { ok: false, error: 'plugin_not_in_catalog' }
    const downloaded = await deps.createCatalogGateway().download(latestVersion)
    if (!downloaded.ok) return { ok: false, error: downloaded.error }
    const planned = registry.planInstall(downloaded.value)
    if (!planned.ok) return { ok: false, error: planned.error }
    if (planned.value.kind === 'incompatible' || planned.value.pluginId !== plugin.id
      || planned.value.version !== latestVersion.version) return { ok: false, error: 'catalog_invalid' }
    if (!deps.catalogFingerprintMatches(plugin.publicKeyFingerprint, planned.value.signatureFingerprint)
      || (plugin.publicKeyFingerprint !== undefined && planned.value.signatureStatus !== 'valid')) {
      return { ok: false, error: 'signature_mismatch' }
    }
    rememberPluginPlan(deps.pendingPlanIds, deps.pendingDeveloperFolders, planned.value.token, plugin.id)
    return { ok: true, value: { ...planned.value, source: 'catalog' as const } }
  })

  handleWithSenderGuard(deps.ipcMain, IPC_CHANNELS.pluginReportIssue, deps.assertPluginPanelSender, async (_event, pluginId: unknown) => {
    const registry = deps.getRegistry()
    const preferencesStore = deps.getPreferencesStore()
    if (!registry || !preferencesStore) return { ok: false, error: 'plugin_service_unavailable' }
    if (!isPluginPanelPluginId(pluginId)) return { ok: false, error: 'invalid_request' }
    const installed = registry.list().find(plugin => plugin.id === pluginId)
    if (!installed) return { ok: false, error: 'plugin_not_found' }
    let preferences: ReturnType<PluginPreferencesStore['get']>
    try { preferences = preferencesStore.get() }
    catch { return { ok: false, error: 'preferences_unsafe' } }
    const catalog = deps.getCatalogCache()?.url === preferences.catalogUrl ? deps.getCatalogCache()?.document : null
    const localInstall = !catalog?.plugins.some(plugin => plugin.id === installed.id)
    const url = buildPluginIssueReportUrl(deps.issueReportBaseUrl(), installed.id, installed.currentVersion, localInstall)
    if (!url) return { ok: false, error: 'report_unavailable' }
    try {
      await deps.openExternal(url)
      return { ok: true, value: { opened: true } }
    } catch {
      return { ok: false, error: 'plugin_action_failed' }
    }
  })
}
