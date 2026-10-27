import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isCurrentPluginPanelViewClose,
  pluginPanelViewCloseError,
} from '../src/utils/plugin-panel-view.ts'
import type { PluginPanelViewClosedEvent } from '../src/types/plugin.ts'

test('stale plugin panel close events cannot hide a newer panel frame', () => {
  const oldEvent: PluginPanelViewClosedEvent = {
    pluginId: 'old-plugin',
    openToken: 4,
    reason: 'closed',
  }
  assert.equal(isCurrentPluginPanelViewClose(oldEvent, 'new-plugin', 5), false)
  assert.equal(isCurrentPluginPanelViewClose(oldEvent, 'old-plugin', 5), false)
  assert.equal(isCurrentPluginPanelViewClose(oldEvent, 'old-plugin', 4), true)
})

test('panel close events map to localized status error codes', () => {
  assert.equal(pluginPanelViewCloseError('load_failed'), 'panel_load_failed')
  assert.equal(pluginPanelViewCloseError('renderer_crashed'), 'panel_crashed')
  assert.equal(pluginPanelViewCloseError('renderer_unavailable'), 'panel_unavailable')
  assert.equal(pluginPanelViewCloseError('disabled'), 'disabled')
  assert.equal(pluginPanelViewCloseError('closed'), 'panel_closed')
  assert.equal(pluginPanelViewCloseError('destroyed'), 'panel_closed')
  assert.equal(pluginPanelViewCloseError('hidden'), 'hidden')
})
