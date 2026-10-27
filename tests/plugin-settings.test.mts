import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import test from 'node:test'
import { PluginSecretsStore } from '../electron/plugin-secrets.ts'
import { PluginSettingsStore, publishPluginSettingsChanged } from '../electron/plugin-settings.ts'
import { PluginSecretConsentStore, PLUGIN_SECRET_CONSENT_FILENAME } from '../electron/plugin-secret-consent.ts'
import type { PluginManifest } from '../src/types/plugin.ts'

const NAME = { 'zh-TW': '設定範例', 'en-US': 'Settings Sample' }
const manifest: PluginManifest = {
  id: 'sample', name: NAME, version: '1.0.0', apiVersion: '1', author: 'Test', entry: 'dist/main.js',
  permissions: { secrets: ['apiToken'] },
  contributes: { settings: { type: 'object', properties: {
    username: { type: 'string', title: NAME, maxLength: 30, default: 'guest' },
    refreshMinutes: { type: 'number', minimum: 1, maximum: 60, default: 10 },
    enabled: { type: 'boolean', default: true },
    mode: { type: 'string', enum: ['compact', 'detailed'], default: 'compact' },
    apiToken: { type: 'string', format: 'secret', maxLength: 100 },
  } } },
}

function fixture() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-settings-'))
  const dataDirectory = path.join(userData, 'plugins', 'sample', 'data')
  fs.mkdirSync(dataDirectory, { recursive: true })
  let encryptionAvailable = true
  const encryption = {
    isEncryptionAvailable: () => encryptionAvailable,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
    decryptString: (value: Buffer) => {
      const decoded = value.toString('utf8')
      if (!decoded.startsWith('encrypted:')) throw new Error('invalid ciphertext')
      return decoded.slice('encrypted:'.length)
    },
  }
  const secrets = new PluginSecretsStore(userData, encryption)
  const settings = new PluginSettingsStore(userData)
  return {
    userData, dataDirectory, secrets, settings,
    setEncryptionAvailable: (value: boolean) => { encryptionAvailable = value },
    cleanup: () => fs.rmSync(userData, { recursive: true, force: true }),
  }
}

test('secrets are encrypted at rest, only declared keys can be read, and the panel sees configured state only', () => {
  const state = fixture()
  try {
    state.secrets.set('sample', 'apiToken', 'private-token-123', manifest.permissions.secrets ?? [])
    const stored = fs.readFileSync(path.join(state.dataDirectory, 'secrets.json'), 'utf8')
    assert.equal(stored.includes('private-token-123'), false)
    assert.equal(state.secrets.get('sample', 'apiToken', ['apiToken']), 'private-token-123')
    assert.throws(() => state.secrets.get('sample', 'other', ['apiToken']), { code: 'not_permitted' })
    assert.deepEqual(state.secrets.listConfigured('sample', ['apiToken', 'refreshToken']), {
      apiToken: true, refreshToken: false,
    })
  } finally { state.cleanup() }
})

test('secrets fail closed when platform encryption is unavailable and empty input clears a secret', () => {
  const state = fixture()
  try {
    state.secrets.set('sample', 'apiToken', 'secret', ['apiToken'])
    state.setEncryptionAvailable(false)
    assert.throws(() => state.secrets.set('sample', 'apiToken', 'next', ['apiToken']), { code: 'secret_unavailable' })
    assert.throws(() => state.secrets.get('sample', 'apiToken', ['apiToken']), { code: 'secret_unavailable' })
    state.setEncryptionAvailable(true)
    state.secrets.set('sample', 'apiToken', '', ['apiToken'])
    assert.equal(state.secrets.has('sample', 'apiToken'), false)
  } finally { state.cleanup() }
})

test('startup, configured snapshots, and clearing an empty secret do not call safeStorage', () => {
  const state = fixture()
  let availabilityCalls = 0
  let encryptCalls = 0
  let decryptCalls = 0
  const countedSecrets = new PluginSecretsStore(state.userData, {
    isEncryptionAvailable: () => { availabilityCalls += 1; return true },
    encryptString: value => { encryptCalls += 1; return Buffer.from(`encrypted:${value}`) },
    decryptString: value => { decryptCalls += 1; return value.toString('utf8').slice('encrypted:'.length) },
  })
  try {
    assert.equal(availabilityCalls + encryptCalls + decryptCalls, 0)
    assert.deepEqual(countedSecrets.listConfigured('sample', ['apiToken']), { apiToken: false })
    assert.equal(countedSecrets.has('sample', 'apiToken'), false)
    assert.throws(() => countedSecrets.get('sample', 'apiToken', ['apiToken']), { code: 'secret_not_found' })
    fs.writeFileSync(path.join(state.dataDirectory, 'secrets.json'), JSON.stringify({ apiToken: '' }))
    assert.deepEqual(countedSecrets.listConfigured('sample', ['apiToken']), { apiToken: false })
    assert.throws(() => countedSecrets.get('sample', 'apiToken', ['apiToken']), { code: 'secret_not_found' })
    countedSecrets.set('sample', 'apiToken', '', ['apiToken'])
    assert.deepEqual({ availabilityCalls, encryptCalls, decryptCalls }, { availabilityCalls: 0, encryptCalls: 0, decryptCalls: 0 })
  } finally { state.cleanup() }
})

