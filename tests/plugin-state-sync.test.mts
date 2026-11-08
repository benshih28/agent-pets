import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyPreferencePatch, createSerialQueue, mergePreferencesResult, rollbackPreferencePatch,
} from '../src/composables/plugin/plugin-state-sync.ts'

function snapshot() {
  const preference = { enabled: false, muted: false, rateLimitPer10Min: 5, targetPetId: null, grantedHosts: ['a.example'] }
  return {
    plugins: [{ id: 'one', preference: { ...preference } }, { id: 'two', preference: { ...preference } }],
    preferences: { plugins: { one: { ...preference }, two: { ...preference } } },
  } as never as Parameters<typeof applyPreferencePatch>[0]
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
  const state = snapshot() as unknown as Parameters<typeof mergePreferencesResult>[0]
  const next = { pluginsEnabled: true, plugins: { one: { enabled: true, muted: false, rateLimitPer10Min: 9, targetPetId: 'p', grantedHosts: [] } } }
  mergePreferencesResult(state, next as never)
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
