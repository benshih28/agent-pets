import assert from 'node:assert/strict'
import test from 'node:test'
import { PluginBadgeController, type PluginBadgeContext } from '../electron/plugin-badges.ts'
import { summarizePluginBadgesForPet } from '../src/utils/plugin-badges.ts'

const pluginName = { 'zh-TW': '狀態徽章', 'en-US': 'Status Badge' }

function setup() {
  let now = 1_000
  let enabled = true
  let pluginsEnabled = true
  let contributesBadge = true
  let targetPetId: string | null = null
  const changes: unknown[][] = []
  const context = (): PluginBadgeContext => ({
    enabled,
    pluginsEnabled,
    contributesBadge,
    pluginName,
    targetPetId,
  })
  const controller = new PluginBadgeController({
    getContext: id => id === 'safe-plugin' ? context() : null,
    onChanged: badges => changes.push(badges),
    now: () => now,
  })
  return {
    controller,
    changes,
    setNow: (value: number) => { now = value },
    setEnabled: (value: boolean) => { enabled = value },
    setGlobal: (value: boolean) => { pluginsEnabled = value },
    setContribution: (value: boolean) => { contributesBadge = value },
    setTarget: (value: string | null) => { targetPetId = value },
  }
}

test('badge text counts Unicode code points and applies notification text cleanup', () => {
  const h = setup()
  assert.deepEqual(h.controller.set('safe-plugin', { text: '🧪🧪雲端', tone: 'warning' }), {
    ok: true, value: { set: true },
  })
  assert.equal(h.controller.list()[0].text, '🧪🧪雲端')
  assert.equal(h.controller.list()[0].tone, 'warning')
  h.setNow(2_000)
  assert.deepEqual(h.controller.set('safe-plugin', { text: '  OK\n嗎  ' }), {
    ok: true, value: { set: true },
  })
  assert.equal(h.controller.list()[0].text, 'OK 嗎')
  h.setNow(3_000)
  assert.deepEqual(h.controller.set('safe-plugin', { text: '🧪🧪🧪🧪🧪🧪🧪' }), {
    ok: false, error: 'invalid_request',
  })
  assert.deepEqual(h.controller.set('safe-plugin', { text: 'Ready', tone: 'danger' }), {
    ok: false, error: 'invalid_request',
  })
  assert.deepEqual(h.controller.set('safe-plugin', { text: 'Ready', extra: true }), {
    ok: false, error: 'invalid_request',
  })
})

test('badge updates are limited to one per plugin per second and null clears the badge', () => {
  const h = setup()
  assert.deepEqual(h.controller.set('safe-plugin', { text: 'ON' }), { ok: true, value: { set: true } })
  h.setNow(1_999)
  assert.deepEqual(h.controller.set('safe-plugin', { text: 'OFF' }), { ok: false, error: 'rate_limited' })
  h.setNow(2_000)
  assert.deepEqual(h.controller.set('safe-plugin', null), { ok: true, value: { set: false } })
  assert.deepEqual(h.controller.list(), [])
})

test('badges require an enabled plugin and a declared badge contribution; automatic clear bypasses rate limit', () => {
  const h = setup()
  assert.deepEqual(h.controller.set('unknown-plugin', { text: 'ON' }), { ok: false, error: 'disabled' })
  h.setContribution(false)
  assert.deepEqual(h.controller.set('safe-plugin', { text: 'ON' }), { ok: false, error: 'not_permitted' })
  h.setContribution(true)
  h.controller.set('safe-plugin', { text: 'ON' })
  h.setEnabled(false)
  h.controller.syncEnabledPlugins()
  assert.deepEqual(h.controller.list(), [])
  assert.equal(h.changes.length, 2)
})

test('each pet shows two matching badges and folds the rest into a plus-N count', () => {
  const entries = [
    ['safe-plugin', 'one', null],
    ['third-plugin', 'two', null],
    ['other-plugin', 'three', null],
    ['fourth-plugin', 'four', null],
    ['targeted-plugin', 'other', 'other-pet'],
  ] as const
  const badges = entries.map(([pluginId, text, targetPetId]) => ({
    pluginId,
    pluginName,
    text,
    tone: 'neutral' as const,
    targetPetId,
    updatedAt: 1,
  }))
  assert.deepEqual(summarizePluginBadgesForPet(badges, 'main-pet', 'main-pet'), {
    badges: badges.slice(0, 2),
    hiddenCount: 2,
  })
  assert.deepEqual(summarizePluginBadgesForPet(badges, 'other-pet', 'main-pet'), {
    badges: [badges[4]],
    hiddenCount: 0,
  })
})

test('badge target follows plugin targetPetId changes and clears when the global switch is off', () => {
  const h = setup()
  h.controller.set('safe-plugin', { text: 'ON' })
  h.setTarget('pet-two')
  h.controller.syncEnabledPlugins()
  assert.equal(h.controller.list()[0].targetPetId, 'pet-two')
  h.setGlobal(false)
  h.controller.syncEnabledPlugins()
  assert.deepEqual(h.controller.list(), [])
})

test('a crashed plugin badge is removed immediately without waiting for disable synchronization', () => {
  const h = setup()
  h.controller.set('safe-plugin', { text: 'ON' })
  h.controller.clearPlugin('safe-plugin')
  assert.deepEqual(h.controller.list(), [])
  assert.deepEqual(h.changes.at(-1), [])
})
