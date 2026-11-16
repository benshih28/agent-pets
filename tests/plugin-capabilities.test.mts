import assert from 'node:assert/strict'
import test from 'node:test'
import { pluginCapabilities } from '../src/utils/plugin-capabilities.ts'
import type { PluginLocalizedText } from '../src/types/plugin.ts'

const text: PluginLocalizedText = { 'zh-TW': 't', 'en-US': 't' }

test('capabilities follow a fixed order and ignore empty contributions', () => {
  assert.deepEqual(pluginCapabilities(null), [])
  assert.deepEqual(pluginCapabilities({ contributes: {}, permissions: {} }), [])
  assert.deepEqual(
    pluginCapabilities({
      contributes: {
        badge: true,
        panelView: { entry: 'panel/index.html', title: text },
        commands: [{ id: 'one', title: text }],
        tray: { commands: [] },
        skins: [],
        eventSource: { family: 'build', displayName: text },
      },
      permissions: { schedule: { minIntervalSec: 60 } },
    }),
    ['panel', 'commands', 'badge', 'eventSource', 'schedule'],
  )
})
