import assert from 'node:assert/strict'
import test from 'node:test'
import type { DesktopPreferences } from '../src/types/desktop.ts'
import { IPC_CHANNELS } from '../electron/ipc/channels.ts'
import { registerWindowControlsIpc, type WindowControlsIpcDependencies } from '../electron/ipc/window-controls.ts'
import { fakeBrowserWindow, fakeIpcMainEvent } from './support/fake-electron.mts'
import { createFakeIpcMain } from './support/fake-ipc.mts'

type FakeIpcMainPort = WindowControlsIpcDependencies['ipcMain']

/** 完整的 no-op 相依；各測試只覆寫自己關心的成員，避免用 partial 物件硬轉型。 */
function createDeps(ipcMain: FakeIpcMainPort, overrides: Partial<WindowControlsIpcDependencies>): WindowControlsIpcDependencies {
  return {
    ipcMain,
    isTrustedIpcSender: () => true,
    assertTrustedIpcSender: () => undefined,
    getPetWindow: () => null,
    getPanelWindow: () => null,
    // DesktopPreferences 欄位很多，受測程式只讀右鍵隱藏開關。
    getDesktopPreferences: () => ({ rightClickHideEnabled: true }) as unknown as DesktopPreferences,
    getPetWindowMode: () => 'normal',
    getNormalPetBounds: () => null,
    setNormalPetBounds: () => undefined,
    getEdgeRestoreBounds: () => null,
    setEdgeRestoreBounds: () => undefined,
    getAnchorBottomCenter: () => null,
    setAnchorBottomCenter: () => undefined,
    getPetContentHeight: () => null,
    setPetContentHeight: () => undefined,
    setPanelFullscreenAutoHidden: () => undefined,
    setPanelBlurLock: () => undefined,
    finiteNumber: value => typeof value === 'number' && Number.isFinite(value) ? value : null,
    requestPanelMinimum: () => undefined,
    resetPanelSize: () => undefined,
    getDisplayWorkArea: bounds => bounds,
    animateBounds: () => undefined,
    persistPetBounds: () => undefined,
    persistCurrentPetWindowState: () => undefined,
    repositionVisiblePanel: () => undefined,
    hidePetWindow: () => undefined,
    showPanelWindow: () => undefined,
    quit: () => undefined,
    relaunch: () => undefined,
    exit: () => undefined,
    setPresentationStatus: () => undefined,
    updatePluginAgentStatus: () => undefined,
    ...overrides,
  }
}

