import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { createPanelGeometry, type PanelGeometryState } from '../electron/main/panel-geometry.ts'
import type { PanelSizeStore } from '../electron/panel-size-store.ts'
import { PROGRAMMATIC_PANEL_RESIZE_WINDOW_MS } from '../electron/plugin-panel-window.ts'
import { fakeBrowserWindow, fakeDisplay } from './support/fake-electron.mts'
import { PANEL_HEIGHT, PANEL_MIN_HEIGHT, PANEL_MIN_WIDTH, PANEL_WIDTH } from '../src/utils/panel-layout.ts'

// 從 electron/main/runtime.ts 抽出的面板尺寸與定位，用假螢幕、假視窗與假尺寸檔驗證。

interface Rect { x: number; y: number; width: number; height: number }

const main = fakeDisplay(1, { x: 0, y: 0, width: 1920, height: 1080 }, { x: 0, y: 25, width: 1920, height: 1055 })
const side = fakeDisplay(2, { x: 1920, y: 0, width: 1280, height: 800 }, { x: 1920, y: 0, width: 1280, height: 800 })
const displays = [main, side]

function displayFor(rect: Rect) {
  const cx = rect.x + rect.width / 2
  return displays.find(d => cx >= d.bounds.x && cx < d.bounds.x + d.bounds.width) ?? main
}

function fakeWindow(initial: Rect, visible = true) {
  let bounds = { ...initial }
  const calls: string[] = []
  return {
    calls,
    getBounds: () => ({ ...bounds }),
    setBounds: (next: Rect) => { bounds = { ...next }; calls.push(`setBounds:${JSON.stringify(next)}`) },
    setResizable: (v: boolean) => calls.push(`resizable:${v}`),
    setMinimumSize: (w: number, h: number) => calls.push(`min:${w}x${h}`),
    setMaximumSize: (w: number, h: number) => calls.push(`max:${w}x${h}`),
    isDestroyed: () => false,
    isVisible: () => visible,
  }
}

function fakeStore(initial: { width: number; height: number } | null = null) {
  const saves: unknown[] = []
  const store = { load: () => initial, save: (v: unknown) => { saves.push(v) }, flush: () => {} }
  return { store: store as unknown as PanelSizeStore, saves }
}

function setup(t: TestContext, options: { pet?: Rect | null; panel?: Rect | null; stored?: { width: number; height: number } | null; visible?: boolean } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const pet = options.pet === null ? null : fakeWindow(options.pet ?? { x: 800, y: 700, width: 260, height: 350 })
  const panel = options.panel === null ? null : fakeWindow(options.panel ?? { x: 0, y: 0, width: PANEL_WIDTH, height: PANEL_HEIGHT }, options.visible ?? true)
  const state: PanelGeometryState = {
    petWindow: pet && fakeBrowserWindow(pet),
    panelWindow: panel && fakeBrowserWindow(panel),
    petContentHeight: null,
    panelUserSize: null,
    panelMinimumSize: null,
    panelSizeStore: null,
    panelSettleTimer: null,
    programmaticPluginPanelUntil: 0,
  }
  const { store, saves } = fakeStore(options.stored ?? null)
  let created = 0
  const geometry = createPanelGeometry({
    state,
    screen: {
      getDisplayMatching: rect => displayFor(rect),
      getPrimaryDisplay: () => main,
    },
    createSizeStore: () => { created += 1; return store },
  })
  return { geometry, state, pet, panel, saves, created: () => created }
}

test('without a pet window the panel opens at the primary work area origin, clamped', t => {
  const { geometry } = setup(t, { pet: null })
  assert.deepEqual(geometry.computePanelBounds(720), { x: 0, y: 25, width: PANEL_WIDTH, height: 720 })
  // 高度超過工作區時被夾進去。
  const tall = geometry.computePanelBounds(5000)
  assert.equal(tall.height < 1055, true)
})

test('the panel is placed above the pet and stays inside the pet display work area', t => {
  const { geometry } = setup(t)
  const bounds = geometry.computePanelBounds(400)
  assert.equal(bounds.y < 700, true)
  assert.equal(bounds.x >= main.workArea.x && bounds.x + bounds.width <= main.workArea.x + main.workArea.width, true)
})

test('a pet on the second monitor places the panel against that monitor work area', t => {
  const { geometry } = setup(t, { pet: { x: 2800, y: 400, width: 260, height: 350 } })
  const bounds = geometry.computePanelBounds(400)
  assert.equal(bounds.x >= side.workArea.x, true)
  assert.equal(bounds.x + bounds.width <= side.workArea.x + side.workArea.width, true)
})

test('the panel flips below the pet when there is no room above', t => {
  const { geometry } = setup(t, { pet: { x: 800, y: 30, width: 260, height: 350 } })
  const bounds = geometry.computePanelBounds(300)
  assert.equal(bounds.y >= 30, true)
  assert.equal(bounds.y + bounds.height <= main.workArea.y + main.workArea.height, true)
})

test('the size store is created once, lazily, and its saved size is loaded', t => {
  const { geometry, state, created } = setup(t, { stored: { width: 500, height: 640 } })
  assert.equal(created(), 0)
  assert.deepEqual(geometry.currentPanelSize(), { width: 500, height: 640 })
  geometry.currentPanelSize()
  assert.equal(created(), 1)
  assert.deepEqual(state.panelUserSize, { width: 500, height: 640 })
})

test('window limits follow the work area of the target display', t => {
  const { geometry, panel } = setup(t)
  geometry.applyPanelWindowLimits(side.workArea)
  assert.deepEqual(panel!.calls.slice(0, 3), ['resizable:true', `min:${PANEL_MIN_WIDTH}x${PANEL_MIN_HEIGHT}`, `max:${1280 - 6 * 2}x${800 - 6 * 2}`])
})

