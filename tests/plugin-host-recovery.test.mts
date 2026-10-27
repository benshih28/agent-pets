import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PluginHostFailureTracker,
  PLUGIN_HOST_HEALTHY_RUNTIME_MS,
  pluginHostRetryDelay,
  shouldRetryPluginHost,
} from '../electron/plugin-host-recovery.ts'

test('host load failures retry with backoff and stop after three failed windows', async () => {
  const tracker = new PluginHostFailureTracker(() => 0)
  const delays: number[] = []
  let factoryCalls = 0
  const windowFactory = () => {
    factoryCalls += 1
    return { load: async () => { throw new Error('load failed') } }
  }

  while (true) {
    const window = windowFactory()
    await assert.rejects(window.load(), /load failed/)
    const failures = tracker.record('sample-plugin')
    if (!shouldRetryPluginHost(failures)) break
    delays.push(pluginHostRetryDelay(failures))
  }

  assert.equal(factoryCalls, 3)
  assert.deepEqual(delays, [250, 1_000])
  assert.equal(tracker.count('sample-plugin'), 3)
})

test('watchdog failure counts reset only after a pong and 60 seconds of runtime', () => {
  let now = 10_000
  const tracker = new PluginHostFailureTracker(() => now)
  assert.equal(tracker.record('sample-plugin'), 1)
  now += PLUGIN_HOST_HEALTHY_RUNTIME_MS + 1
  assert.equal(tracker.resetAfterHealthyRuntime('sample-plugin', 10_000, false), false)
  assert.equal(tracker.count('sample-plugin'), 1)
  assert.equal(tracker.resetAfterHealthyRuntime('sample-plugin', 10_000, true), true)
  assert.equal(tracker.count('sample-plugin'), 0)
})

test('an early pong does not reset a failure count before stable runtime reaches 60 seconds', () => {
  let now = 59_999
  const tracker = new PluginHostFailureTracker(() => now)
  tracker.record('sample-plugin')
  assert.equal(tracker.resetAfterHealthyRuntime('sample-plugin', 0, true), false)
  now += 1
  assert.equal(tracker.resetAfterHealthyRuntime('sample-plugin', 0, true), true)
})
