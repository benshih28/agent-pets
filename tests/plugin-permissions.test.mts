import assert from 'node:assert/strict'
import test from 'node:test'
import {
  groupPermissionUnits, installAcknowledgementReasons, parsePermissionUnit, permissionUnitsOfPlan, shouldFocusCancelOnInstall,
} from '../src/utils/plugin-permissions.ts'
import { nextTrapIndex } from '../src/utils/focus-trap.ts'

test('permission units are classified into network, data and display groups', () => {
  assert.deepEqual(parsePermissionUnit('network:api.example.com'), {
    unit: 'network:api.example.com', kind: 'network', detail: 'api.example.com', group: 'network', risk: 'high', known: true,
  })
  assert.equal(parsePermissionUnit('links:example.com').risk, 'high')
  assert.equal(parsePermissionUnit('secrets:token').group, 'data')
  assert.equal(parsePermissionUnit('storage').risk, 'medium')
  assert.equal(parsePermissionUnit('contributes:badge').group, 'display')
  assert.equal(parsePermissionUnit('contributes:skins:3').risk, 'low')
})

test('unknown permission units are never downgraded to low risk', () => {
  const entry = parsePermissionUnit('teleport:anywhere')
  assert.equal(entry.known, false)
  assert.equal(entry.risk, 'high')
  assert.equal(parsePermissionUnit('contributes:mystery').known, false)
})

test('groups are ordered network, data, display with the highest risk per group and high risk first', () => {
  const groups = groupPermissionUnits(['contributes:feed', 'storage', 'secrets:token', 'network:a.example', 'contributes:badge'])
  assert.deepEqual(groups.map(group => group.id), ['network', 'data', 'display'])
  assert.equal(groups[1].risk, 'high')
  assert.deepEqual(groups[1].entries.map(entry => entry.unit), ['secrets:token', 'storage'])
  assert.equal(groups[2].risk, 'low')
  assert.deepEqual(groupPermissionUnits([]), [])
})

test('plan permissions are flattened into the same unit strings the registry stores', () => {
  const units = permissionUnitsOfPlan({
    permissions: { network: { hosts: ['a.example'], userGranted: true }, links: { hosts: ['b.example'] }, storage: true, secrets: ['token'] },
    contributes: { feed: true, commands: [{ id: 'x', title: { 'zh-TW': 'x', 'en-US': 'x' } }] },
  } as never)
  assert.deepEqual(units, ['network:a.example', 'network:userGranted', 'links:b.example', 'storage', 'secrets:token', 'contributes:feed', 'contributes:commands'])
})

test('high-risk install changes require acknowledgement and default focus to cancel', () => {
  const base = { kind: 'update', addedPermissions: [] as string[], requiresReconsent: false } as const
  assert.deepEqual(installAcknowledgementReasons(null), [])
  assert.deepEqual(installAcknowledgementReasons({ ...base, signatureChange: 'unchanged' }), [])
  assert.deepEqual(installAcknowledgementReasons({ ...base, signatureChange: 'key-changed', requiresSignatureConfirmation: true }), ['signature-key-changed'])
  assert.deepEqual(installAcknowledgementReasons({ ...base, signatureChange: 'signed-to-unsigned', requiresSignatureConfirmation: true }), ['signature-removed'])
  assert.deepEqual(
    installAcknowledgementReasons({ ...base, signatureChange: 'unchanged', requiresReconsent: true, addedPermissions: ['network:x.example', 'secrets:t'] }),
    ['added-network', 'added-secrets'],
  )
  assert.equal(shouldFocusCancelOnInstall({ ...base, signatureChange: 'unchanged', requiresReconsent: true, addedPermissions: ['contributes:badge'] }), false)
  assert.equal(shouldFocusCancelOnInstall({ ...base, signatureChange: 'key-changed', requiresSignatureConfirmation: true }), true)
  assert.deepEqual(installAcknowledgementReasons({ kind: 'incompatible', addedPermissions: [], requiresReconsent: false }), [])
})

test('focus trap wraps in both directions and lets the browser handle the middle', () => {
  assert.equal(nextTrapIndex(0, -1, false), null)
  assert.equal(nextTrapIndex(3, 2, false), 0)
  assert.equal(nextTrapIndex(3, 0, true), 2)
  assert.equal(nextTrapIndex(3, 1, false), null)
  assert.equal(nextTrapIndex(3, -1, false), 0)
  assert.equal(nextTrapIndex(3, -1, true), 2)
})

test('every unit a manifest can produce is a known permission with copy in both locales', async () => {
  const { readFileSync } = await import('node:fs')
  const units = permissionUnitsOfPlan({
    permissions: { network: { hosts: ['a.example'], userGranted: true }, links: { hosts: ['b.example'] }, storage: true, agentStatus: true, schedule: { minIntervalSec: 60 }, secrets: ['token'] },
    contributes: {
      feed: true, reaction: true, panelView: { entry: 'a.html', title: {} }, commands: [{ id: 'x' }], tray: { commands: ['x'] },
      badge: true, skins: [{}, {}], eventSource: {},
    },
  } as never)
  assert.equal(units.length, 15)
  for (const unit of units) assert.equal(parsePermissionUnit(unit).known, true, `${unit} should be known`)
  for (const locale of ['zh-TW', 'en-US']) {
    const catalog = JSON.parse(readFileSync(new URL(`../src/locales/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>
    for (const key of [
      'pluginPermissionNetwork', 'pluginPermissionLinks', 'pluginPermissionStorage', 'pluginPermissionAgentStatus', 'pluginPermissionSchedule',
      'pluginPermissionSecret', 'pluginPermissionFeed', 'pluginPermissionReaction', 'pluginPermissionPanel', 'pluginPermissionCommands',
      'pluginPermissionTray', 'pluginPermissionBadge', 'pluginPermissionSkins', 'pluginPermissionEventSource',
    ]) assert.equal(typeof catalog[key], 'string', `${locale} is missing ${key}`)
  }
})
