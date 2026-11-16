import assert from 'node:assert/strict'
import test from 'node:test'
import type { IpcMainEvent, WebContents, WebFrameMain } from 'electron'
import { DEFAULT_PLUGIN_PREFERENCES } from '../electron/plugin-preferences.ts'
import type { PluginPanelRect } from '../electron/plugin-panel-window.ts'
import { registerPluginPanelUiIpc, type PluginPanelUiIpcDependencies } from '../electron/ipc/plugin-panel-ui.ts'
import { fakeBrowserWindow, fakeIpcMainEvent, fakeIpcMainInvokeEvent, fakeWebContents } from './support/fake-electron.mts'
import { createFakeIpcMain } from './support/fake-ipc.mts'

// WebFrameMain 只用物件身分比對（主框架 vs 子框架），不需要真的實作。
function fakeFrame(): WebFrameMain {
  return {} as WebFrameMain
}

function createFixture() {
  const { ipcMain, handlers: handles, listeners } = createFakeIpcMain()
  const calls: string[] = []
  const panelEvent = fakeIpcMainEvent()
  const petEvent = fakeIpcMainEvent()
  const themes = new WeakMap<WebContents, unknown>()
  const window = {
    destroyed: false,
    visible: true,
    isDestroyed() { return this.destroyed },
    isVisible() { return this.visible },
    getContentBounds: () => ({ x: 0, y: 0, width: 500, height: 400 }),
  }
  // 桌寵視窗在受測程式裡只比對身分，與面板視窗共用同一組假成員即可。
  const petWindow = fakeBrowserWindow(window)
  const controller = {
    onPanelWindowHidden: () => calls.push('hidden'),
    close: (reason: string, token?: number) => calls.push(`close:${reason}:${token}`),
    setLayout: (token: number, insets: unknown, size: unknown) => {
      calls.push(`layout:${token}:${JSON.stringify(insets)}:${JSON.stringify(size)}`)
      return true
    },
    handleApiRequest: (_sender: WebContents, method: unknown) => ({ ok: true, method }),
    initialTheme: (sender: WebContents): unknown => themes.get(sender) ?? null,
  }
  const deps: PluginPanelUiIpcDependencies = {
    ipcMain,
    assertPluginPanelSender: event => { if (event !== panelEvent) throw new Error('untrusted panel') },
    isTrustedIpcSender: (event, requiredWindow) => event === petEvent && requiredWindow === petWindow,
    isPluginPanelPluginId: (value): value is string => typeof value === 'string' && /^[a-z0-9-]{3,48}$/.test(value),
    getPluginPanelSnapshot: () => ({ ok: true, value: { preferences: DEFAULT_PLUGIN_PREFERENCES, plugins: [] } }),
    invokePluginCommand: (pluginId, commandId) => ({ ok: true, pluginId, commandId }),
    openSequence: { value: 0 },
    openPluginPanelView: async (pluginId, token, frame, content) => ({ ok: true, pluginId, token, frame, content }),
    getPetWindow: () => petWindow,
    getPluginPanelContext: () => ({ pluginsEnabled: true, enabled: true, manifest: { contributes: { panelView: true } } }),
    enabledPluginRoot: () => '/plugin-root',
    showPanelWindow: (_view, pluginId) => { calls.push(`show:${pluginId}`) },
    getPanelWindow: () => window,
    getPluginPanelViewController: () => controller,
    finiteNumber: value => typeof value === 'number' && Number.isFinite(value) ? value : null,
    readPluginPanelRect: value => value as PluginPanelRect | null,
    validateBounds: (_frame, content, size) => content.x >= 0 && content.width <= size.width ? content : null,
  }
  registerPluginPanelUiIpc(deps)
  return { deps, handles, listeners, calls, window, controller, panelEvent, petEvent, themes }
}

test('plugin panel UI registrar checks panel senders and increments open tokens only for valid requests', async () => {
  const { handles, deps, panelEvent } = createFixture()
  const snapshot = handles.get('plugin-panel-snapshot')!
  assert.deepEqual(snapshot(panelEvent), { ok: true, value: { preferences: DEFAULT_PLUGIN_PREFERENCES, plugins: [] } })
  assert.throws(() => snapshot(fakeIpcMainInvokeEvent()), /untrusted panel/)

  const open = handles.get('plugin-panel-view-open')!
  assert.deepEqual(await open(panelEvent, 'bad id', {}), { ok: false, error: 'invalid_request' })
  assert.equal(deps.openSequence.value, 0)
  assert.deepEqual(await open(panelEvent, 'valid-plugin', { frame: 'frame', content: 'content' }), {
    ok: true,
    pluginId: 'valid-plugin',
    token: 1,
    frame: 'frame',
    content: 'content',
  })
  assert.equal(deps.openSequence.value, 1)
})

