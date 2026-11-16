import assert from 'node:assert/strict'
import test from 'node:test'
import type { DesktopPreferences } from '../src/types/desktop.ts'
import type { PetMotionIpcDependencies } from '../electron/ipc/pet-motion.ts'
import { registerPetMotionIpc } from '../electron/ipc/pet-motion.ts'
import { fakeBrowserWindow, fakeIpcMainEvent } from './support/fake-electron.mts'
import { createFakeIpcMain } from './support/fake-ipc.mts'

function fixture() {
  const { ipcMain, listeners } = createFakeIpcMain()
  // 以物件身分辨識來源，取代原本的字串哨兵。
  const petEvent = fakeIpcMainEvent()
  const foreignEvent = fakeIpcMainEvent()
  const calls: string[] = []
  let position: [number, number] = [100, 200]
  const size: [number, number] = [80, 80]
  let bounds = { x: 100, y: 200, width: 80, height: 80 }
  let cursor = { x: 10, y: 10 }
  let dragHandle: ReturnType<typeof setInterval> | null = null
  let intervalCallback: (() => void) | null = null
  // 只需要一個可用物件身分比對的 timer handle；立刻清掉，避免真的排程。
  const handle = setInterval(() => undefined, 60_000)
  clearInterval(handle)
  const pet = fakeBrowserWindow({
    getPosition: () => position,
    getSize: () => size,
    getBounds: () => bounds,
    setPosition: (x: number, y: number) => {
      position = [x, y]
      bounds = { ...bounds, x, y }
      calls.push(`position:${x},${y}`)
    },
    setBounds: (next: { x: number; y: number; width: number; height: number }) => {
      position = [next.x, next.y]
      bounds = { ...next }
      calls.push(`position:${next.x},${next.y}`)
    },
  })
  const panel = fakeBrowserWindow({ hide: () => { calls.push('panel:hide') } })
  const preferences = { shimejiEnabled: true, dndEnabled: false } as DesktopPreferences
  const deps: PetMotionIpcDependencies = {
    ipcMain,
    getPetWindow: () => pet,
    isTrustedIpcSender: event => event === petEvent,
    clearEdgeDwell: () => calls.push('edge:clear'),
    clearShimejiPersist: () => calls.push('persist:clear'),
    getDragPollHandle: () => dragHandle,
    setDragPollHandle: value => { dragHandle = value },
    setInterval: callback => { intervalCallback = callback; return handle },
    clearInterval: value => calls.push(`interval:clear:${value === handle}`),
    getCursorScreenPoint: () => cursor,
    getPetWindowMode: () => 'normal',
    applyNormalPetBounds: () => calls.push('mode:normal'),
    setEdgeRestoreBounds: value => { calls.push(`edge-restore:${value === null ? 'null' : 'set'}`) },
    setAnchorBottomCenter: value => { calls.push(`anchor:${value === null ? 'null' : 'set'}`) },
    getPanelWindow: () => panel,
    persistCurrentPetWindowState: () => calls.push('state:persist'),
    scheduleEdgeDwell: () => calls.push('edge:schedule'),
    getDesktopPreferences: () => preferences,
    hasActivePermissionRequests: () => false,
    currentPowerSaveState: () => false,
    displayForBounds: () => ({ id: 1, workArea: { x: -5_000, y: -5_000, width: 10_000, height: 10_000 } }),
    clampWindowBounds: target => target,
    setNormalPetBounds: value => { bounds = value ?? bounds; calls.push('bounds:save') },
    scheduleShimejiPositionPersist: () => calls.push('shimeji:persist'),
  }
  registerPetMotionIpc(deps)
  return {
    listeners,
    petEvent,
    foreignEvent,
    calls,
    deps,
    pet,
    setCursor(value: { x: number; y: number }) { cursor = value },
    getIntervalCallback: () => intervalCallback,
    getPosition: () => position,
    getBounds: () => bounds,
  }
}

test('pet drag IPC polls OS cursor coordinates and persists once when drag ends', () => {
  const state = fixture()
  const start = state.listeners.get('pet-drag-start')!
  start(state.foreignEvent)
  assert.equal(state.calls.length, 0)

  start(state.petEvent)
  assert.equal(state.getIntervalCallback() !== null, true)
  assert.deepEqual(state.calls.slice(0, 4), ['edge:clear', 'persist:clear', 'edge-restore:null', 'anchor:null'])
  assert.ok(state.calls.includes('panel:hide'))
  state.setCursor({ x: 15, y: 12 })
  state.getIntervalCallback()?.()
  assert.deepEqual(state.getPosition(), [105, 202])
  state.getIntervalCallback()?.()
  assert.equal(state.calls.filter(call => call === 'position:105,202').length, 1)

  // 陣列上就算帶了 moved 欄位也不算有效 payload，不排程貼邊。
  state.listeners.get('pet-drag-end')!(state.petEvent, Object.assign([], { moved: true }))
  assert.ok(!state.calls.includes('edge:schedule'))
  state.listeners.get('pet-drag-end')!(state.petEvent, { moved: true })
  assert.ok(state.calls.includes('state:persist'))
  assert.ok(state.calls.includes('edge:schedule'))
})

test('shimeji movement clamps one step and stops for DND', () => {
  const state = fixture()
  const walk = state.listeners.get('shimeji-walk-step')!
  walk(state.petEvent, Object.assign([], { deltaX: 100 }))
  walk(state.petEvent, 'x')
  assert.ok(!state.calls.includes('shimeji:persist'))
  walk(state.petEvent, { deltaX: 100 })
  assert.deepEqual(state.getPosition(), [124, 200])
  assert.ok(state.calls.includes('shimeji:persist'))

  state.deps.getDesktopPreferences().dndEnabled = true
  walk(state.petEvent, { deltaX: 20 })
  assert.deepEqual(state.getPosition(), [124, 200])
})
