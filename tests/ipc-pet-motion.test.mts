import assert from 'node:assert/strict'
import test from 'node:test'
import type { BrowserWindow, IpcMainEvent } from 'electron'
import type { DesktopPreferences } from '../src/types/desktop.ts'
import type { PetMotionIpcDependencies } from '../electron/ipc/pet-motion.ts'
import { registerPetMotionIpc } from '../electron/ipc/pet-motion.ts'

function fixture() {
  const listeners = new Map<string, (event: unknown, payload?: unknown) => void>()
  const calls: string[] = []
  let position: [number, number] = [100, 200]
  let size: [number, number] = [80, 80]
  let bounds = { x: 100, y: 200, width: 80, height: 80 }
  let cursor = { x: 10, y: 10 }
  let dragHandle: ReturnType<typeof setInterval> | null = null
  let intervalCallback: (() => void) | null = null
  const handle = 123 as unknown as ReturnType<typeof setInterval>
  const pet = {
    getPosition: () => position,
    getSize: () => size,
    getBounds: () => bounds,
    setPosition: (x: number, y: number) => {
      position = [x, y]
      bounds = { ...bounds, x, y }
      calls.push(`position:${x},${y}`)
    },
  } as unknown as BrowserWindow
  const panel = { hide: () => calls.push('panel:hide') } as unknown as BrowserWindow
  const preferences = { shimejiEnabled: true, dndEnabled: false } as DesktopPreferences
  const ipcMain = {
    on: (channel: string, listener: (...args: unknown[]) => unknown) => {
      listeners.set(channel, listener as (event: unknown, payload?: unknown) => void)
    },
  } as unknown as PetMotionIpcDependencies['ipcMain']
  const deps: PetMotionIpcDependencies = {
    ipcMain,
    getPetWindow: () => pet,
    isTrustedIpcSender: event => event === 'pet',
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
    displayForBounds: () => ({ id: 1, workArea: { x: 0, y: 0, width: 1200, height: 800 } }),
    clampWindowBounds: target => target,
    setNormalPetBounds: value => { bounds = value ?? bounds; calls.push('bounds:save') },
    scheduleShimejiPositionPersist: () => calls.push('shimeji:persist'),
  }
  registerPetMotionIpc(deps)
  return {
    listeners,
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
  start('foreign' as unknown as IpcMainEvent)
  assert.deepEqual(state.calls, [])

  start('pet' as unknown as IpcMainEvent)
  assert.equal(state.getIntervalCallback() !== null, true)
  assert.deepEqual(state.calls.slice(0, 4), ['edge:clear', 'persist:clear', 'edge-restore:null', 'anchor:null'])
  assert.ok(state.calls.includes('panel:hide'))
  state.setCursor({ x: 15, y: 12 })
  state.getIntervalCallback()?.()
  assert.deepEqual(state.getPosition(), [105, 202])
  state.getIntervalCallback()?.()
  assert.equal(state.calls.filter(call => call === 'position:105,202').length, 1)

  state.listeners.get('pet-drag-end')!('pet' as unknown as IpcMainEvent, { moved: true })
  assert.ok(state.calls.includes('state:persist'))
  assert.ok(state.calls.includes('edge:schedule'))
})

test('shimeji movement clamps one step and stops for DND', () => {
  const state = fixture()
  const walk = state.listeners.get('shimeji-walk-step')!
  walk('pet' as unknown as IpcMainEvent, { deltaX: 100 })
  assert.deepEqual(state.getPosition(), [124, 200])
  assert.ok(state.calls.includes('shimeji:persist'))

  state.deps.getDesktopPreferences().dndEnabled = true
  walk('pet' as unknown as IpcMainEvent, { deltaX: 20 })
  assert.deepEqual(state.getPosition(), [124, 200])
})
