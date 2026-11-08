import assert from 'node:assert/strict'
import test from 'node:test'
import { pluginCapabilities } from '../src/utils/plugin-capabilities.ts'

test('capabilities follow a fixed order and ignore empty contributions', () => {
  assert.deepEqual(pluginCapabilities(null), [])
  assert.deepEqual(pluginCapabilities({ contributes: {}, permissions: {} } as never), [])
  assert.deepEqual(
    pluginCapabilities({
      contributes: { badge: true, panelView: {}, commands: [{}], tray: { commands: [] }, skins: [], eventSource: {} },
      permissions: { schedule: { minIntervalSec: 60 } },
    } as never),
    ['panel', 'commands', 'badge', 'eventSource', 'schedule'],
  )
})
