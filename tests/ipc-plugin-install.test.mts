import assert from 'node:assert/strict'
import test from 'node:test'
import type { PluginBroker } from '../electron/plugin-broker.ts'
import type { PluginDeveloperModeWatcher } from '../electron/plugin-developer-mode.ts'
import type { PluginFeedController } from '../electron/plugin-feed.ts'
import type { PluginHostGrantController } from '../electron/plugin-host-grants.ts'
import { DEFAULT_PLUGIN_PREFERENCES, type PluginPreferencesStore } from '../electron/plugin-preferences.ts'
import type { PluginRegistry } from '../electron/plugin-registry.ts'
import type { PluginSecretsStore } from '../electron/plugin-secrets.ts'
import type { PluginPanelPlugin } from '../src/types/plugin.ts'
import type { PluginInstallIpcDependencies } from '../electron/ipc/plugin-install.ts'
import { registerPluginInstallIpc } from '../electron/ipc/plugin-install.ts'
import { isPluginPanelInstallConfirmation, isPluginPanelPluginId } from '../electron/plugin-panel-validation.ts'
import { fakeBrowserWindow, fakeIpcMainInvokeEvent } from './support/fake-electron.mts'
import { createFakeIpcMain } from './support/fake-ipc.mts'
import { fakeService } from './support/fake-service.mts'

function fixture() {
  const { ipcMain, handlers } = createFakeIpcMain()
  const calls: string[] = []
  const panelEvent = fakeIpcMainInvokeEvent()
  const pendingPlanIds = new Map<string, string>()
  const pendingDeveloperFolders = new Map<string, string>()
  const developerSourceFolders = new Map<string, string>()
  let dialogResult = { canceled: false, filePaths: ['/fixture/plugin.agentpet-plugin'] }
  let dialogOpen = false
  const plan = { token: 'fixture-plan', kind: 'new', pluginId: 'sample-plugin', version: '1.0.0' }
  const plugin = { id: 'sample-plugin', currentVersion: '1.0.0' }
  const panelPlugin: PluginPanelPlugin = {
    ...plugin,
    status: 'enabled',
    installedAt: 0,
    grantedPermissions: {},
    manifest: null,
    development: false,
    preference: { enabled: true, muted: false, rateLimitPer10Min: 30, targetPetId: null, grantedHosts: [] },
  }
  const registry = {
    list: () => [plugin],
    planInstall: () => ({ ok: true, value: plan }),
    planInstallDirectory: () => ({ ok: true, value: { ...plan, token: 'folder-plan' } }),
    install: (token: string) => {
      calls.push(`install:${token}`)
      return { ok: true, value: plugin }
    },
    remove: (pluginId: string, keepData: boolean) => {
      calls.push(`remove:${pluginId}:${keepData}`)
      return { ok: true, value: { removed: true } }
    },
  }
  const preferences = {
    get: () => ({ developerMode: true }),
    updatePlugin: (pluginId: string) => { calls.push(`preferences:update:${pluginId}`) },
    removePlugin: (pluginId: string) => { calls.push(`preferences:remove:${pluginId}`) },
  }
  const panelWindow = fakeBrowserWindow({ isDestroyed: () => false })
  const deps: PluginInstallIpcDependencies = {
    ipcMain,
    assertPluginPanelSender: event => { if (event !== panelEvent) throw new Error('untrusted panel') },
    getRegistry: () => fakeService<PluginRegistry>(registry),
    getPreferencesStore: () => fakeService<PluginPreferencesStore>(preferences),
    getPanelWindow: () => panelWindow,
    isDialogOpen: () => dialogOpen,
    setDialogOpen: value => { dialogOpen = value },
    showOpenDialog: async (_window, options) => {
      calls.push(`dialog:${options.properties.join(',')}`)
      return dialogResult
    },
    translate: key => key,
    // fs/promises 的 lstat 回傳完整 Stats，這裡只提供受測程式讀取的三個成員。
    fs: {
      lstat: async () => ({ isFile: () => true, isSymbolicLink: () => false, size: 32 }),
      readFile: async () => new Uint8Array([1, 2, 3]),
    } as unknown as PluginInstallIpcDependencies['fs'],
    maxArchiveBytes: 100,
    pendingPlanIds,
    pendingDeveloperFolders,
    developerSourceFolders,
    getDeveloperModeWatcher: () => fakeService<PluginDeveloperModeWatcher>({ unwatch: (id: string) => { calls.push(`unwatch:${id}`) } }),
    getSecretsStore: () => fakeService<PluginSecretsStore>({ remove: (id: string) => { calls.push(`secrets:remove:${id}`) } }),
    getPluginBroker: () => fakeService<PluginBroker>({ removePlugin: (id: string, keepData: boolean) => { calls.push(`broker:remove:${id}:${keepData}`) }, listLogs: () => [], listDiagnostics: () => [] }),
    getPluginHostGrantController: () => fakeService<PluginHostGrantController>({ clearPlugin: (id: string) => { calls.push(`grant:clear:${id}`) } }),
    getPluginFeedController: () => fakeService<PluginFeedController>({ clear: (id: string) => { calls.push(`feed:clear:${id}`); return 1 } }),
    isInstallConfirmation: isPluginPanelInstallConfirmation,
    isPluginPanelPluginId,
    pluginPanelError: () => 'plugin_action_failed',
    syncPluginHost: () => { calls.push('host:sync') },
    pluginPanelSnapshot: () => ({ ok: true, value: { preferences: DEFAULT_PLUGIN_PREFERENCES, plugins: [panelPlugin] } }),
  }
  registerPluginInstallIpc(deps)
  return {
    handlers,
    panelEvent,
    panelPlugin,
    calls,
    pendingPlanIds,
    pendingDeveloperFolders,
    developerSourceFolders,
    setDialogResult(value: typeof dialogResult) { dialogResult = value },
  }
}

