import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clampPluginPanelSize,
  layoutPluginPanelView,
  pluginPanelViewInsets,
  PluginPanelWindowSizer,
  validatePluginPanelViewBounds,
} from '../electron/plugin-panel-window.ts'

test('plugin panel preferred and manual sizes stay within the display work area', () => {
  assert.deepEqual(clampPluginPanelSize({ width: 1200, height: 1000 }, { width: 900, height: 700 }), {
    width: 900,
    height: 700,
  })
  assert.deepEqual(clampPluginPanelSize({ width: 100, height: 100 }, { width: 200, height: 180 }), {
    width: 200,
    height: 180,
  })
})

test('manual size has priority for its plugin and leaving the view restores base panel size', () => {
  const sizer = new PluginPanelWindowSizer()
  assert.deepEqual(sizer.begin('sample-plugin', { width: 460, height: 720 }, { width: 800, height: 600 }, { width: 1200, height: 900 }), {
    width: 800,
    height: 600,
  })
  assert.equal(sizer.recordManualSize('sample-plugin', { width: 650, height: 480 }, { width: 1200, height: 900 }), true)
  assert.equal(sizer.recordManualSize('other-plugin', { width: 500, height: 500 }, { width: 1200, height: 900 }), false)
  assert.deepEqual(sizer.begin('other-plugin', { width: 800, height: 600 }, { width: 400, height: 300 }, { width: 1200, height: 900 }), {
    width: 400,
    height: 300,
  })
  assert.deepEqual(sizer.begin('sample-plugin', { width: 400, height: 300 }, { width: 900, height: 700 }, { width: 1200, height: 900 }), {
    width: 650,
    height: 480,
  })
  assert.deepEqual(sizer.finish(), { width: 460, height: 720 })
  assert.equal(sizer.activePluginId(), null)
})

test('native content bounds are restricted to the host frame below the chrome header', () => {
  const frame = { x: 20, y: 120, width: 500, height: 400 }
  assert.deepEqual(validatePluginPanelViewBounds(
    frame,
    { x: 32, y: 176, width: 476, height: 332 },
    { width: 600, height: 600 },
  ), { x: 32, y: 176, width: 476, height: 332 })
  assert.equal(validatePluginPanelViewBounds(
    frame,
    { x: 20, y: 120, width: 500, height: 400 },
    { width: 600, height: 600 },
  ), null)
  assert.equal(validatePluginPanelViewBounds(
    frame,
    { x: 32, y: 176, width: 600, height: 332 },
    { width: 600, height: 600 },
  ), null)
})

test('plugin panel insets come from the renderer viewport and lay out against the live window size', () => {
  const insets = pluginPanelViewInsets({ x: 10, y: 60, width: 700, height: 500 }, { width: 720, height: 580 })
  assert.deepEqual(insets, { left: 10, top: 60, right: 10, bottom: 20 })
  assert.deepEqual(layoutPluginPanelView(insets, { width: 460, height: 720 }), { x: 10, y: 60, width: 440, height: 640 })
  assert.equal(layoutPluginPanelView(insets, { width: 20, height: 720 }), null)
  assert.equal(layoutPluginPanelView(insets, { width: 460, height: 80 }), null)
})
