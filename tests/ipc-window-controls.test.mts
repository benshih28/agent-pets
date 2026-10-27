import assert from 'node:assert/strict'
import test from 'node:test'
import { IPC_CHANNELS } from '../electron/ipc/channels.ts'
import { registerWindowControlsIpc } from '../electron/ipc/window-controls.ts'

test('window control IPC keeps sender scopes, bounds clamps, and hidden-pet preferences', () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const calls: string[] = []
  const petWindow = {
    isVisible: () => true,
    hide: () => calls.push('pet-hide'),
    setIgnoreMouseEvents: (ignore: boolean) => calls.push(`passthrough:${ignore}`),
    getBounds: () => ({ x: 0, y: 0, width: 200, height: 200 }),
    getPosition: () => [0, 0] as [number, number],
    getSize: () => [200, 200] as [number, number],
  }
  const panelWindow = {
    isVisible: () => true,
    hide: () => calls.push('panel-hide'),
    getBounds: () => ({ x: 0, y: 0, width: 400, height: 500 }),
    setBounds: (bounds: unknown) => calls.push(`panel-bounds:${JSON.stringify(bounds)}`),
  }
  let status: unknown = null
  registerWindowControlsIpc({
    ipcMain: { on: (channel, handler) => { handlers.set(channel, handler) } },
    isTrustedIpcSender: (_event, window) => window === petWindow || window === panelWindow,
    assertTrustedIpcSender: () => undefined,
    getPetWindow: () => petWindow as never,
    getPanelWindow: () => panelWindow as never,
    getDesktopPreferences: () => ({ rightClickHideEnabled: true }) as never,
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
    finiteNumber: value => typeof value === 'number' && Number.isFinite(value) ? value : null,
    clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
    computePanelBounds: (height, width = 460) => ({ x: 1, y: 2, width, height }),
    panelMinWidth: 320,
    panelMaxWidth: 960,
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
  const send = (channel: string, ...args: unknown[]) => handlers.get(channel)?.({}, ...args)
  assert.equal(handlers.size, 10)
  send(IPC_CHANNELS.petMousePassthrough, { ignore: true })
  send(IPC_CHANNELS.petHideRequest)
  send(IPC_CHANNELS.panelHide)
  send(IPC_CHANNELS.petResize, { width: 2_000, height: 20 })
  send(IPC_CHANNELS.petContentHeight, { height: 1_800 })
  send(IPC_CHANNELS.petQuit)
  send(IPC_CHANNELS.petRestart)
  send(IPC_CHANNELS.presentationStatusUpdate, { dnd: true, activePets: [] })
  assert.deepEqual(calls, [
    'passthrough:true',
    'hide-pet',
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
    IPC_CHANNELS.panelHide,
    IPC_CHANNELS.petResize,
    IPC_CHANNELS.petContentHeight,
    IPC_CHANNELS.petQuit,
    IPC_CHANNELS.petRestart,
    IPC_CHANNELS.presentationStatusUpdate,
  ])
})
