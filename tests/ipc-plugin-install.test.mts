import assert from 'node:assert/strict'
import test from 'node:test'
import type { IpcMainInvokeEvent } from 'electron'
import type { PluginInstallIpcDependencies } from '../electron/ipc/plugin-install.ts'
import { registerPluginInstallIpc } from '../electron/ipc/plugin-install.ts'
import { isPluginPanelInstallConfirmation, isPluginPanelPluginId } from '../electron/plugin-panel-validation.ts'

function fixture() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const calls: string[] = []
  const pendingPlanIds = new Map<string, string>()
  const pendingDeveloperFolders = new Map<string, string>()
  const developerSourceFolders = new Map<string, string>()
  let dialogResult = { canceled: false, filePaths: ['/fixture/plugin.agentpet-plugin'] }
  let dialogOpen = false
  const plan = { token: 'fixture-plan', kind: 'new', pluginId: 'sample-plugin', version: '1.0.0' }
  const plugin = { id: 'sample-plugin', currentVersion: '1.0.0' }
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
  const panelWindow = { isDestroyed: () => false } as never
  const ipcMain = {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => { handlers.set(channel, handler) },
  } as unknown as PluginInstallIpcDependencies['ipcMain']
  const deps: PluginInstallIpcDependencies = {
    ipcMain,
    assertPluginPanelSender: event => { if (event !== 'panel') throw new Error('untrusted panel') },
    getRegistry: () => registry as never,
    getPreferencesStore: () => preferences as never,
    getPanelWindow: () => panelWindow,
    isDialogOpen: () => dialogOpen,
    setDialogOpen: value => { dialogOpen = value },
    showOpenDialog: async (_window, options) => {
      calls.push(`dialog:${options.properties.join(',')}`)
      return dialogResult
    },
    translate: key => key,
    fs: {
      lstat: async () => ({ isFile: () => true, isSymbolicLink: () => false, size: 32 }),
      readFile: async () => new Uint8Array([1, 2, 3]),
    } as unknown as PluginInstallIpcDependencies['fs'],
    maxArchiveBytes: 100,
    pendingPlanIds,
    pendingDeveloperFolders,
    developerSourceFolders,
    getDeveloperModeWatcher: () => ({ unwatch: id => calls.push(`unwatch:${id}`) } as never),
    getSecretsStore: () => ({ remove: id => calls.push(`secrets:remove:${id}`) } as never),
    getPluginBroker: () => ({ removePlugin: (id, keepData) => calls.push(`broker:remove:${id}:${keepData}`), listLogs: () => [], listDiagnostics: () => [] } as never),
    getPluginHostGrantController: () => ({ clearPlugin: id => calls.push(`grant:clear:${id}`) } as never),
    getPluginFeedController: () => ({ clear: id => { calls.push(`feed:clear:${id}`); return 1 } } as never),
    isInstallConfirmation: isPluginPanelInstallConfirmation,
    isPluginPanelPluginId,
    pluginPanelError: () => 'plugin_action_failed',
    syncPluginHost: () => calls.push('host:sync'),
    pluginPanelSnapshot: () => ({ ok: true, value: { preferences: {} as never, plugins: [plugin] } }),
  }
  registerPluginInstallIpc(deps)
  return {
    handlers,
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
  assert.deepEqual(await select('panel' as unknown as IpcMainInvokeEvent), {
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
  assert.deepEqual(await confirm('panel' as unknown as IpcMainInvokeEvent, 'fixture-plan', false, false), {
    ok: true,
    value: { id: 'sample-plugin', currentVersion: '1.0.0' },
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
  assert.deepEqual(await remove('panel' as unknown as IpcMainInvokeEvent, 'sample-plugin', true), {
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
  assert.deepEqual(await remove('panel' as unknown as IpcMainInvokeEvent, 'sample-plugin', false), {
    ok: true,
    value: { removed: true },
  })
  assert.ok(state.calls.includes('preferences:remove:sample-plugin'))
  assert.ok(state.calls.includes('feed:clear:sample-plugin'))
})
