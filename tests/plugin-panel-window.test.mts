import assert from 'node:assert/strict'
import test from 'node:test'
import {
  layoutPluginPanelView,
  pluginPanelViewInsets,
  shouldRecordUserPanelSize,
  validatePluginPanelViewBounds,
} from '../electron/plugin-panel-window.ts'

test('wizard minimum is never persisted as the user size', () => {
  const base = { visible: true, supportsWillResize: true, lastUserResizeAt: 0, programmaticUntil: 0 }
  // Several resize events from one setBounds (or a min-size clamp): no will-resize, so none is recorded.
  const now = 10_000
  for (const offset of [0, 5, 40, 300]) {
    assert.equal(shouldRecordUserPanelSize({ ...base, now: now + offset, programmaticUntil: now + 500 }), false)
  }
  // A real drag emits will-resize shortly before each resize.
  assert.equal(shouldRecordUserPanelSize({ ...base, now: now + 100, lastUserResizeAt: now + 80 }), true)
  assert.equal(shouldRecordUserPanelSize({ ...base, now: now + 100, lastUserResizeAt: now + 80, visible: false }), false)
  // Without will-resize (Linux) a resize inside the programmatic window is ours.
  const linux = { ...base, supportsWillResize: false }
  assert.equal(shouldRecordUserPanelSize({ ...linux, now: now + 100, programmaticUntil: now + 500 }), false)
  assert.equal(shouldRecordUserPanelSize({ ...linux, now: now + 600, programmaticUntil: now + 500 }), true)
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

test('maximized plugin content bounds fit a typical 460 by 720 panel below the host header', () => {
  const frame = { x: 8, y: 8, width: 444, height: 704 }
  const content = { x: 9, y: 61, width: 442, height: 650 }
  assert.deepEqual(validatePluginPanelViewBounds(frame, content, { width: 460, height: 720 }), content)
})

test('plugin panel insets come from the renderer viewport and lay out against the live window size', () => {
  const insets = pluginPanelViewInsets({ x: 10, y: 60, width: 700, height: 500 }, { width: 720, height: 580 })
  assert.deepEqual(insets, { left: 10, top: 60, right: 10, bottom: 20 })
  assert.deepEqual(layoutPluginPanelView(insets, { width: 460, height: 720 }), { x: 10, y: 60, width: 440, height: 640 })
  assert.equal(layoutPluginPanelView(insets, { width: 20, height: 720 }), null)
  assert.equal(layoutPluginPanelView(insets, { width: 460, height: 80 }), null)
})
