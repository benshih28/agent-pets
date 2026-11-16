import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { fakeBrowserWindow, fakeDisplay, fakeWebContents } from './support/fake-electron.mts'
import { IPC_CHANNELS } from '../electron/ipc/channels.ts'
import { createPetWindowModeService, type PetWindowModeServiceState } from '../electron/main/pet-window-mode-service.ts'
import { EDGE_DWELL_MS, EDGE_REDOCK_AFTER_MS, edgeWindowBounds, miniWindowBounds, type WindowBounds } from '../electron/pet-window-mode.ts'

// 階段 11 之前在 electron/main/runtime.ts 內的寵物視窗模式行為，改由抽出的服務搭配
// 假螢幕、假視窗與 node:test 假計時器驗證。

const workArea = { x: 0, y: 0, width: 1920, height: 1080 }
const display = fakeDisplay(7, { ...workArea }, { ...workArea })
const centre: WindowBounds = { x: 800, y: 500, width: 260, height: 350 }
const leftEdge: WindowBounds = { x: 0, y: 500, width: 260, height: 350 }

function fakeWindow(label: string, log: string[], bounds: WindowBounds) {
  let current = { ...bounds }
  let destroyed = false
  const sent: unknown[] = []
  return {
    getBounds: () => ({ ...current }),
    setBounds: (next: WindowBounds) => { current = { ...next }; log.push(`${label}.setBounds`) },
    setIgnoreMouseEvents: (value: boolean) => log.push(`${label}.ignoreMouse:${value}`),
    isDestroyed: () => destroyed,
    destroy: () => { destroyed = true },
    /** 模擬使用者拖曳：不經過服務直接改 bounds。 */
    move: (next: WindowBounds) => { current = { ...next } },
    sent,
    webContents: fakeWebContents({
      send: (channel: string, ...args: unknown[]) => {
        log.push(`${label}.send:${channel}`)
        sent.push(args[0])
      },
    }),
  }
}

function setup(t: TestContext, options: { bounds?: WindowBounds; edgeModeEnabled?: boolean; permissionPending?: boolean } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
  const log: string[] = []
  const pet = fakeWindow('pet', log, options.bounds ?? centre)
  const panel = fakeWindow('panel', log, { x: 0, y: 0, width: 400, height: 600 })
  const writes: unknown[] = []
  const flags = { edgeModeEnabled: options.edgeModeEnabled ?? true, permissionPending: options.permissionPending ?? false }
  let cursor = { x: 5, y: 5 }
  let cursorReads = 0
  const state: PetWindowModeServiceState = {
    petWindow: fakeBrowserWindow(pet),
    panelWindow: fakeBrowserWindow(panel),
    dragPollHandle: null,
    shimejiPersistHandle: null,
    petWindowMode: 'normal',
    petWindowEdge: null,
    normalPetBounds: null,
    edgeRestoreBounds: null,
    edgeDwellHandle: null,
    edgeDwellCandidate: null,
  }
  const service = createPetWindowModeService({
    state,
    screen: {
      getDisplayMatching: () => display,
      getAllDisplays: () => [display],
      getPrimaryDisplay: () => display,
      getCursorScreenPoint: () => { cursorReads += 1; return cursor },
    },
    writeWindowState: value => { writes.push(value); log.push('writeWindowState') },
    edgeModeEnabled: () => flags.edgeModeEnabled,
    hasActivePermissionRequests: () => flags.permissionPending,
    repositionPanel: () => log.push('repositionPanel'),
    onVisibilityChanged: () => log.push('visibilityChanged'),
    onModeApplied: () => log.push('modeApplied'),
  })
  t.after(() => service.dispose())
  return {
    service, state, pet, panel, log, writes, flags,
    setCursor: (point: { x: number; y: number }) => { cursor = point },
    cursorReads: () => cursorReads,
  }
}

test('mini mode keeps the normal bounds and runs the mode-change side effects in order', t => {
  const { service, state, pet, log, writes } = setup(t)
  service.setMode('mini')
  assert.equal(state.petWindowMode, 'mini')
  assert.deepEqual(state.normalPetBounds, centre)
  assert.deepEqual(pet.getBounds(), miniWindowBounds(centre, workArea))
  assert.deepEqual(log, [
    'pet.ignoreMouse:false',
    'pet.setBounds',
    'repositionPanel',
    'writeWindowState',
    'visibilityChanged',
    `pet.send:${IPC_CHANNELS.petWindowModeUpdated}`,
    `panel.send:${IPC_CHANNELS.petWindowModeUpdated}`,
    'modeApplied',
  ])
  assert.deepEqual(writes.at(-1), {
    ...miniWindowBounds(centre, workArea),
    mode: 'mini',
    edge: undefined,
    displayId: display.id,
    displayBounds: display.bounds,
    normalBounds: centre,
  })
  service.toggleMini()
  assert.equal(state.petWindowMode, 'normal')
  assert.deepEqual(pet.getBounds(), centre)
})

