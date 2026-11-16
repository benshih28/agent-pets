import { createPluginCatalogGateway, isPluginCatalogUrl, PLUGIN_CATALOG_ALLOWED_HOSTS, PLUGIN_CATALOG_MAX_PACKAGE_BYTES } from '../plugin-catalog.ts'
import { buildPluginCatalogPanelItems, PluginCatalogAutoCheckSchedule } from '../plugin-catalog-updates.ts'
import { isRecord } from '../value-guards.ts'
import type { TranslationKey, TranslationParams } from '../../src/i18n'
import type { MainState } from './state.ts'

// Plugin catalog runtime：目錄閘道（抓 registry 與套件封包）與每日自動檢查更新的排程。
//
// 閘道與排程所需的 plugin 服務都留在 `mainState`（IPC registrar 與 plugin 面板會讀）；
// 這裡只持有「每小時喚醒排程」的計時器控制，並由 `dispose()` 清除。計時器仍存在
// `mainState.pluginCatalogAutoCheckTimer`，`disposeMainTimers` 與 teardown 都看得到它。
// 不 import `runtime.ts` 或 Electron 值，因此能在 Node 測試直接執行。

export type PluginCatalogRuntimeState = Pick<MainState,
  | 'pluginNetworkClient' | 'pluginRegistry' | 'pluginPreferences' | 'pluginFeedController'
  | 'pluginCatalogAutoCheckSchedule' | 'pluginCatalogAutoCheckTimer'>

export interface PluginCatalogRuntimeDeps {
  state: PluginCatalogRuntimeState
  appVersion(): string
  translate(key: TranslationKey, params?: TranslationParams): string
}

export interface PluginCatalogRuntime {
  gateway(): ReturnType<typeof createPluginCatalogGateway>
  checkUpdates(): Promise<number>
  /** 建立每日檢查排程與每小時喚醒計時器；已建立時不重複建立。 */
  initializeAutoCheck(): void
  /** 清除每小時喚醒計時器；可重複呼叫。 */
  dispose(): void
}

export function decodeCatalogBase64(value: unknown): Uint8Array {
  if (typeof value !== 'string' || value.length === 0 || value.length > 36_000_000
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('Invalid catalog base64')
  }
  const bytes = Buffer.from(value, 'base64')
  if (bytes.toString('base64') !== value) throw new Error('Invalid catalog base64')
  return bytes
}

