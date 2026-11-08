import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { PanelSizeStore } from '../electron/panel-size-store.ts'
import {
  PANEL_GAP,
  PANEL_MIN_HEIGHT,
  PANEL_MIN_WIDTH,
  PANEL_SIZES,
  clampPanelSize,
  clampRectToWorkArea,
  computePanelPlacement,
  effectivePanelSize,
  panelMaxSize,
  parsePanelUserSize,
  serializePanelUserSize,
} from '../src/utils/panel-layout.ts'
import { INITIAL_PANEL_ROUTE, panelResizeRequest, reducePanelRoute, type PanelRouteAction, type PanelRouteState } from '../src/utils/panel-route.ts'

test('a huge request is capped by the work area minus the gap, not by a fixed size', () => {
  const workArea = { width: 2560, height: 1440 }
  assert.deepEqual(clampPanelSize({ width: 99_999, height: 99_999 }, workArea), panelMaxSize(workArea))
  assert.deepEqual(panelMaxSize(workArea), { width: 2560 - PANEL_GAP * 2, height: 1440 - PANEL_GAP * 2 })
  assert.deepEqual(clampPanelSize({ width: 1800, height: 1000 }, workArea), { width: 1800, height: 1000 })
})

test('a tiny request is raised to the minimum, a tiny work area wins over the minimum', () => {
  const big = { width: 1920, height: 1080 }
  assert.deepEqual(clampPanelSize({ width: 10, height: 10 }, big), { width: PANEL_MIN_WIDTH, height: PANEL_MIN_HEIGHT })
  const tiny = { width: 300, height: 300 }
  const result = clampPanelSize({ width: 1000, height: 1000 }, tiny)
  assert.deepEqual(result, { width: 300 - PANEL_GAP * 2, height: 300 - PANEL_GAP * 2 })
  assert.deepEqual(clampPanelSize({ width: Number.NaN, height: 5 }, tiny).width, 288)
})

test('placement keeps a user-sized panel fully inside the work area', () => {
  const workArea = { x: 100, y: 40, width: 1280, height: 720 }
  for (const [w, h] of [[360, 420], [900, 600], [5000, 5000]]) {
    const rect = computePanelPlacement({
      petBounds: { x: 1100, y: 500, width: 200, height: 180 }, petContentHeight: 140, petHeadroom: 40, workArea, width: w, height: h,
    })
    assert.ok(rect.x >= workArea.x && rect.y >= workArea.y)
    assert.ok(rect.x + rect.width <= workArea.x + workArea.width && rect.y + rect.height <= workArea.y + workArea.height, JSON.stringify(rect))
  }
})

test('clampRectToWorkArea pulls a dragged window back in, and handles display changes', () => {
  const wa = { x: 0, y: 0, width: 1000, height: 800 }
  assert.deepEqual(clampRectToWorkArea({ x: 900, y: 700, width: 400, height: 500 }, wa), { x: 600, y: 300, width: 400, height: 500 })
  assert.deepEqual(clampRectToWorkArea({ x: -50, y: -50, width: 400, height: 500 }, wa), { x: 0, y: 0, width: 400, height: 500 })
  // moved to a smaller display: size shrinks to fit, position stays inside
  const small = { x: 0, y: 0, width: 640, height: 480 }
  const fitted = clampRectToWorkArea({ x: 500, y: 300, width: 900, height: 700 }, small)
  assert.deepEqual(fitted, { x: 0, y: 0, width: 640, height: 480 })
})

test('the effective size is the user size with a transient minimum that never shrinks it', () => {
  assert.deepEqual(effectivePanelSize(null, null), PANEL_SIZES.sessions)
  assert.deepEqual(effectivePanelSize({ width: 1200, height: 900 }, PANEL_SIZES.wizard), { width: 1200, height: 900 })
  assert.deepEqual(effectivePanelSize({ width: 400, height: 450 }, PANEL_SIZES.wizard), { width: 680, height: 520 })
  assert.deepEqual(effectivePanelSize({ width: 400, height: 450 }, null), { width: 400, height: 450 })
})

test('switching between dashboard, settings and plugin tabs never requests a resize', () => {
  const actions: PanelRouteAction[] = [
    { type: 'open-settings' }, { type: 'back-to-sessions' }, { type: 'open-settings' }, { type: 'back-to-sessions' },
  ]
  let state: PanelRouteState = INITIAL_PANEL_ROUTE
  for (const action of actions) {
    const next = reducePanelRoute(state, action)
    assert.equal(panelResizeRequest(state, next), null)
    state = next
  }
  // Only the overlays talk to the window, and closing one releases the minimum.
  const wizard = reducePanelRoute(state, { type: 'open-overlay', overlay: 'wizard' })
  assert.deepEqual(panelResizeRequest(state, wizard), PANEL_SIZES.wizard)
  assert.deepEqual(panelResizeRequest(wizard, reducePanelRoute(wizard, { type: 'close-overlay' })), { release: true })
  // The size every non-overlay route lands on is identical.
  const user = { width: 777, height: 555 }
  assert.deepEqual(effectivePanelSize(user, null), effectivePanelSize(user, null))
})

test('user size persists and round-trips through the store, and bad data is ignored', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-size-'))
  try {
    const file = path.join(dir, 'panel-size.json')
    const store = new PanelSizeStore(file, 10_000)
    assert.equal(store.load(), null)
    store.save({ width: 812.4, height: 640 })
    store.save({ width: 900, height: 700 })
    store.flush()
    assert.deepEqual(new PanelSizeStore(file).load(), { width: 900, height: 700 })
    store.save(null)
    store.flush()
    assert.equal(fs.existsSync(file), false)
    fs.writeFileSync(file, '{"version":1,"width":"wide","height":700}')
    assert.equal(new PanelSizeStore(file).load(), null)
    fs.writeFileSync(file, 'not json')
    assert.equal(new PanelSizeStore(file).load(), null)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
  assert.equal(parsePanelUserSize({ version: 2, width: 500, height: 500 }), null)
  assert.equal(parsePanelUserSize({ version: 1, width: 5, height: 500 }), null)
  assert.equal(parsePanelUserSize({ version: 1, width: 500, height: 1e9 }), null)
  assert.deepEqual(parsePanelUserSize(serializePanelUserSize({ width: 500.6, height: 421 })), { width: 501, height: 421 })
})