test('a pending permission request keeps the pet full size', t => {
  const { service, state } = setup(t, { permissionPending: true })
  service.setMode('mini')
  assert.equal(state.petWindowMode, 'normal')
})

test('edge mode falls back to normal when the preference is off', t => {
  const { service, state } = setup(t, { bounds: leftEdge, edgeModeEnabled: false })
  service.applyEdgeBounds('left')
  assert.equal(state.petWindowMode, 'normal')
  assert.equal(state.petWindowEdge, null)
})

test('resting against an edge docks after the dwell and expands back to the exact bounds', t => {
  const { service, state, pet } = setup(t, { bounds: leftEdge })
  service.scheduleEdgeDwell()
  assert.deepEqual(state.edgeDwellCandidate, { displayId: display.id, edge: 'left' })
  t.mock.timers.tick(EDGE_DWELL_MS - 1)
  assert.equal(state.petWindowMode, 'normal')
  t.mock.timers.tick(1)
  assert.equal(state.petWindowMode, 'edge')
  assert.equal(state.petWindowEdge, 'left')
  assert.deepEqual(state.edgeRestoreBounds, leftEdge)
  assert.deepEqual(pet.getBounds(), edgeWindowBounds(leftEdge, workArea, 'left'))
  assert.deepEqual(service.modeState(), { mode: 'edge', edge: 'left' })
  service.setMode('normal')
  assert.deepEqual(pet.getBounds(), leftEdge)
  assert.equal(state.edgeRestoreBounds, null)
  assert.deepEqual(service.modeState(), { mode: 'normal' })
})

test('moving away from the edge before the dwell ends cancels the dock', t => {
  const { service, state, pet } = setup(t, { bounds: leftEdge })
  service.scheduleEdgeDwell()
  pet.move(centre)
  t.mock.timers.tick(EDGE_DWELL_MS)
  assert.equal(state.petWindowMode, 'normal')
  assert.equal(state.edgeDwellHandle, null)
  assert.equal(state.edgeDwellCandidate, null)
})

test('away from every edge no dwell is scheduled', t => {
  const { service, state } = setup(t)
  service.scheduleEdgeDwell()
  assert.equal(state.edgeDwellHandle, null)
})

test('after a hover-expand the pet re-docks once the cursor stays away', t => {
  const { service, state, setCursor } = setup(t, { bounds: leftEdge })
  setCursor({ x: 1500, y: 100 })
  service.scheduleEdgeRedock()
  t.mock.timers.tick(400)
  t.mock.timers.tick(EDGE_REDOCK_AFTER_MS)
  assert.ok(state.edgeDwellHandle, 'the re-dock hands over to the dwell timer')
  t.mock.timers.tick(EDGE_DWELL_MS)
  assert.equal(state.petWindowMode, 'edge')
})

test('a cursor over the pet keeps it expanded', t => {
  const { service, state, setCursor } = setup(t, { bounds: leftEdge })
  setCursor({ x: 10, y: 600 })
  service.scheduleEdgeRedock()
  t.mock.timers.tick(400 * 10)
  assert.equal(state.edgeDwellHandle, null)
  assert.equal(state.petWindowMode, 'normal')
})

test('dispose stops the re-dock poll and the dwell timer', t => {
  const { service, state, setCursor, cursorReads } = setup(t, { bounds: leftEdge })
  setCursor({ x: 1500, y: 100 })
  service.scheduleEdgeRedock()
  t.mock.timers.tick(400)
  const reads = cursorReads()
  assert.ok(reads > 0)
  service.dispose()
  t.mock.timers.tick(400 * 10)
  assert.equal(cursorReads(), reads)
  service.scheduleEdgeDwell()
  service.dispose()
  assert.equal(state.edgeDwellHandle, null)
  assert.equal(state.edgeDwellCandidate, null)
})

test('shimeji position writes are debounced', t => {
  const { service, state, writes } = setup(t)
  service.scheduleShimejiPositionPersist()
  service.scheduleShimejiPositionPersist()
  t.mock.timers.tick(1_999)
  assert.equal(writes.length, 0)
  t.mock.timers.tick(1)
  assert.equal(writes.length, 1)
  assert.equal(state.shimejiPersistHandle, null)
})

test('a display change re-clamps the current mode and broadcasts without touching the tray', t => {
  const { service, state, pet, log } = setup(t)
  service.setMode('mini')
  log.length = 0
  state.normalPetBounds = { x: 5000, y: 5000, width: 260, height: 350 }
  service.rehomeForDisplayChange()
  const clamped = { x: workArea.width - 260, y: workArea.height - 350, width: 260, height: 350 }
  assert.deepEqual(state.normalPetBounds, clamped)
  assert.deepEqual(pet.getBounds(), miniWindowBounds(clamped, workArea))
  assert.ok(!log.includes('modeApplied'))
  assert.ok(log.includes('writeWindowState'))
})

