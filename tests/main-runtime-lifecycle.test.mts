import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { blockLines, readSources } from './support/source-blocks.mts'

// 只能在 Electron 內執行的主程序生命週期序列的 characterization。階段 11 從
// electron/main/runtime.ts 抽出服務；這些快照讓啟動順序、結束清理、renderer crash
// 後的重送與視窗安全設定的任何變動，都必須是明確、經過審查的 diff。

const main = readFileSync('electron/main.ts', 'utf8')
const mainDirectory = () => readSources('electron/main')

test('startup steps run in the established order', () => {
  const steps = [...main.matchAll(/startupStep\('([a-z-]+)'/g)].map(match => match[1])
  assert.deepEqual(steps, [
    'integration-scripts',
    'adapters',
    'project-routing',
    'tokens',
    'protocol',
    'windows-fullscreen',
    'desktop',
    'pet-window',
    'plugins',
    'fullscreen-targets',
    'power-monitor',
    'presentation',
    'plugin-host',
    'display-events',
    'permission',
    'progression',
    'achievements',
    'history',
    'event-server',
    'panel-window',
  ])
})

test('teardown releases services in the established order', () => {
  assert.deepEqual(blockLines(main, /function teardownMainServices\(\): void \{/), [
    'mainState.isQuitting = true',
    'runMarker.clear()',
    'hookStartupMarker.clear()',
    'flushMainLog()',
    // 階段 11 後續：plugin 服務的釋放順序移進 pluginRuntime.dispose()，順序由下一個測試固定。
    'pluginRuntime.dispose()',
    'mainState.windowsFullscreenDetector?.stop()',
    'mainState.windowsFullscreenDetector = null',
    'if (mainState.panelBlurHideHandle) clearTimeout(mainState.panelBlurHideHandle)',
    'mainState.panelBlurHideHandle = null',
    'mainState.windowsFullscreenAutoHiddenPet = false',
    'mainState.windowsFullscreenAutoHiddenPanel = false',
    // 階段 11：History runtime 服務另外停止本機用量補掃與清除計時器，改前沒有任何清理步驟會停它們。
    'historyRuntime.dispose()',
    'pluginCatalogRuntime.dispose()',
    // 週期二：App 新版檢查服務另外清除每小時喚醒計時器。
    'appUpdateRuntime.dispose()',
    'if (mainState.localUsageScanTimer) clearInterval(mainState.localUsageScanTimer)',
    'mainState.localUsageScanTimer = null',
    'mainState.localUsageReader = null',
    'mainState.localUsageScanPromise = null',
    'mainState.presentationController?.clear()',
    'mainState.permissionBroker?.shutdown()',
    // 階段 11 後續：progression／achievement 的釋放順序移進 growth.dispose()，順序由下一個測試固定。
    // 刻意差異：achievementProgressTimer（進度廣播去抖）改由 dispose() 清除；改前沒有任何清理步驟會停它。
    'growth.dispose()',
    'mainState.historyStore?.close()',
    'mainState.historyStore = null',
    'mainState.projectRoutingStore?.close()',
    'mainState.projectRoutingStore = null',
    // 階段 11：寵物視窗模式服務另外停止重新貼邊輪詢；改前它是模組變數，沒有任何清理步驟會停。
    'petWindowModes.dispose()',
    'disposeMainTimers(mainState)',
  ])
})

test('the growth service releases its stores in the established order', () => {
  // 改前這些行逐字是 teardownMainServices 的 progression／achievement 段；去抖計時器是唯一新增的清理步驟。
  assert.deepEqual(blockLines(readFileSync('electron/main/growth-service.ts', 'utf8'), /function dispose\(\): void \{/), [
    'state.progressionStore?.close()',
    'state.progressionStore = null',
    'if (state.achievementStoreRetryTimer) cancel(state.achievementStoreRetryTimer)',
    'state.achievementStoreRetryTimer = null',
    // 刻意差異：改前沒有任何清理步驟會清掉這個去抖計時器。
    'if (achievementProgressTimer) cancel(achievementProgressTimer)',
    'achievementProgressTimer = null',
    'state.achievementStore?.close()',
    'state.achievementStore = null',
  ])
})

test('the plugin runtime releases its services in the established order', () => {
  // 改前這些行逐字是 teardownMainServices 的 plugin 段；搬進 dispose() 後順序不可改變。
  assert.deepEqual(blockLines(readFileSync('electron/main/plugin-runtime.ts', 'utf8'), /function dispose\(\): void \{/), [
    'mainState.pluginPanelViewController?.close()',
    'mainState.pluginPanelViewController = null',
    'mainState.pluginDeveloperModeWatcher?.destroy()',
    'mainState.pluginDeveloperModeWatcher = null',
    'mainState.pluginBroker?.destroy()',
    'mainState.pluginBroker = null',
    'mainState.pluginFeedController = null',
    'mainState.pluginAgentStatusController?.destroy()',
    'mainState.pluginAgentStatusController = null',
    'mainState.pluginSecretsStore = null',
    'mainState.pluginSecretConsentStore = null',
    'mainState.pluginSettingsStore = null',
    'mainState.pluginRuntimeContexts.clear()',
    'mainState.pluginPreferencesSnapshot = null',
    'mainState.pluginHostWindow?.close()',
    'mainState.pluginHostWindow = null',
    'mainState.pluginEventSourceController?.destroy()',
    'mainState.pluginEventSourceController = null',
  ])
})

test('the plugin catalog runtime clears its hourly timer on dispose', () => {
  assert.deepEqual(blockLines(readFileSync('electron/main/plugin-catalog-runtime.ts', 'utf8'), /function dispose\(\): void \{/), [
    'if (mainState.pluginCatalogAutoCheckTimer) clearInterval(mainState.pluginCatalogAutoCheckTimer)',
    'mainState.pluginCatalogAutoCheckTimer = null',
  ])
})

test('will-quit closes servers and native surfaces in the established order', () => {
  assert.deepEqual(blockLines(main, /app\.on\('will-quit', \(\) => \{/), [
    'unregisterPermissionHotkeys()',
    'mainState.permissionRelay?.shutdown()',
    'mainState.permissionRelay = null',
    'mainState.permissionBroker = null',
    'mainState.permissionAdapterServer?.closeAllConnections?.()',
    'mainState.permissionAdapterServer?.close()',
    'mainState.permissionAdapterServer = null',
    'mainState.desktopNotifications?.destroy()',
    'mainState.desktopNotifications = null',
    'mainState.desktopTray?.destroy()',
    'mainState.desktopTray = null',
    'mainState.presentationMcpServer?.closeAllConnections?.()',
    'mainState.presentationMcpServer?.close()',
    'mainState.presentationMcpServer = null',
    'mainState.presentationController = null',
    // 先停掉會往事件流程送事件的監看，再關事件伺服器。
    'turnEndWatcher?.stop()',
    'turnEndWatcher = null',
    'mainState.eventServer?.closeAllConnections?.()',
    'mainState.eventServer?.close()',
    'mainState.eventServer = null',
  ])
})

test('a recovered renderer receives every main-owned state again', () => {
  assert.deepEqual(blockLines(mainDirectory(), /function resyncRendererState\(\): void \{/), [
    'broadcastPetWindowMode()',
    'broadcastPowerSaveState()',
    'broadcastPluginBadges()',
    'broadcastPluginFeedUnreadCount()',
    'broadcastProgression()',
    'broadcastAchievements()',
    'broadcastHistoryUpdated()',
    'schedulePermissionUiSync()',
    'try { broadcastDesktopPreferences(currentDesktopPreferences()) } catch {}',
  ])
})

test('pet and panel windows keep their isolated webPreferences', () => {
  const sources = mainDirectory()
  const expected = [
    'preload: join(__dirname, \'preload.js\'),',
    'contextIsolation: true,',
    'nodeIntegration: false,',
    'sandbox: true,',
    'webSecurity: true,',
    'webviewTag: false,',
    'devTools: !app.isPackaged,',
  ]
  for (const factory of ['export function createPetWindow', 'export function createPanelWindow']) {
    const start = sources.indexOf(factory)
    assert.ok(start >= 0, factory)
    assert.deepEqual(blockLines(sources.slice(start), /webPreferences: \{/), expected, factory)
  }
})

test('renderer windows deny popups, foreign navigation and webviews', () => {
  assert.deepEqual(blockLines(mainDirectory(), /export function secureRendererWindow\(window: BrowserWindow\): void \{/), [
    'window.webContents.setWindowOpenHandler(() => ({ action: \'deny\' }))',
    'window.webContents.on(\'will-navigate\', (event, url) => {',
    'if (!isTrustedRendererUrl(url)) event.preventDefault()',
    '})',
    'window.webContents.on(\'will-redirect\', (event, url) => {',
    'if (!isTrustedRendererUrl(url)) event.preventDefault()',
    '})',
    'window.webContents.on(\'will-attach-webview\', (event) => {',
    'event.preventDefault()',
    '})',
  ])
})
