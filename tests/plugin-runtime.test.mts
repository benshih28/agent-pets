import assert from 'node:assert/strict'
import test from 'node:test'
import { createPluginRuntime, type PluginRuntimeDeps, type PluginRuntimeState } from '../electron/main/plugin-runtime.ts'
import { fakeService } from './support/fake-service.mts'

function setup() {
  const calls: string[] = []
  const recorder = (name: string) => ({
    close: () => calls.push(`${name}.close`),
    destroy: () => calls.push(`${name}.destroy`),
  })
  const contexts = new Map([['demo', {}]])
  const state = {
    pluginPanelViewController: recorder('panelView'),
    pluginDeveloperModeWatcher: recorder('developerWatcher'),
    pluginBroker: recorder('broker'),
    pluginFeedController: {},
    pluginAgentStatusController: recorder('agentStatus'),
    pluginSecretsStore: {},
    pluginSecretConsentStore: {},
    pluginSettingsStore: {},
    pluginRuntimeContexts: {
      get size() { return contexts.size },
      clear: () => { calls.push('contexts.clear'); contexts.clear() },
    },
    pluginPreferencesSnapshot: {},
    pluginHostWindow: recorder('hostWindow'),
    pluginEventSourceController: recorder('eventSource'),
    pluginRegistry: null,
    pluginPreferences: null,
  }
  const runtime = createPluginRuntime(fakeService<PluginRuntimeDeps>({ state: fakeService<PluginRuntimeState>(state), electron: {} }))
  return { calls, state, runtime, contexts }
}

test('dispose releases plugin services in the established order', () => {
  const { calls, runtime } = setup()
  runtime.dispose()
  assert.deepEqual(calls, [
    'panelView.close',
    'developerWatcher.destroy',
    'broker.destroy',
    'agentStatus.destroy',
    'contexts.clear',
    'hostWindow.close',
    'eventSource.destroy',
  ])
})

test('dispose leaves every plugin slot empty and can run twice', () => {
  const { calls, state, runtime, contexts } = setup()
  runtime.dispose()
  const emptied = [
    'pluginPanelViewController', 'pluginDeveloperModeWatcher', 'pluginBroker', 'pluginFeedController',
    'pluginAgentStatusController', 'pluginSecretsStore', 'pluginSecretConsentStore', 'pluginSettingsStore',
    'pluginPreferencesSnapshot', 'pluginHostWindow', 'pluginEventSourceController',
  ] as const
  for (const key of emptied) assert.equal((state as Record<string, unknown>)[key], null, key)
  assert.equal(contexts.size, 0)
  const afterFirst = calls.length
  runtime.dispose()
  assert.deepEqual(calls.slice(afterFirst), ['contexts.clear'])
})

test('start is a no-op when plugin services already exist', async () => {
  for (const key of ['pluginRegistry', 'pluginPreferences', 'pluginHostWindow'] as const) {
    const { state, runtime } = setup()
    Object.assign(state, { pluginRegistry: null, pluginPreferences: null, pluginHostWindow: null, [key]: {} })
    const before = { ...state }
    await runtime.start()
    assert.deepEqual({ ...state }, before, key)
  }
})
