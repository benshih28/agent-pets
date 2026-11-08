import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PANEL_GAP,
  PANEL_SIZES,
  computePanelPlacement,
  fitPanelHeight,
  shouldHidePanelOnBlur,
} from '../src/utils/panel-layout.ts'

const inside = (rect: { x: number; y: number; width: number; height: number }, area: { x: number; y: number; width: number; height: number }) =>
  rect.x >= area.x && rect.y >= area.y && rect.x + rect.width <= area.x + area.width && rect.y + rect.height <= area.y + area.height

test('panel sizes are expressed as {width, height} objects', () => {
  assert.deepEqual(PANEL_SIZES.settings, { width: 460, height: 720 })
  assert.equal(PANEL_SIZES.wizard.width, 680)
  assert.equal(PANEL_SIZES.mcp.width, 720)
})

test('fitPanelHeight shrinks to the work area and respects the minimum', () => {
  assert.equal(fitPanelHeight(720, 1000), 720)
  assert.equal(fitPanelHeight(720, 600), 600 - PANEL_GAP * 2)
  assert.equal(fitPanelHeight(50, 1000), 420)
})

test('panel bounds stay inside a short work area wherever the pet sits', () => {
  const workArea = { x: 0, y: 25, width: 1366, height: 600 }
  for (const petY of [25, 200, 420]) {
    const bounds = computePanelPlacement({
      petBounds: { x: 600, y: petY, width: 200, height: 180 },
      petContentHeight: 140,
      petHeadroom: 40,
      workArea,
      width: 460,
      height: 720,
    })
    assert.ok(inside(bounds, workArea), `pet at y=${petY} produced ${JSON.stringify(bounds)}`)
  }
})

test('panel prefers above the pet and falls back below near the top edge', () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1080 }
  const above = computePanelPlacement({ petBounds: { x: 800, y: 800, width: 200, height: 200 }, petContentHeight: 200, petHeadroom: 0, workArea, width: 460, height: 400 })
  assert.ok(above.y + above.height <= 800)
  const below = computePanelPlacement({ petBounds: { x: 800, y: 10, width: 200, height: 200 }, petContentHeight: 200, petHeadroom: 0, workArea, width: 460, height: 400 })
  assert.ok(below.y >= 210)
})

test('blur-hide is suspended by a pin, a modal flow, a native dialog or a pet click', () => {
  const idle = { dialogOpen: false, petFocused: false, pinned: false, modalOpen: false }
  assert.equal(shouldHidePanelOnBlur(idle), true)
  for (const key of ['dialogOpen', 'petFocused', 'pinned', 'modalOpen'] as const) {
    assert.equal(shouldHidePanelOnBlur({ ...idle, [key]: true }), false, key)
  }
})

test('dashboard and settings share one panel size so switching never resizes the window', () => {
  assert.deepEqual(PANEL_SIZES.sessions, PANEL_SIZES.settings)
})
