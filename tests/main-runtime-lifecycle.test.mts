import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { blockLines, readSources } from './support/source-blocks.mts'

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
    'pluginRuntime.dispose()',
    'mainState.windowsFullscreenDetector?.stop()',
    'mainState.windowsFullscreenDetector = null',
    'if (mainState.panelBlurHideHandle) clearTimeout(mainState.panelBlurHideHandle)',
    'mainState.panelBlurHideHandle = null',
    'mainState.windowsFullscreenAutoHiddenPet = false',
    'mainState.windowsFullscreenAutoHiddenPanel = false',
    'historyRuntime.dispose()',
    'pluginCatalogRuntime.dispose()',
    'appUpdateRuntime.dispose()',
    'if (mainState.localUsageScanTimer) clearInterval(mainState.localUsageScanTimer)',
    'mainState.localUsageScanTimer = null',
    'mainState.localUsageReader = null',
    'mainState.localUsageScanPromise = null',
    'mainState.presentationController?.clear()',
    'mainState.permissionBroker?.shutdown()',
    'growth.dispose()',
    'mainState.historyStore?.close()',
    'mainState.historyStore = null',
    'mainState.projectRoutingStore?.close()',
    'mainState.projectRoutingStore = null',
    'petWindowModes.dispose()',
    'disposeMainTimers(mainState)',
  ])
})

test('the growth service releases its stores in the established order', () => {
  assert.deepEqual(blockLines(readFileSync('electron/main/growth-service.ts', 'utf8'), /function dispose\(\): void \{/), [
    'state.progressionStore?.close()',
    'state.progressionStore = null',
    'if (state.achievementStoreRetryTimer) cancel(state.achievementStoreRetryTimer)',
    'state.achievementStoreRetryTimer = null',
    'if (achievementProgressTimer) cancel(achievementProgressTimer)',
    'achievementProgressTimer = null',
    'state.achievementStore?.close()',
    'state.achievementStore = null',
  ])
})

test('the plugin runtime releases its services in the established order', () => {
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
