import assert from 'node:assert/strict'
import test from 'node:test'
import type { PluginSecretConsentStore } from '../electron/plugin-secret-consent.ts'
import type { PluginSecretsStore } from '../electron/plugin-secrets.ts'
import type { PluginSettingsStore } from '../electron/plugin-settings.ts'
import type { PluginBrokerContext } from '../electron/plugin-broker.ts'
import type { PluginPanelSettingsSnapshot } from '../src/types/plugin.ts'
import { registerPluginSettingsIpc, type PluginSettingsIpcDependencies } from '../electron/ipc/plugin-settings.ts'
import { fakeIpcMainInvokeEvent } from './support/fake-electron.mts'
import { createFakeIpcMain } from './support/fake-ipc.mts'
import { fakeService } from './support/fake-service.mts'


function fixture() {
  const { ipcMain, handlers } = createFakeIpcMain()
  const calls: string[] = []
  const panelEvent = fakeIpcMainInvokeEvent()
  let consented = false
  let secretConfigured = false
  // manifest 型別欄位龐大，這裡只放設定與 secrets 相關的欄位。
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
  const deps: PluginSettingsIpcDependencies = {
    ipcMain,
    assertPluginPanelSender: event => { if (event !== panelEvent) throw new Error('untrusted panel') },
    isPluginPanelPluginId: value => value === 'sample-plugin',
    getPluginContext: () => context,
    getSettingsStore: () => fakeService<PluginSettingsStore>(settingsStore),
    getSecretsStore: () => fakeService<PluginSecretsStore>(secretsStore),
    getSecretConsentStore: () => fakeService<PluginSecretConsentStore>(consentStore),
    notifySettingsChanged: (_pluginId, values) => calls.push(`settings:notify:${Object.keys(values).join(',')}`),
    pluginPanelError: () => 'plugin_action_failed',
  }
  registerPluginSettingsIpc(deps)
  return { handlers, panelEvent, calls, setConsented(value: boolean) { consented = value }, getSecretConfigured: () => secretConfigured }
}

test('settings IPC returns public values and only secret configuration flags', () => {
  const state = fixture()
  const getSettings = state.handlers.get('plugin-settings-get')!
  const result = getSettings(state.panelEvent, 'sample-plugin') as {
    ok: boolean
    value: PluginPanelSettingsSnapshot
  }
  assert.deepEqual(result, { ok: true, value: { values: { theme: 'dark' }, secrets: { accessToken: false } } })
  assert.throws(() => getSettings(fakeIpcMainInvokeEvent(), 'sample-plugin'), /untrusted panel/)
})

test('secret IPC requires consent and reports only configured state after storing', () => {
  const state = fixture()
  const setSecret = state.handlers.get('plugin-secret-set')!
  assert.deepEqual(setSecret(state.panelEvent, 'sample-plugin', 'accessToken', 'x'), {
    ok: false,
    error: 'secret_consent_required',
  })
  assert.deepEqual(state.calls, [])

  state.setConsented(true)
  assert.deepEqual(setSecret(state.panelEvent, 'sample-plugin', 'accessToken', 'x'), {
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
  assert.deepEqual(setSettings(state.panelEvent, 'unknown', {}), { ok: false, error: 'invalid_request' })
  assert.deepEqual(setSecret(state.panelEvent, 'sample-plugin', 'other', 'x'), { ok: false, error: 'not_permitted' })
  assert.deepEqual(setSecret(state.panelEvent, 'sample-plugin', 'accessToken', 2), { ok: false, error: 'invalid_request' })
})
