import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyPreferencePatch, createSerialQueue, mergePreferencesResult, rollbackPreferencePatch,
} from '../src/composables/plugin/plugin-state-sync.ts'
import { DEFAULT_PLUGIN_PREFERENCES } from '../electron/plugin-preferences.ts'
import type { PluginInstancePreferences, PluginPanelPlugin, PluginPreferences } from '../src/types/plugin.ts'

type Snapshot = Parameters<typeof mergePreferencesResult>[0]

function pluginOf(id: string, preference: PluginInstancePreferences): PluginPanelPlugin {
  return {
    id, currentVersion: '1.0.0', status: 'installed', installedAt: 1, grantedPermissions: {}, manifest: null, development: false,
    preference: { ...preference },
  }
}

function snapshot(): Snapshot {
  const preference: PluginInstancePreferences = { enabled: false, muted: false, rateLimitPer10Min: 5, targetPetId: null, grantedHosts: ['a.example'] }
  return {
    plugins: [pluginOf('one', preference), pluginOf('two', preference)],
    preferences: { ...DEFAULT_PLUGIN_PREFERENCES, plugins: { one: { ...preference }, two: { ...preference } } },
  }
}

test('optimistic patch updates both stores and returns only the overwritten fields', () => {
  const state = snapshot()
  const previous = applyPreferencePatch(state, 'one', { enabled: true, muted: true })
  assert.deepEqual(previous, { enabled: false, muted: false })
  assert.equal(state.plugins[0].preference.enabled, true)
  assert.equal(state.preferences.plugins.one.muted, true)
  assert.equal(state.plugins[1].preference.enabled, false)
})

test('rollback restores just the patched fields and leaves later edits alone', () => {
  const state = snapshot()
  const previous = applyPreferencePatch(state, 'one', { enabled: true })
  applyPreferencePatch(state, 'one', { muted: true })
  rollbackPreferencePatch(state, 'one', previous)
  assert.equal(state.plugins[0].preference.enabled, false)
  assert.equal(state.plugins[0].preference.muted, true)
})

test('main-process result replaces the preference map and per-plugin copies', () => {
  const state = snapshot()
  const next: PluginPreferences = { ...DEFAULT_PLUGIN_PREFERENCES, pluginsEnabled: true, plugins: { one: { enabled: true, muted: false, rateLimitPer10Min: 9, targetPetId: 'p', grantedHosts: [] } } }
  mergePreferencesResult(state, next)
  assert.equal(state.plugins[0].preference.rateLimitPer10Min, 9)
  assert.equal(state.plugins[1].preference.rateLimitPer10Min, 5)
  assert.equal(state.preferences, next)
})

test('serial queue runs same-key work in order and survives a failing task', async () => {
  const enqueue = createSerialQueue()
  const order: string[] = []
  const slow = enqueue('plugin:a', async () => { await new Promise(resolve => setTimeout(resolve, 15)); order.push('first') })
  const fails = enqueue('plugin:a', async () => { order.push('second'); throw new Error('nope') })
  const third = enqueue('plugin:a', async () => { order.push('third'); return 3 })
  const other = enqueue('plugin:b', async () => { order.push('other') })
  await other
  assert.deepEqual(order, ['other'])
  await slow
  await assert.rejects(fails)
  assert.equal(await third, 3)
  assert.deepEqual(order, ['other', 'first', 'second', 'third'])
})
