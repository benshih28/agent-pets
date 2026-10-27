import assert from 'node:assert/strict'
import test from 'node:test'
import type { IpcMainInvokeEvent } from 'electron'
import type { PluginBrokerContext } from '../electron/plugin-broker.ts'
import type { PluginPanelSettingsSnapshot } from '../src/types/plugin.ts'
import { registerPluginSettingsIpc, type PluginSettingsIpcDependencies } from '../electron/ipc/plugin-settings.ts'

function fixture() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const calls: string[] = []
  let consented = false
  let secretConfigured = false
  const manifest = {
    id: 'sample-plugin',
    name: { 'zh-TW': '範例', 'en-US': 'Sample' },
    contributes: {
      settings: { properties: {
        theme: { type: 'string', default: 'dark' },
        accessToken: { type: 'string', format: 'secret', maxLength: 32 },
      } },
    },
    permissions: { secrets: ['accessToken'] },
  } as unknown as PluginBrokerContext['manifest']
  const context = { manifest, enabled: true, pluginsEnabled: true, dndEnabled: false, storageBytesPerPlugin: 1024 }
  const settingsStore = {
    get: () => ({ theme: 'dark' }),
    set: (_pluginId: string, _manifest: unknown, value: unknown) => {
      calls.push('settings:set')
      return value as Record<string, string>
    },
  }
  const secretsStore = {
    listConfigured: () => ({ accessToken: secretConfigured }),
    set: (_pluginId: string, key: string, value: unknown) => {
      calls.push(`secret:set:${key}:${String(value)}`)
      secretConfigured = true
    },
    has: () => secretConfigured,
  }
  const consentStore = {
    hasAccepted: () => consented,
    accept: () => { consented = true },
  }
  const ipcMain = {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => { handlers.set(channel, handler) },
  } as unknown as PluginSettingsIpcDependencies['ipcMain']
  const deps: PluginSettingsIpcDependencies = {
    ipcMain,
    assertPluginPanelSender: event => { if (event !== 'panel') throw new Error('untrusted panel') },
    isPluginPanelPluginId: value => value === 'sample-plugin',
    getPluginContext: () => context,
    getSettingsStore: () => settingsStore as never,
    getSecretsStore: () => secretsStore as never,
    getSecretConsentStore: () => consentStore as never,
    notifySettingsChanged: (_pluginId, values) => calls.push(`settings:notify:${Object.keys(values).join(',')}`),
    pluginPanelError: () => 'plugin_action_failed',
  }
  registerPluginSettingsIpc(deps)
  return { handlers, calls, setConsented(value: boolean) { consented = value }, getSecretConfigured: () => secretConfigured }
}

test('settings IPC returns public values and only secret configuration flags', () => {
  const state = fixture()
  const getSettings = state.handlers.get('plugin-settings-get')!
  const result = getSettings('panel' as unknown as IpcMainInvokeEvent, 'sample-plugin') as {
    ok: boolean
    value: PluginPanelSettingsSnapshot
  }
  assert.deepEqual(result, { ok: true, value: { values: { theme: 'dark' }, secrets: { accessToken: false } } })
  assert.throws(() => getSettings('foreign' as unknown as IpcMainInvokeEvent, 'sample-plugin'), /untrusted panel/)
})

test('secret IPC requires consent and reports only configured state after storing', () => {
  const state = fixture()
  const setSecret = state.handlers.get('plugin-secret-set')!
  assert.deepEqual(setSecret('panel' as unknown as IpcMainInvokeEvent, 'sample-plugin', 'accessToken', 'x'), {
    ok: false,
    error: 'secret_consent_required',
  })
  assert.deepEqual(state.calls, [])

  state.setConsented(true)
  assert.deepEqual(setSecret('panel' as unknown as IpcMainInvokeEvent, 'sample-plugin', 'accessToken', 'x'), {
    ok: true,
    value: { configured: true },
  })
  assert.deepEqual(state.calls, ['secret:set:accessToken:x', 'settings:notify:theme'])
  assert.equal(state.getSecretConfigured(), true)
})

test('settings and secret IPC reject undeclared plugin ids, secret keys, and invalid values', () => {
  const state = fixture()
  const setSettings = state.handlers.get('plugin-settings-set')!
  const setSecret = state.handlers.get('plugin-secret-set')!
  assert.deepEqual(setSettings('panel' as unknown as IpcMainInvokeEvent, 'unknown', {}), { ok: false, error: 'invalid_request' })
  assert.deepEqual(setSecret('panel' as unknown as IpcMainInvokeEvent, 'sample-plugin', 'other', 'x'), { ok: false, error: 'not_permitted' })
  assert.deepEqual(setSecret('panel' as unknown as IpcMainInvokeEvent, 'sample-plugin', 'accessToken', 2), { ok: false, error: 'invalid_request' })
})
