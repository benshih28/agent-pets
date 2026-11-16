import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { IPC_CHANNELS } from '../electron/ipc/channels.ts'
import { analyzeIpcInventory, renderIpcInventory } from '../scripts/generate-ipc-inventory.mjs'

const mainSource = readFileSync(path.resolve('electron/main.ts'), 'utf8')
const runtimeSource = readFileSync(path.resolve('electron/main/runtime.ts'), 'utf8')
const pluginRuntimeSource = readFileSync(path.resolve('electron/main/plugin-runtime.ts'), 'utf8')
const hostSource = readFileSync(path.resolve('electron/plugin-host-window.ts'), 'utf8')
const panelViewSource = readFileSync(path.resolve('electron/plugin-panel-view.ts'), 'utf8')
const pluginUiPreloadSource = readFileSync(path.resolve('electron/plugin-ui-preload.ts'), 'utf8')
const pluginUiBridgeSource = readFileSync(path.resolve('electron/plugin-panel-view-bridge.ts'), 'utf8')
const preloadSource = readFileSync(path.resolve('electron/preload.ts'), 'utf8')
const pluginHostPreloadSource = readFileSync(path.resolve('electron/plugin-host-preload.ts'), 'utf8')
const sharedElectronApiSource = readFileSync(path.resolve('src/types/electron-api.ts'), 'utf8')

test('IPC inventory matches main registrations, preload APIs, and sender guards', () => {
  const inventory = analyzeIpcInventory()
  assert.ok(inventory.rows.length >= 70)
  assert.equal(inventory.rows.length, new Set(inventory.rows.map(row => row.channel)).size)
  assert.equal(inventory.dynamicRegistrationCount, 0)
  assert.deepEqual(inventory.missingPreloadChannels, [])
  assert.deepEqual(inventory.unregisteredPreloadChannels, [])
  assert.deepEqual(inventory.unguardedChannels, [])
  assert.deepEqual(inventory.missingTypes, [])
  assert.deepEqual(inventory.extraTypes, [])
  assert.deepEqual(inventory.unknownChannelKeys, [])
  assert.deepEqual(inventory.unusedChannelKeys, [])
  const channelValues = Object.values(IPC_CHANNELS)
  assert.ok(channelValues.length >= 105)
  assert.equal(new Set(channelValues).size, channelValues.length)
  assert.doesNotMatch(mainSource, /ipcMain\.(?:handle|on)\(\s*['"]/)
  assert.doesNotMatch(preloadSource, /ipcRenderer\.(?:invoke|send|on|removeListener)\(\s*['"]/)
  assert.doesNotMatch(pluginHostPreloadSource, /ipcRenderer\.(?:invoke|send|on|removeListener)\(\s*['"]/)
  assert.doesNotMatch(pluginUiPreloadSource, /ipcRenderer\.(?:invoke|send|on|removeListener)\(\s*['"]/)
  assert.equal(readFileSync(path.resolve('docs/security/ipc-inventory.md'), 'utf8'), renderIpcInventory())
  assert.match(sharedElectronApiSource, /export interface ElectronAPI \{/)
  assert.match(pluginUiPreloadSource, /contextBridge\.exposeInMainWorld\('agentPetsPlugin', api\)/)
  assert.match(pluginUiBridgeSource, /export interface PluginPanelPublicApi/)
})

test('growth reset and database maintenance IPC are panel-only handlers with preload APIs', () => {
  const inventory = analyzeIpcInventory()
  for (const channel of [IPC_CHANNELS.growthResetArm, IPC_CHANNELS.growthReset, IPC_CHANNELS.dbMaintenanceRun]) {
    const row = inventory.rows.find(item => item.channel === channel)
    assert.ok(row, channel)
    assert.match(row.sender, /設定面板 main frame/)
    assert.equal(row.hasSenderGuard, true)
    assert.equal(row.hasPreloadApi, true)
  }
  const registrar = readFileSync(path.resolve('electron/ipc/growth-maintenance.ts'), 'utf8')
  assert.match(registrar, /handleTrusted\(deps\.ipcMain, IPC_CHANNELS\.growthResetArm, deps\.getPanelWindow/)
  assert.match(registrar, /handleTrusted\(deps\.ipcMain, IPC_CHANNELS\.growthReset, deps\.getPanelWindow/)
  assert.match(registrar, /handleTrusted\(deps\.ipcMain, IPC_CHANNELS\.dbMaintenanceRun, deps\.getPanelWindow/)
})

test('renderer windows and plugin views explicitly retain Electron security defaults', () => {
  assert.ok(mainSource.split('\n').length < 1_200)
  assert.equal((runtimeSource.match(/new BrowserWindow\(/g) ?? []).length, 2)
  assert.equal((runtimeSource.match(/webSecurity:\s*true/g) ?? []).length, 2)
  assert.equal((runtimeSource.match(/contextIsolation:\s*true/g) ?? []).length, 2)
  assert.equal((runtimeSource.match(/sandbox:\s*true/g) ?? []).length, 2)
  assert.equal((runtimeSource.match(/nodeIntegration:\s*false/g) ?? []).length, 2)
  assert.match(runtimeSource, /secureRendererWindow\(mainState\.petWindow\)/)
  assert.match(runtimeSource, /secureRendererWindow\(mainState\.panelWindow\)/)

  assert.match(hostSource, /webSecurity:\s*true/)
  assert.match(hostSource, /contextIsolation:\s*true/)
  assert.match(hostSource, /sandbox:\s*true/)
  assert.match(hostSource, /nodeIntegration:\s*false/)
  assert.match(hostSource, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/)
  assert.match(hostSource, /will-navigate/)
  assert.match(hostSource, /will-redirect/)
  assert.match(hostSource, /will-attach-webview/)

  assert.match(panelViewSource, /webSecurity:\s*true/)
  assert.match(panelViewSource, /setPermissionRequestHandler\([^\n]+callback\(false\)/)
  assert.match(panelViewSource, /setPermissionCheckHandler\(\(\) => false\)/)
  assert.match(panelViewSource, /will-download/)
  assert.match(panelViewSource, /will-navigate/)
  assert.match(panelViewSource, /will-redirect/)
  assert.match(panelViewSource, /will-attach-webview/)
})

test('plugin panel views keep a transparent native background so plugins can round their own corners', () => {
  assert.match(pluginRuntimeSource, /createView: options => \{\s+const view = deps\.createWebContentsView\(options\)[\s\S]{0,200}view\.setBackgroundColor\('#00000000'\)/)
  assert.match(runtimeSource, /createWebContentsView: options => new WebContentsView\(options\)/)
})

test('every non-default Electron session rejects permission requests and checks', () => {
  const networkSessionStart = pluginRuntimeSource.indexOf("const pluginNetworkSession = session.fromPartition('plugin-network')")
  assert.notEqual(networkSessionStart, -1)
  const networkSession = pluginRuntimeSource.slice(networkSessionStart, networkSessionStart + 1_200)
  assert.match(networkSession, /setPermissionRequestHandler\([^\n]+callback\(false\)/)
  assert.match(networkSession, /setPermissionCheckHandler\(\(\) => false\)/)

  assert.match(hostSource, /pluginSession\.setPermissionRequestHandler\([^\n]+callback\(false\)/)
  assert.match(hostSource, /pluginSession\.setPermissionCheckHandler\(\(\) => false\)/)
  assert.match(mainSource, /defaultSession\.setPermissionCheckHandler\(\(\) => false\)/)
  assert.match(mainSource, /defaultSession\.setPermissionRequestHandler\([\s\S]{0,150}callback\(false\)/)
})
