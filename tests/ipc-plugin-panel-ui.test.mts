import assert from 'node:assert/strict'
import test from 'node:test'
import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron'
import { registerPluginPanelUiIpc, type PluginPanelUiIpcDependencies } from '../electron/ipc/plugin-panel-ui.ts'

function createFixture() {
  const handles = new Map<string, (...args: unknown[]) => unknown>()
  const listeners = new Map<string, (...args: unknown[]) => unknown>()
  const calls: string[] = []
  const window = {
    destroyed: false,
    visible: true,
    isDestroyed() { return this.destroyed },
    isVisible() { return this.visible },
    getContentBounds: () => ({ width: 500, height: 400 }),
  }
  const controller = {
    onPanelWindowHidden: () => calls.push('hidden'),
    close: (reason: string, token?: number) => calls.push(`close:${reason}:${token}`),
    setBounds: (token: number, bounds: unknown) => { calls.push(`bounds:${token}`); return Boolean(bounds) },
    handleApiRequest: (_sender: unknown, method: unknown) => ({ ok: true, method }),
  }
  const deps: PluginPanelUiIpcDependencies = {
    ipcMain: {
      handle: (channel, handler) => { handles.set(channel, handler as (...args: unknown[]) => unknown) },
      on: (channel, listener) => { listeners.set(channel, listener as (...args: unknown[]) => unknown) },
    } as PluginPanelUiIpcDependencies['ipcMain'],
    assertPluginPanelSender: event => { if (event !== 'panel') throw new Error('untrusted panel') },
    isTrustedIpcSender: (event, requiredWindow) => event === 'pet' && requiredWindow === window,
    isPluginPanelPluginId: value => typeof value === 'string' && /^[a-z0-9-]{3,48}$/.test(value),
    getPluginPanelSnapshot: () => ({ ok: true, value: { plugins: [] } }),
    invokePluginCommand: (pluginId, commandId) => ({ ok: true, pluginId, commandId }),
    openSequence: { value: 0 },
    openPluginPanelView: async (pluginId, token, frame, content) => ({ ok: true, pluginId, token, frame, content }),
    getPetWindow: () => window as never,
    getPluginPanelContext: () => ({ pluginsEnabled: true, enabled: true, manifest: { contributes: { panelView: true } } }),
    enabledPluginRoot: () => '/plugin-root',
    showPanelWindow: (_view, pluginId) => { calls.push(`show:${pluginId}`) },
    getPanelWindow: () => window as never,
    getPluginPanelViewController: () => controller as never,
    finiteNumber: value => typeof value === 'number' && Number.isFinite(value) ? value : null,
    readPluginPanelRect: value => value as never,
    validateBounds: () => ({ x: 1, y: 2, width: 30, height: 40 }),
  }
  registerPluginPanelUiIpc(deps)
  return { deps, handles, listeners, calls, window, controller }
}

test('plugin panel UI registrar checks panel senders and increments open tokens only for valid requests', async () => {
  const { handles, deps } = createFixture()
  const snapshot = handles.get('plugin-panel-snapshot')!
  assert.deepEqual(snapshot('panel' as unknown as IpcMainInvokeEvent), { ok: true, value: { plugins: [] } })
  assert.throws(() => snapshot('foreign' as unknown as IpcMainInvokeEvent), /untrusted panel/)

  const open = handles.get('plugin-panel-view-open')!
  assert.deepEqual(await open('panel' as unknown as IpcMainInvokeEvent, 'bad id', {}), { ok: false, error: 'invalid_request' })
  assert.equal(deps.openSequence.value, 0)
  assert.deepEqual(await open('panel' as unknown as IpcMainInvokeEvent, 'valid-plugin', { frame: 'frame', content: 'content' }), {
    ok: true,
    pluginId: 'valid-plugin',
    token: 1,
    frame: 'frame',
    content: 'content',
  })
  assert.equal(deps.openSequence.value, 1)
})

test('plugin panel view bounds hide, validate, and close through the injected controller', () => {
  const { listeners, calls, window } = createFixture()
  const bounds = listeners.get('plugin-panel-view-bounds')!
  bounds('panel' as unknown as IpcMainEvent, { openToken: 4, frame: {}, content: {} })
  assert.deepEqual(calls, ['bounds:4'])

  calls.length = 0
  window.visible = false
  bounds('panel' as unknown as IpcMainEvent, { openToken: 5 })
  assert.deepEqual(calls, ['hidden'])

  const close = listeners.get('plugin-panel-view-close')!
  close('panel' as unknown as IpcMainEvent, 6)
  assert.deepEqual(calls, ['hidden', 'close:closed:6'])
})

test('pet view requests require the pet sender and an enabled panel contribution', () => {
  const { handles, calls } = createFixture()
  const openFromPet = handles.get('plugin-panel-view-open-from-pet')!
  assert.equal(openFromPet('foreign' as unknown as IpcMainInvokeEvent, 'valid-plugin'), false)
  assert.equal(openFromPet('pet' as unknown as IpcMainInvokeEvent, 'valid-plugin'), true)
  assert.deepEqual(calls, ['show:valid-plugin'])
})

test('panel API denies subframes and delegates main-frame requests', () => {
  const { handles } = createFixture()
  const sender = { mainFrame: {}, send: () => undefined } as unknown as WebContents
  const api = handles.get('plugin-panel-api')!
  const childFrame = { sender, senderFrame: {} } as unknown as IpcMainInvokeEvent
  assert.deepEqual(api(childFrame, 'storage.get', []), { ok: false, error: 'not_permitted' })
  const mainFrame = { sender, senderFrame: sender.mainFrame } as unknown as IpcMainInvokeEvent
  assert.deepEqual(api(mainFrame, 'storage.get', []), { ok: true, method: 'storage.get' })
})