test('secret-only updates publish a fresh non-secret settings snapshot', () => {
  const state = fixture()
  const notifications: Array<{ pluginId: string; values: Record<string, string | number | boolean> }> = []
  const publish = (pluginId: string, values: Record<string, string | number | boolean>) => notifications.push({ pluginId, values })
  try {
    state.secrets.set('sample', 'apiToken', 'synthetic-secret', ['apiToken'])
    publishPluginSettingsChanged('sample', manifest, state.settings, publish)
    state.secrets.set('sample', 'apiToken', 'updated-synthetic-secret', ['apiToken'])
    publishPluginSettingsChanged('sample', manifest, state.settings, publish)
    state.secrets.set('sample', 'apiToken', '', ['apiToken'])
    publishPluginSettingsChanged('sample', manifest, state.settings, publish)
    assert.equal(notifications.length, 3)
    assert.deepEqual(notifications[0], {
      pluginId: 'sample', values: { username: 'guest', refreshMinutes: 10, enabled: true, mode: 'compact' },
    })
    assert.equal(JSON.stringify(notifications).includes('synthetic-secret'), false)
  } finally { state.cleanup() }
})

test('secret storage consent persists once and rejects a symlink marker', () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-secret-consent-'))
  const consent = new PluginSecretConsentStore(userData)
  const marker = path.join(userData, PLUGIN_SECRET_CONSENT_FILENAME)
  const target = path.join(userData, 'outside.json')
  fs.writeFileSync(target, '{}')
  try {
    assert.equal(consent.hasAccepted(), false)
    consent.accept()
    assert.equal(consent.hasAccepted(), true)
    fs.rmSync(marker)
    fs.symlinkSync(target, marker)
    assert.equal(consent.hasAccepted(), false)
    assert.throws(() => consent.accept(), { code: 'unsafe_file' })
    assert.equal(fs.readFileSync(target, 'utf8'), '{}')
  } finally { fs.rmSync(userData, { recursive: true, force: true }) }
})

test('secret storage rejects symlinked files without writing through them', () => {
  const state = fixture()
  const outside = path.join(state.userData, 'outside.json')
  fs.writeFileSync(outside, '{}')
  try {
    fs.symlinkSync(outside, path.join(state.dataDirectory, 'secrets.json'))
    assert.throws(() => state.secrets.set('sample', 'apiToken', 'never-written', ['apiToken']))
    assert.equal(fs.readFileSync(outside, 'utf8'), '{}')
  } finally { state.cleanup() }
})

test('settings return defaults and persist only validated non-secret values', () => {
  const state = fixture()
  try {
    assert.deepEqual(state.settings.get('sample', manifest), {
      username: 'guest', refreshMinutes: 10, enabled: true, mode: 'compact',
    })
    const saved = state.settings.set('sample', manifest, {
      username: 'Alice', refreshMinutes: 15, enabled: false, mode: 'detailed',
    })
    assert.deepEqual(saved, { username: 'Alice', refreshMinutes: 15, enabled: false, mode: 'detailed' })
    assert.deepEqual(state.settings.get('sample', manifest), saved)
    assert.equal(fs.existsSync(path.join(state.dataDirectory, 'secrets.json')), false)
  } finally { state.cleanup() }
})

test('settings reject secret fields, unknown keys, invalid types, enums, and out-of-range values', () => {
  const state = fixture()
  try {
    for (const invalid of [
      { apiToken: 'raw-secret' }, { unexpected: true }, { username: 2 },
      { mode: 'other' }, { refreshMinutes: 0 }, { username: 'x'.repeat(31) },
    ]) assert.throws(() => state.settings.set('sample', manifest, invalid), { code: 'settings_invalid' })
  } finally { state.cleanup() }
})

test('settings.get never returns a secret even if an old settings file contains its key', () => {
  const state = fixture()
  try {
    fs.writeFileSync(path.join(state.dataDirectory, 'settings.json'), JSON.stringify({ apiToken: 'plaintext', username: 'kept' }))
    assert.deepEqual(state.settings.get('sample', manifest), {
      username: 'kept', refreshMinutes: 10, enabled: true, mode: 'compact',
    })
  } finally { state.cleanup() }
})

test('settings reject a symlinked data directory and settings file', () => {
  const state = fixture()
  const outside = path.join(state.userData, 'outside')
  fs.mkdirSync(outside)
  try {
    fs.rmSync(path.join(state.dataDirectory, 'settings.json'), { force: true })
    fs.symlinkSync(path.join(outside, 'settings.json'), path.join(state.dataDirectory, 'settings.json'))
    assert.throws(() => state.settings.set('sample', manifest, { username: 'Alice' }))
    fs.rmSync(path.join(state.dataDirectory, 'settings.json'))
    fs.rmdirSync(state.dataDirectory)
    fs.symlinkSync(outside, state.dataDirectory)
    assert.throws(() => state.settings.set('sample', manifest, { username: 'Alice' }))
  } finally { state.cleanup() }
})
