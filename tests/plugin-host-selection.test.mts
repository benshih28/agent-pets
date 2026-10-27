import assert from 'node:assert/strict'
import test from 'node:test'
import { canEnablePluginWithinLimit, selectEnabledPluginDescriptors } from '../electron/plugin-host-selection.ts'

test('enabled plugin selection keeps the earliest plugins when stored preferences exceed the limit', () => {
  const candidates = [
    { id: 'first-plugin', entry: 'dist/main.js' },
    { id: 'second-plugin', entry: 'dist/main.js' },
    { id: 'third-plugin', entry: 'dist/main.js' },
  ]
  assert.deepEqual(selectEnabledPluginDescriptors(candidates, 2), {
    selected: candidates.slice(0, 2),
    skipped: candidates.slice(2),
  })
})

test('invalid enabled plugin limits fail closed without selecting a host descriptor', () => {
  const candidates = [{ id: 'first-plugin', entry: 'dist/main.js' }]
  assert.deepEqual(selectEnabledPluginDescriptors(candidates, 0), { selected: [], skipped: candidates })
})

test('enabling a new plugin is rejected at the configured limit while existing plugins stay enabled', () => {
  assert.equal(canEnablePluginWithinLimit(false, 10, 10), false)
  assert.equal(canEnablePluginWithinLimit(false, 9, 10), true)
  assert.equal(canEnablePluginWithinLimit(true, 10, 10), true)
})