test('plugin archive picker validates a regular bounded file and remembers the install token', async () => {
  const state = fixture()
  const select = state.handlers.get('plugin-install-select')!
  assert.deepEqual(await select(state.panelEvent), {
    ok: true,
    value: { token: 'fixture-plan', kind: 'new', pluginId: 'sample-plugin', version: '1.0.0' },
  })
  assert.equal(state.pendingPlanIds.get('fixture-plan'), 'sample-plugin')
  assert.equal(state.calls.includes('dialog:openFile'), true)
})

test('plugin install confirmation clears the pending plan and syncs the installed snapshot', async () => {
  const state = fixture()
  state.pendingPlanIds.set('fixture-plan', 'sample-plugin')
  const confirm = state.handlers.get('plugin-install-confirm')!
  assert.deepEqual(await confirm(state.panelEvent, 'fixture-plan', false, false), {
    ok: true,
    value: state.panelPlugin,
  })
  assert.equal(state.pendingPlanIds.has('fixture-plan'), false)
  assert.deepEqual(state.calls, [
    'preferences:update:sample-plugin',
    'install:fixture-plan',
    'unwatch:sample-plugin',
    'host:sync',
  ])
})

test('plugin removal clears runtime grants and preserves or removes preferences by choice', async () => {
  const state = fixture()
  const remove = state.handlers.get('plugin-remove')!
  assert.deepEqual(await remove(state.panelEvent, 'sample-plugin', true), {
    ok: true,
    value: { removed: true },
  })
  assert.deepEqual(state.calls, [
    'secrets:remove:sample-plugin',
    'remove:sample-plugin:true',
    'unwatch:sample-plugin',
    'broker:remove:sample-plugin:true',
    'grant:clear:sample-plugin',
    'host:sync',
  ])

  state.calls.length = 0
  assert.deepEqual(await remove(state.panelEvent, 'sample-plugin', false), {
    ok: true,
    value: { removed: true },
  })
  assert.ok(state.calls.includes('preferences:remove:sample-plugin'))
  assert.ok(state.calls.includes('feed:clear:sample-plugin'))
})
