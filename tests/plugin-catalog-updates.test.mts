import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildPluginCatalogPanelItems,
  comparePluginPermissionUnits,
  PluginCatalogAutoCheckSchedule,
} from '../electron/plugin-catalog-updates.ts'
import type { PluginCatalogDocument, PluginCatalogPlugin, PluginCatalogVersion } from '../src/types/plugin-catalog.ts'

function version(overrides: Partial<PluginCatalogVersion> = {}): PluginCatalogVersion {
  return {
    version: '2.0.0',
    apiVersion: '1',
    url: 'https://github.com/example/plugin/releases/download/v2.0.0/plugin.agentpet-plugin',
    sha256: 'a'.repeat(64),
    size: 100,
    publishedAt: '2026-10-26T00:00:00Z',
    ...overrides,
  }
}

function catalogPlugin(id: string, latest: PluginCatalogVersion, publicKeyFingerprint?: string): PluginCatalogPlugin {
  return {
    id,
    name: { 'zh-TW': id, 'en-US': id },
    description: { 'zh-TW': '測試', 'en-US': 'Test' },
    author: 'Example',
    ...(publicKeyFingerprint ? { publicKeyFingerprint } : {}),
    versions: [latest],
  }
}

test('catalog update candidates compare prereleases and report declared permission and signing-key changes', () => {
  const document: PluginCatalogDocument = {
    schemaVersion: 1,
    plugins: [
      catalogPlugin('sample-plugin', version({
        version: '1.0.0-beta.10',
      }), 'fedcba9876543210'),
      catalogPlugin('downgrade-plugin', version({ version: '1.0.0' })),
    ],
  }
  const items = buildPluginCatalogPanelItems(document, [
    {
      id: 'sample-plugin',
      currentVersion: '1.0.0-beta.2',
      grantedPermissions: { units: ['storage'] },
      signatureStatus: 'valid',
      signatureFingerprint: '0123456789abcdef',
      trustedKeyFingerprint: '0123456789abcdef',
    },
    { id: 'downgrade-plugin', currentVersion: '2.0.0', grantedPermissions: { units: [] } },
  ])
  const update = items.find(item => item.plugin.id === 'sample-plugin')
  const downgrade = items.find(item => item.plugin.id === 'downgrade-plugin')
  assert.equal(update?.updateAvailable, true)
  assert.equal(update?.permissionsIncreased, null)
  assert.equal(comparePluginPermissionUnits({ units: ['storage'] }, ['storage', 'secrets:token']), true)
  assert.equal(update?.signingKeyChange, 'changed')
  assert.equal(downgrade?.updateAvailable, false)
  assert.equal(downgrade?.catalogOlder, true)
})

test('catalog update comparison keeps unchanged and unknown metadata distinct', () => {
  const document: PluginCatalogDocument = {
    schemaVersion: 1,
    plugins: [
      catalogPlugin('same-plugin', version(), '0123456789abcdef'),
      catalogPlugin('unknown-plugin', version()),
    ],
  }
  const items = buildPluginCatalogPanelItems(document, [
    {
      id: 'same-plugin', currentVersion: '1.0.0', grantedPermissions: { units: ['storage'] },
      signatureStatus: 'valid', signatureFingerprint: '0123456789abcdef',
    },
    { id: 'unknown-plugin', currentVersion: '1.0.0', grantedPermissions: {} },
  ])
  assert.equal(items[0]?.permissionsIncreased, null)
  assert.equal(comparePluginPermissionUnits({ units: ['storage'] }, ['storage']), false)
  assert.equal(items[0]?.signingKeyChange, 'unchanged')
  assert.equal(items[1]?.permissionsIncreased, null)
  assert.equal(items[1]?.signingKeyChange, 'unknown')
  assert.equal(comparePluginPermissionUnits({}, ['storage']), null)
})

test('daily auto-check is limited to once per UTC day and reports one result', async () => {
  let now = Date.parse('2026-10-26T08:00:00Z')
  let lastCheckedDay: string | null = null
  let checks = 0
  const notifications: number[] = []
  const schedule = new PluginCatalogAutoCheckSchedule({
    isEnabled: () => true,
    getLastCheckedDay: () => lastCheckedDay,
    setLastCheckedDay: day => { lastCheckedDay = day },
    check: async () => { checks += 1; return 2 },
    notify: count => notifications.push(count),
    now: () => now,
  })
  assert.equal(await schedule.checkIfDue(), 'checked')
  assert.equal(await schedule.checkIfDue(), 'already-checked')
  assert.equal(checks, 1)
  assert.deepEqual(notifications, [2])
  now += 24 * 60 * 60 * 1_000
  assert.equal(await schedule.checkIfDue(), 'checked')
  assert.equal(checks, 2)
  assert.deepEqual(notifications, [2, 2])
})

test('daily auto-check remains opt-in and failures do not create repeated same-day attempts', async () => {
  let enabled = false
  let lastCheckedDay: string | null = null
  let checks = 0
  let notices = 0
  const schedule = new PluginCatalogAutoCheckSchedule({
    isEnabled: () => enabled,
    getLastCheckedDay: () => lastCheckedDay,
    setLastCheckedDay: day => { lastCheckedDay = day },
    check: async () => { checks += 1; throw new Error('fixture unavailable') },
    notify: () => { notices += 1 },
    now: () => Date.parse('2026-10-26T08:00:00Z'),
  })
  assert.equal(await schedule.checkIfDue(), 'disabled')
  enabled = true
  assert.equal(await schedule.checkIfDue(), 'failed')
  assert.equal(await schedule.checkIfDue(), 'already-checked')
  assert.equal(checks, 1)
  assert.equal(notices, 0)
})

test('daily auto-check rejects an out-of-range catalog result count', async () => {
  let lastCheckedDay: string | null = null
  let notices = 0
  const schedule = new PluginCatalogAutoCheckSchedule({
    isEnabled: () => true,
    getLastCheckedDay: () => lastCheckedDay,
    setLastCheckedDay: day => { lastCheckedDay = day },
    check: async () => 501,
    notify: () => { notices += 1 },
    now: () => Date.parse('2026-10-26T08:00:00Z'),
  })
  assert.equal(await schedule.checkIfDue(), 'failed')
  assert.equal(notices, 0)
})