test('window control IPC keeps sender scopes, bounds clamps, and hidden-pet preferences', () => {
  const { ipcMain, listeners: handlers } = createFakeIpcMain()
  const calls: string[] = []
  const petWindow = fakeBrowserWindow({
    isVisible: () => true,
    hide: () => calls.push('pet-hide'),
    setIgnoreMouseEvents: (ignore: boolean) => calls.push(`passthrough:${ignore}`),
    getBounds: () => ({ x: 0, y: 0, width: 200, height: 200 }),
    getPosition: () => [0, 0] as [number, number],
    getSize: () => [200, 200] as [number, number],
  })
  const panelWindow = fakeBrowserWindow({
    isVisible: () => true,
    hide: () => calls.push('panel-hide'),
    getBounds: () => ({ x: 0, y: 0, width: 400, height: 500 }),
    setBounds: () => assert.fail('renderer resize must use the programmatic size path'),
  })
  let status: unknown = null
  registerWindowControlsIpc({
    // Click-through is disabled on Linux (PET-06); pin a supporting platform so CI on ubuntu matches.
    platform: 'darwin',
    ipcMain,
    isTrustedIpcSender: (_event, window) => window === petWindow || window === panelWindow,
    assertTrustedIpcSender: () => undefined,
    getPetWindow: () => petWindow,
    getPanelWindow: () => panelWindow,
    // DesktopPreferences 欄位很多，受測程式只讀右鍵隱藏開關。
    getDesktopPreferences: () => ({ rightClickHideEnabled: true }) as unknown as DesktopPreferences,
    getPetWindowMode: () => 'normal',
    getNormalPetBounds: () => null,
    setNormalPetBounds: () => undefined,
    getEdgeRestoreBounds: () => null,
    setEdgeRestoreBounds: () => undefined,
    getAnchorBottomCenter: () => null,
    setAnchorBottomCenter: () => undefined,
    getPetContentHeight: () => null,
    setPetContentHeight: height => calls.push(`content-height:${height}`),
    setPanelFullscreenAutoHidden: value => calls.push(`panel-auto-hidden:${value}`),
    setPanelBlurLock: lock => calls.push(`blur-lock:${JSON.stringify(lock)}`),
    finiteNumber: value => typeof value === 'number' && Number.isFinite(value) ? value : null,
    requestPanelMinimum: size => calls.push(`panel-minimum:${JSON.stringify(size)}`),
    resetPanelSize: () => calls.push('panel-reset-size'),
    getDisplayWorkArea: () => ({ x: 0, y: 0, width: 1_000, height: 800 }),
    animateBounds: bounds => calls.push(`pet-bounds:${JSON.stringify(bounds)}`),
    persistPetBounds: () => undefined,
    persistCurrentPetWindowState: () => undefined,
    repositionVisiblePanel: () => calls.push('reposition-panel'),
    hidePetWindow: () => calls.push('hide-pet'),
    showPanelWindow: () => calls.push('show-panel'),
    quit: () => calls.push('quit'),
    relaunch: () => calls.push('relaunch'),
    exit: code => calls.push(`exit:${code}`),
    setPresentationStatus: value => { status = value },
    updatePluginAgentStatus: () => calls.push('plugin-status'),
  })
  const send = (channel: string, ...args: unknown[]) => handlers.get(channel)?.(fakeIpcMainEvent(), ...args)
  assert.equal(handlers.size, 12)
  // 不是一般物件的 payload（含帶了同名欄位的陣列）一律當成沒給欄位，什麼都不做。
  const arrayWithFields = Object.assign([], { ignore: true, release: true, pinned: true, modal: true, width: 300, height: 300 })
  for (const malformed of [null, undefined, 'x', 7, true, [], arrayWithFields]) {
    for (const channel of [
      IPC_CHANNELS.petMousePassthrough,
      IPC_CHANNELS.panelResize,
      IPC_CHANNELS.panelBlurLock,
      IPC_CHANNELS.petResize,
      IPC_CHANNELS.petContentHeight,
    ]) send(channel, malformed)
  }
  assert.deepEqual(calls, [])
  send(IPC_CHANNELS.petMousePassthrough, { ignore: true })
  send(IPC_CHANNELS.petHideRequest)
  send(IPC_CHANNELS.panelResize, { width: 960, height: 800 })
  send(IPC_CHANNELS.panelResize, { width: 460, height: 720 })
  send(IPC_CHANNELS.panelResize, { width: 9_999, height: -1 })
  send(IPC_CHANNELS.panelResize, { width: 460, height: Number.NaN })
  send(IPC_CHANNELS.panelResize, { release: true })
  send(IPC_CHANNELS.panelResize, { release: 'yes' })
  send(IPC_CHANNELS.panelResetSize)
  send(IPC_CHANNELS.panelBlurLock, { pinned: true, modal: 'yes', extra: 1 })
  send(IPC_CHANNELS.panelBlurLock, { modal: false })
  send(IPC_CHANNELS.panelBlurLock, { pinned: 'x' })
  send(IPC_CHANNELS.panelHide)
  send(IPC_CHANNELS.petResize, { width: 2_000, height: 20 })
  send(IPC_CHANNELS.petContentHeight, { height: 1_800 })
  send(IPC_CHANNELS.petQuit)
  send(IPC_CHANNELS.petRestart)
  send(IPC_CHANNELS.presentationStatusUpdate, { dnd: true, activePets: [] })
  assert.deepEqual(calls, [
    'passthrough:true',
    'hide-pet',
    'panel-minimum:{"width":960,"height":800}',
    'panel-minimum:{"width":460,"height":720}',
    'panel-minimum:{"width":9999,"height":0}',
    'panel-minimum:null',
    'panel-reset-size',
    'blur-lock:{"pinned":true}',
    'blur-lock:{"modal":false}',
    'panel-auto-hidden:false',
    'panel-hide',
    'pet-bounds:{"x":0,"y":120,"width":1600,"height":80}',
    'content-height:1600',
    'reposition-panel',
    'quit',
    'relaunch',
    'exit:0',
    'plugin-status',
  ])
  assert.deepEqual(status, { activePets: [], dnd: true, enabled: true })
  assert.deepEqual([...handlers.keys()], [
    IPC_CHANNELS.petMousePassthrough,
    IPC_CHANNELS.petHideRequest,
    IPC_CHANNELS.panelToggle,
    IPC_CHANNELS.panelResize,
    IPC_CHANNELS.panelResetSize,
    IPC_CHANNELS.panelBlurLock,
    IPC_CHANNELS.panelHide,
    IPC_CHANNELS.petResize,
    IPC_CHANNELS.petContentHeight,
    IPC_CHANNELS.petQuit,
    IPC_CHANNELS.petRestart,
    IPC_CHANNELS.presentationStatusUpdate,
  ])
})


test('click-through is never enabled on Linux where mouse-move cannot be forwarded', () => {
  const { ipcMain, listeners } = createFakeIpcMain()
  const calls: string[] = []
  const petWindow = fakeBrowserWindow({
    setIgnoreMouseEvents: (ignore: boolean) => { calls.push(`passthrough:${ignore}`) },
  })
  registerWindowControlsIpc(createDeps(ipcMain, {
    platform: 'linux',
    getPetWindow: () => petWindow,
  }))
  const handler = listeners.get(IPC_CHANNELS.petMousePassthrough)
  handler?.(fakeIpcMainEvent(), { ignore: true })
  handler?.(fakeIpcMainEvent(), { ignore: false })
  assert.deepEqual(calls, ['passthrough:false'])
})

test('toggling the panel recreates it when no panel window exists yet or it was lost', () => {
  const { ipcMain, listeners } = createFakeIpcMain()
  const calls: string[] = []
  registerWindowControlsIpc(createDeps(ipcMain, {
    getPetWindow: () => fakeBrowserWindow(),
    showPanelWindow: view => { calls.push(`show:${view}`) },
  }))
  listeners.get(IPC_CHANNELS.panelToggle)?.(fakeIpcMainEvent())
  assert.deepEqual(calls, ['show:restore'])
})