test('window limits are a no-op without a live panel', t => {
  const { geometry } = setup(t, { panel: null })
  assert.doesNotThrow(() => geometry.applyPanelWindowLimits())
  assert.doesNotThrow(() => geometry.setPluginPanelWindowBounds({ x: 0, y: 0, width: 400, height: 400 }))
})

test('setting panel bounds marks the resize as programmatic for a short window', t => {
  const { geometry, state, panel } = setup(t)
  const before = Date.now()
  geometry.setPluginPanelWindowBounds({ x: 10, y: 40, width: 480, height: 600 })
  assert.equal(state.programmaticPluginPanelUntil, before + PROGRAMMATIC_PANEL_RESIZE_WINDOW_MS)
  assert.equal(panel!.calls.at(-1), `setBounds:${JSON.stringify({ x: 10, y: 40, width: 480, height: 600 })}`)
})

test('a user drag is clamped, remembered, saved, and drops the wizard minimum', t => {
  const { geometry, state, saves } = setup(t)
  geometry.requestPanelMinimum({ width: 680, height: 520 })
  geometry.recordUserPanelSize({ width: 100, height: 100 })
  assert.deepEqual(state.panelUserSize, { width: PANEL_MIN_WIDTH, height: PANEL_MIN_HEIGHT })
  assert.equal(state.panelMinimumSize, null)
  assert.deepEqual(saves.at(-1), { width: PANEL_MIN_WIDTH, height: PANEL_MIN_HEIGHT })
  geometry.recordUserPanelSize({ width: 99999, height: 99999 })
  assert.equal(state.panelUserSize!.width <= 1920, true)
  assert.equal(state.panelUserSize!.height <= 1055, true)
})

test('once a drag settles the panel slides back inside the work area', t => {
  const { geometry, state, panel } = setup(t, { panel: { x: 1500, y: 600, width: 600, height: 700 } })
  geometry.recordUserPanelSize({ width: 600, height: 700 })
  assert.notEqual(state.panelSettleTimer, null)
  t.mock.timers.tick(250)
  assert.equal(state.panelSettleTimer, null)
  const last = panel!.calls.at(-1)!
  assert.match(last, /^setBounds:/)
  const bounds = JSON.parse(last.slice('setBounds:'.length)) as Rect
  assert.equal(bounds.x + bounds.width <= 1920, true)
  assert.equal(bounds.y + bounds.height <= 1080, true)
})

test('a rapid series of drags only settles once', t => {
  const { geometry, panel } = setup(t, { panel: { x: 1700, y: 400, width: 600, height: 700 } })
  geometry.recordUserPanelSize({ width: 600, height: 700 })
  t.mock.timers.tick(100)
  geometry.recordUserPanelSize({ width: 610, height: 700 })
  t.mock.timers.tick(200)
  assert.equal(panel!.calls.filter(c => c.startsWith('setBounds:')).length, 0)
  t.mock.timers.tick(50)
  assert.equal(panel!.calls.filter(c => c.startsWith('setBounds:')).length, 1)
})

test('a drag on a hidden panel does not move it', t => {
  const { geometry, panel } = setup(t, { panel: { x: 1700, y: 400, width: 600, height: 700 }, visible: false })
  geometry.recordUserPanelSize({ width: 600, height: 700 })
  t.mock.timers.tick(250)
  assert.equal(panel!.calls.some(c => c.startsWith('setBounds:')), false)
})

test('a minimum request raises the size but never touches the saved user size', t => {
  const { geometry, state, saves, panel } = setup(t, { stored: { width: 400, height: 500 } })
  geometry.requestPanelMinimum({ width: 680, height: 520 })
  assert.deepEqual(state.panelMinimumSize, { width: 680, height: 520 })
  assert.deepEqual(state.panelUserSize, { width: 400, height: 500 })
  assert.equal(saves.length, 0)
  assert.equal(geometry.currentPanelSize().width >= 680, true)
  assert.equal(panel!.calls.some(c => c.startsWith('setBounds:')), true)
  geometry.requestPanelMinimum(null)
  assert.equal(state.panelMinimumSize, null)
  geometry.requestPanelMinimum({ width: 680, height: 0 })
  assert.equal(state.panelMinimumSize, null)
})

test('a minimum request on a hidden panel does not resize it', t => {
  const { geometry, panel } = setup(t, { visible: false })
  geometry.requestPanelMinimum({ width: 680, height: 520 })
  assert.equal(panel!.calls.length, 0)
})

test('resetting the panel size clears the saved size and any minimum', t => {
  const { geometry, state, saves } = setup(t, { stored: { width: 500, height: 640 } })
  geometry.requestPanelMinimum({ width: 680, height: 520 })
  geometry.resetPanelSize()
  assert.equal(state.panelUserSize, null)
  assert.equal(state.panelMinimumSize, null)
  assert.deepEqual(saves.at(-1), null)
  assert.deepEqual(geometry.currentPanelSize(), { width: PANEL_WIDTH, height: PANEL_HEIGHT })
})

test('repositioning leaves a hidden panel alone', t => {
  const { geometry, panel } = setup(t, { visible: false })
  geometry.repositionVisiblePanel()
  assert.equal(panel!.calls.length, 0)
})

test('repositioning a visible panel re-applies the current size at the pet', t => {
  const { geometry, panel } = setup(t)
  geometry.repositionVisiblePanel()
  assert.equal(panel!.calls.some(c => c.startsWith('setBounds:')), true)
})