test('plugin panel view bounds hide, validate, and close through the injected controller', () => {
  const { listeners, calls, window, panelEvent } = createFixture()
  const bounds = listeners.get('plugin-panel-view-bounds')!
  bounds(panelEvent, {
    openToken: 4, frame: {}, content: { x: 1, y: 2, width: 30, height: 40 }, viewport: { width: 50, height: 60 },
  })
  assert.deepEqual(calls, ['layout:4:{"left":1,"top":2,"right":19,"bottom":18}:{"width":500,"height":400}'])

  calls.length = 0
  bounds(panelEvent, { openToken: 4, frame: {}, content: { x: 1, y: 2, width: 30, height: 40 } })
  bounds(panelEvent, {
    openToken: 4, frame: {}, content: { x: 1, y: 2, width: 30, height: 40 }, viewport: { width: 99_999, height: 60 },
  })
  assert.deepEqual(calls, [], 'reports without a sane renderer viewport are ignored')

  calls.length = 0
  window.visible = false
  bounds(panelEvent, { openToken: 5 })
  assert.deepEqual(calls, ['hidden'])

  const close = listeners.get('plugin-panel-view-close')!
  close(panelEvent, 6)
  assert.deepEqual(calls, ['hidden', 'close:closed:6'])
})

test('stale renderer bounds while shrinking are ignored instead of closing the plugin view', () => {
  const { listeners, calls, panelEvent } = createFixture()
  const bounds = listeners.get('plugin-panel-view-bounds')!
  // renderer 回報的仍是縮小前的大尺寸，但驗證只對照它自己量到的 viewport。
  bounds(panelEvent, {
    openToken: 7, frame: {}, content: { x: 10, y: 60, width: 700, height: 500 }, viewport: { width: 720, height: 580 },
  })
  assert.deepEqual(calls, ['layout:7:{"left":10,"top":60,"right":10,"bottom":20}:{"width":500,"height":400}'])

  calls.length = 0
  bounds(panelEvent, {
    openToken: 7, frame: {}, content: { x: 10, y: 60, width: 700, height: 500 }, viewport: { width: 300, height: 580 },
  })
  assert.equal(calls.some(call => call.startsWith('close:')), false)
})

test('pet view requests require the pet sender and an enabled panel contribution', () => {
  const { handles, calls, petEvent } = createFixture()
  const openFromPet = handles.get('plugin-panel-view-open-from-pet')!
  assert.equal(openFromPet(fakeIpcMainInvokeEvent(), 'valid-plugin'), false)
  assert.equal(openFromPet(petEvent, 'valid-plugin'), true)
  assert.deepEqual(calls, ['show:valid-plugin'])
})


test('panel API denies subframes and delegates main-frame requests', () => {
  const { handles } = createFixture()
  const mainFrame = fakeFrame()
  const sender = fakeWebContents({ mainFrame, send: () => undefined })
  const api = handles.get('plugin-panel-api')!
  const childFrame = fakeIpcMainInvokeEvent({ sender, senderFrame: fakeFrame() })
  assert.deepEqual(api(childFrame, 'storage.get', []), { ok: false, error: 'not_permitted' })
  const mainFrameEvent = fakeIpcMainInvokeEvent({ sender, senderFrame: mainFrame })
  assert.deepEqual(api(mainFrameEvent, 'storage.get', []), { ok: true, method: 'storage.get' })
})

test('the initial theme channel always answers synchronously and only the panel main frame gets a snapshot', () => {
  const { listeners, controller, themes } = createFixture()
  const initial = listeners.get('plugin-panel-theme-initial')!
  const mainFrame = fakeFrame()
  const sender = fakeWebContents({ mainFrame })
  themes.set(sender, { apiVersion: 1 })
  const call = (event: IpcMainEvent) => {
    initial(event)
    return event.returnValue
  }
  assert.equal(call(fakeIpcMainEvent({ sender, senderFrame: fakeFrame() })), null, 'subframe')
  assert.deepEqual(call(fakeIpcMainEvent({ sender, senderFrame: mainFrame })), { apiVersion: 1 })
  const plainFrame = fakeFrame()
  const plain = fakeWebContents({ mainFrame: plainFrame })
  assert.equal(call(fakeIpcMainEvent({ sender: plain, senderFrame: plainFrame })), null, 'not the open view')
  controller.initialTheme = () => { throw new Error('boom') }
  assert.equal(call(fakeIpcMainEvent({ sender, senderFrame: mainFrame })), null, 'controller failure still answers')
})
