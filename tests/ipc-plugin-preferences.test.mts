import assert from 'node:assert/strict'
import test from 'node:test'
import type { IpcMainInvokeEvent } from 'electron'
import type { PluginPreferencesIpcDependencies } from '../electron/ipc/plugin-preferences.ts'
import { registerPluginPreferencesIpc } from '../electron/ipc/plugin-preferences.ts'
import { isPluginPanelPluginId, isPluginPanelPreferencePatch } from '../electron/plugin-panel-validation.ts'

function fixture() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const calls: string[] = []
  const pluginEnableOrder = new Map<string, number>()
  const sequence = { value: 0 }
  let enabledCount = 0
  let maxEnabled = 1
  let preferences = {
    onlineCatalogEnabled: false,
    catalogUrl: 'https://catalog.invalid/index.json',
    dailyUpdateCheck: false,
  }
  const registry = {
    list: () => [{ id: 'sample-plugin' }],
    setStatus: (id: string, status: string) => calls.push(`status:${id}:${status}`),
  }
  const store = {
    get: () => preferences,
    updateGlobal: (patch: Record<string, unknown>) => {
      preferences = { ...preferences, ...patch } as typeof preferences
      calls.push('global:update')
      return preferences
    },
    updatePlugin: (pluginId: string, patch: Record<string, unknown>) => {
      calls.push(`plugin:update:${pluginId}:${String(patch.enabled)}`)
      return preferences
    },
  }
  const ipcMain = {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => { handlers.set(channel, handler) },
  } as unknown as PluginPreferencesIpcDependencies['ipcMain']
  const deps: PluginPreferencesIpcDependencies = {
    ipcMain,
    assertPluginPanelSender: event => { if (event !== 'panel') throw new Error('untrusted panel') },
    isPluginPanelPluginId,
    isPluginPanelPreferencePatch,
    getPreferencesStore: () => store as never,
    getRegistry: () => registry as never,
    enabledPluginContext: () => false,
    enabledPluginCount: () => enabledCount,
    maxEnabledPlugins: () => maxEnabled,
    pluginEnableOrder,
    nextPluginEnableOrder: sequence,
    onCatalogPreferencesChanged: (_previous, next) => calls.push(`catalog:${next.onlineCatalogEnabled}`),
    checkCatalogIfDue: () => calls.push('catalog:check'),
    syncPluginHost: () => calls.push('host:sync'),
    pluginPanelError: () => 'plugin_action_failed',
  }
  registerPluginPreferencesIpc(deps)
  return { handlers, calls, pluginEnableOrder, sequence, setEnabledCount: (value: number) => { enabledCount = value }, setMaxEnabled: (value: number) => { maxEnabled = value } }
}

test('global plugin preferences notify catalog state, sync the host, and schedule opted-in checks', async () => {
  const state = fixture()
  const handler = state.handlers.get('plugin-preferences-global-set')!
  assert.deepEqual(await handler('panel' as unknown as IpcMainInvokeEvent, { onlineCatalogEnabled: true, dailyUpdateCheck: true }), {
    ok: true,
    value: {
      onlineCatalogEnabled: true,
      catalogUrl: 'https://catalog.invalid/index.json',
      dailyUpdateCheck: true,
    },
  })
  assert.deepEqual(state.calls, ['global:update', 'catalog:true', 'host:sync', 'catalog:check'])
})

test('plugin enable preferences enforce the limit and update registry order only after acceptance', async () => {
  const state = fixture()
  const handler = state.handlers.get('plugin-preferences-instance-set')!
  state.setEnabledCount(1)
  assert.deepEqual(await handler('panel' as unknown as IpcMainInvokeEvent, 'sample-plugin', { enabled: true }), {
    ok: false,
    error: 'too_many_enabled',
  })
  assert.deepEqual(state.calls, [])

  state.setEnabledCount(0)
  assert.deepEqual(await handler('panel' as unknown as IpcMainInvokeEvent, 'sample-plugin', { enabled: true }), {
    ok: true,
    value: {
      onlineCatalogEnabled: false,
      catalogUrl: 'https://catalog.invalid/index.json',
      dailyUpdateCheck: false,
    },
  })
  assert.deepEqual(state.calls, [
    'plugin:update:sample-plugin:true',
    'status:sample-plugin:enabled',
    'host:sync',
  ])
  assert.equal(state.pluginEnableOrder.get('sample-plugin'), 0)
  assert.equal(state.sequence.value, 1)
})