test('a destroyed pet window is left alone', t => {
  const { service, state, pet, log } = setup(t)
  pet.destroy()
  service.setMode('mini')
  service.rehomeForDisplayChange()
  service.persistCurrentState()
  assert.equal(state.petWindowMode, 'normal')
  assert.deepEqual(log, [])
})

test('saved window state prefers its display id, then its bounds, then the primary display', t => {
  const { service } = setup(t)
  assert.equal(service.displayForSavedState({ x: 0, y: 0, displayId: 7 }).id, 7)
  assert.equal(service.displayForSavedState(null).id, 7)
})

// restore()：建立視窗前還原上次模式（原 createPetWindow 內的行為）。
const restoreOptions = { fallbackSize: { width: 250, height: 232 }, primaryWorkArea: { ...workArea } }

test('restore without a saved state docks the default size at the primary bottom-right', t => {
  const { service, state } = setup(t)
  const bounds = service.restore(null, restoreOptions)
  assert.deepEqual(bounds, { x: 1920 - 250 - 30, y: 1080 - 232 - 30, width: 250, height: 232 })
  assert.deepEqual(state.normalPetBounds, bounds)
  assert.equal(state.petWindowMode, 'normal')
  assert.equal(state.petWindowEdge, null)
  assert.equal(state.edgeRestoreBounds, null)
})

test('restore uses the persisted size and falls back per missing dimension', t => {
  const { service } = setup(t)
  // 存檔缺寬度：寬度取預設，高度取存檔值（經 clampPetWindowDimension）。
  const bounds = service.restore({ x: 400, y: 300, height: 300 }, restoreOptions)
  assert.equal(bounds.x, 400)
  assert.equal(bounds.y, 300)
  assert.equal(bounds.width, 250)
  assert.equal(bounds.height, 300)
})

test('restore prefers the saved normal bounds and clamps them into the work area', t => {
  const { service, state } = setup(t)
  const bounds = service.restore({ x: 0, y: 0, normalBounds: { x: 5000, y: 5000, width: 260, height: 350 } }, restoreOptions)
  assert.equal(bounds.x + bounds.width <= 1920, true)
  assert.equal(bounds.y + bounds.height <= 1080, true)
  assert.deepEqual(state.normalPetBounds, bounds)
})

test('restore brings back mini mode with the mini bounds and keeps the normal bounds', t => {
  const { service, state } = setup(t)
  const bounds = service.restore({ x: 0, y: 0, mode: 'mini', normalBounds: centre }, restoreOptions)
  assert.equal(state.petWindowMode, 'mini')
  assert.equal(state.petWindowEdge, null)
  assert.equal(state.edgeRestoreBounds, null)
  assert.deepEqual(state.normalPetBounds, centre)
  assert.deepEqual(bounds, miniWindowBounds(centre, workArea))
})

test('restore brings back edge mode when still attached to the saved edge', t => {
  const { service, state } = setup(t)
  const bounds = service.restore({ x: 0, y: 500, mode: 'edge', edge: 'left', normalBounds: leftEdge }, restoreOptions)
  assert.equal(state.petWindowMode, 'edge')
  assert.equal(state.petWindowEdge, 'left')
  assert.deepEqual(state.edgeRestoreBounds, leftEdge)
  assert.deepEqual(bounds, edgeWindowBounds(leftEdge, workArea, 'left'))
})

test('restore infers the edge when the saved state has none', t => {
  const { service, state } = setup(t)
  service.restore({ x: 0, y: 500, mode: 'edge', normalBounds: leftEdge }, restoreOptions)
  assert.equal(state.petWindowMode, 'edge')
  assert.equal(state.petWindowEdge, 'left')
})

test('restore falls back to normal when the saved edge no longer matches', t => {
  const { service, state } = setup(t)
  const bounds = service.restore({ x: 0, y: 500, mode: 'edge', edge: 'right', normalBounds: leftEdge }, restoreOptions)
  assert.equal(state.petWindowMode, 'normal')
  assert.equal(state.petWindowEdge, null)
  assert.equal(state.edgeRestoreBounds, null)
  assert.deepEqual(bounds, leftEdge)
})

test('restore falls back to normal when the pet is no longer near an edge', t => {
  const { service, state } = setup(t)
  const bounds = service.restore({ x: 800, y: 500, mode: 'edge', edge: 'left', normalBounds: centre }, restoreOptions)
  assert.equal(state.petWindowMode, 'normal')
  assert.equal(state.petWindowEdge, null)
  assert.deepEqual(bounds, centre)
})

test('restore ignores a saved edge mode when the edge preference is off', t => {
  const { service, state } = setup(t, { edgeModeEnabled: false })
  const bounds = service.restore({ x: 0, y: 500, mode: 'edge', edge: 'left', normalBounds: leftEdge }, restoreOptions)
  assert.equal(state.petWindowMode, 'normal')
  assert.equal(state.petWindowEdge, null)
  assert.equal(state.edgeRestoreBounds, null)
  assert.deepEqual(bounds, leftEdge)
})