export function createPluginCatalogRuntime(deps: PluginCatalogRuntimeDeps): PluginCatalogRuntime {
  const mainState = deps.state

  function gateway() {
    return createPluginCatalogGateway({
      fetchRegistry: async (url, maxBytes) => {
        const e2eMode = Object.prototype.hasOwnProperty.call(globalThis, '__agentPetsE2E')
        const e2e = (globalThis as typeof globalThis & { __agentPetsE2E?: unknown }).__agentPetsE2E
        if (e2eMode) {
          if (!isRecord(e2e)) throw new Error('Catalog fixture unavailable')
          const fixture = e2e.catalogFixture
          if (!isRecord(fixture) || fixture.registry === undefined) throw new Error('Catalog fixture unavailable')
          return fixture.registry
        }
        if (!mainState.pluginNetworkClient) throw new Error('Plugin network unavailable')
        const result = await mainState.pluginNetworkClient.fetch('agent-pets-catalog', url, undefined,
          PLUGIN_CATALOG_ALLOWED_HOSTS, { maxResponseBytes: maxBytes, timeoutMs: 15_000, requestsPerMinute: 10 })
        if (!result.ok) throw Object.assign(new Error('Catalog unavailable'), { code: result.error })
        if (result.value.status === 404) throw Object.assign(new Error('Catalog not found'), { code: 'catalog_not_found' })
        if (result.value.status < 200 || result.value.status >= 300) throw new Error('Catalog unavailable')
        return result.value.isBase64Encoded
          ? Buffer.from(decodeCatalogBase64(result.value.body)).toString('utf8')
          : result.value.body
      },
      downloadArchive: async (url, maxBytes) => {
        const e2eMode = Object.prototype.hasOwnProperty.call(globalThis, '__agentPetsE2E')
        const e2e = (globalThis as typeof globalThis & { __agentPetsE2E?: unknown }).__agentPetsE2E
        if (e2eMode) {
          if (!isRecord(e2e)) throw new Error('Catalog fixture unavailable')
          const fixture = e2e.catalogFixture
          const downloads = isRecord(fixture) && isRecord(fixture.downloads) ? fixture.downloads : null
          if (!downloads || !Object.prototype.hasOwnProperty.call(downloads, url)) throw new Error('Catalog fixture download unavailable')
          return decodeCatalogBase64(downloads[url])
        }
        if (!mainState.pluginNetworkClient) throw new Error('Plugin network unavailable')
        const result = await mainState.pluginNetworkClient.fetch('agent-pets-catalog', url, undefined,
          PLUGIN_CATALOG_ALLOWED_HOSTS, { maxResponseBytes: Math.min(maxBytes, PLUGIN_CATALOG_MAX_PACKAGE_BYTES), timeoutMs: 15_000, requestsPerMinute: 10 })
        if (!result.ok) throw Object.assign(new Error('Package unavailable'), { code: result.error })
        if (result.value.status < 200 || result.value.status >= 300) throw new Error('Package unavailable')
        return result.value.isBase64Encoded
          ? decodeCatalogBase64(result.value.body)
          : Buffer.from(result.value.body, 'utf8')
      },
    })
  }

  function checkUpdates(): Promise<number> {
    return (async () => {
      if (!mainState.pluginRegistry || !mainState.pluginPreferences) throw new Error('Plugin catalog services unavailable')
      const preferences = mainState.pluginPreferences.get()
      if (!preferences.onlineCatalogEnabled || !preferences.dailyUpdateCheck
        || !isPluginCatalogUrl(preferences.catalogUrl)) throw new Error('Plugin catalog auto-check disabled')
      const result = await gateway().load(preferences.catalogUrl)
      if (!result.ok) throw new Error('Plugin catalog check failed')
      const items = buildPluginCatalogPanelItems(result.value, mainState.pluginRegistry.list(), deps.appVersion())
      return items.filter(item => item.updateAvailable).length
    })()
  }

  function initializeAutoCheck(): void {
    if (!mainState.pluginPreferences || !mainState.pluginRegistry || mainState.pluginCatalogAutoCheckSchedule) return
    mainState.pluginCatalogAutoCheckSchedule = new PluginCatalogAutoCheckSchedule({
      isEnabled: () => {
        try {
          const preferences = mainState.pluginPreferences?.get()
          return preferences?.onlineCatalogEnabled === true && preferences.dailyUpdateCheck
            && isPluginCatalogUrl(preferences.catalogUrl)
        } catch { return false }
      },
      getLastCheckedDay: () => mainState.pluginPreferences?.getLastCatalogAutoCheckDay() ?? null,
      setLastCheckedDay: day => {
        if (!mainState.pluginPreferences) throw new Error('Plugin preferences unavailable')
        mainState.pluginPreferences.setLastCatalogAutoCheckDay(day)
      },
      check: checkUpdates,
      notify: updateCount => {
        mainState.pluginFeedController?.addSystemNotification(
          'agent-pets-catalog',
          { 'zh-TW': 'Agent Pets', 'en-US': 'Agent Pets' },
          deps.translate('pluginCatalogAutoCheckTitle'),
          updateCount > 0
            ? deps.translate('pluginCatalogAutoCheckFound', { count: String(updateCount) })
            : deps.translate('pluginCatalogAutoCheckNone'),
        )
      },
    })
    void mainState.pluginCatalogAutoCheckSchedule.checkIfDue()
    if (mainState.pluginCatalogAutoCheckTimer) clearInterval(mainState.pluginCatalogAutoCheckTimer)
    mainState.pluginCatalogAutoCheckTimer = setInterval(() => {
      void mainState.pluginCatalogAutoCheckSchedule?.checkIfDue()
    }, 60 * 60 * 1_000)
    mainState.pluginCatalogAutoCheckTimer.unref?.()
  }

  function dispose(): void {
    if (mainState.pluginCatalogAutoCheckTimer) clearInterval(mainState.pluginCatalogAutoCheckTimer)
    mainState.pluginCatalogAutoCheckTimer = null
  }

  return { gateway, checkUpdates, initializeAutoCheck, dispose }
}
