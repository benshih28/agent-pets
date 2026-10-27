import assert from 'node:assert/strict'
import test from 'node:test'
import {
  dispatchPluginUiMessage,
  PLUGIN_UI_MESSAGE_MAX_BYTES,
  PluginUiMessageGuard,
} from '../electron/plugin-ui-messages.ts'

test('UI message guard accepts JSON values and caps UTF-8 payloads at 256 KB', () => {
  const guard = new PluginUiMessageGuard(() => 10)
  assert.equal(guard.consume('sample-plugin', 'panel-to-worker', { type: 'ready', count: 2 }), null)
  assert.equal(guard.consume('sample-plugin', 'panel-to-worker', '界'.repeat(PLUGIN_UI_MESSAGE_MAX_BYTES / 3 + 1)), 'too_large')
  assert.equal(guard.consume('sample-plugin', 'panel-to-worker', undefined), 'invalid_request')
  assert.equal(guard.consume('sample-plugin', 'panel-to-worker', Number.NaN), 'invalid_request')
  const circular: { self?: unknown } = {}
  circular.self = circular
  assert.equal(guard.consume('sample-plugin', 'panel-to-worker', circular), 'invalid_request')
  assert.equal(guard.consume('_shared', 'panel-to-worker', { type: 'ready' }), 'invalid_request')
})

test('UI messages are limited to 20 per second per plugin and direction', () => {
  let now = 5_000
  const guard = new PluginUiMessageGuard(() => now)
  for (let index = 0; index < 20; index += 1) {
    assert.equal(guard.consume('sample-plugin', 'panel-to-worker', { index }), null)
  }
  assert.equal(guard.consume('sample-plugin', 'panel-to-worker', { index: 20 }), 'rate_limited')
  assert.equal(guard.consume('sample-plugin', 'worker-to-panel', { index: 20 }), null)
  assert.equal(guard.consume('other-plugin', 'panel-to-worker', { index: 20 }), null)
  now += 1_000
  assert.equal(guard.consume('sample-plugin', 'panel-to-worker', { index: 21 }), null)
})

test('UI message dispatch keeps both directions scoped, reports failures, and drops worker messages while closed', () => {
  const guard = new PluginUiMessageGuard(() => 10)
  const delivered: Array<{ pluginId: string; direction: string; value: unknown }> = []
  const dispatch = (pluginId: string, direction: 'panel-to-worker' | 'worker-to-panel', value: unknown, targetAvailable = true) => (
    dispatchPluginUiMessage({
      pluginId,
      direction,
      value,
      guard,
      targetAvailable,
      deliver: data => delivered.push({ pluginId, direction, value: data }),
    })
  )

  assert.deepEqual(dispatch('sample-plugin', 'worker-to-panel', { from: 'worker' }), { ok: true, value: { delivered: true } })
  assert.deepEqual(dispatch('sample-plugin', 'panel-to-worker', { from: 'panel' }), { ok: true, value: { delivered: true } })
  assert.deepEqual(dispatch('other-plugin', 'panel-to-worker', { from: 'other' }), { ok: true, value: { delivered: true } })
  assert.deepEqual(dispatch('sample-plugin', 'worker-to-panel', { from: 'worker' }, false), { ok: true, value: { delivered: false } })
  assert.deepEqual(dispatch('sample-plugin', 'panel-to-worker', { from: 'panel' }, false), { ok: false, error: 'disabled' })
  assert.deepEqual(dispatch('sample-plugin', 'worker-to-panel', '界'.repeat(PLUGIN_UI_MESSAGE_MAX_BYTES)), { ok: false, error: 'too_large' })
  assert.deepEqual(delivered, [
    { pluginId: 'sample-plugin', direction: 'worker-to-panel', value: { from: 'worker' } },
    { pluginId: 'sample-plugin', direction: 'panel-to-worker', value: { from: 'panel' } },
    { pluginId: 'other-plugin', direction: 'panel-to-worker', value: { from: 'other' } },
  ])
})

test('UI message dispatch turns delivery exceptions into coded disabled results', () => {
  const result = dispatchPluginUiMessage({
    pluginId: 'sample-plugin',
    direction: 'panel-to-worker',
    value: { type: 'message' },
    guard: new PluginUiMessageGuard(() => 10),
    targetAvailable: true,
    deliver: () => { throw new Error('port closed') },
  })
  assert.deepEqual(result, { ok: false, error: 'disabled' })
})
