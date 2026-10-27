import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PluginPanelViewController,
  PLUGIN_PANEL_MESSAGE_MAX_BYTES,
  PLUGIN_PANEL_PARTITION_PREFIX,
  isPluginPanelResourceAllowed,
  type PluginPanelNativeView,
  type PluginPanelViewCancelableEvent,
  type PluginPanelViewSession,
} from '../electron/plugin-panel-view.ts'
import { createPluginPanelPublicApi } from '../electron/plugin-panel-view-bridge.ts'
import { PluginUiMessageGuard } from '../electron/plugin-ui-messages.ts'

const token = '123e4567-e89b-42d3-a456-426614174000'
const initialBounds = { x: 8, y: 64, width: 480, height: 360 }

function fakeController(options: {
  loadURL?: (url: string, viewIndex: number) => Promise<void>
  onBlockedRequest?: (url: string) => void
  ackTimeoutMs?: number
  parentVisible?: boolean
} = {}) {
  let parentVisible = options.parentVisible ?? true
  let sessionPartition = ''
  let viewOptions: { webPreferences: Record<string, unknown> } | null = null
  let tokenSequence = 0
  let permissionRequest: ((contents: unknown, permission: string, callback: (allowed: boolean) => void) => void) | null = null
  let permissionCheck: ((...args: unknown[]) => boolean) | null = null
  let beforeRequest: ((details: { url: string; method?: string }, callback: (decision: { cancel: boolean }) => void) => void) | null = null
  let willDownload: ((event: PluginPanelViewCancelableEvent) => void) | null = null
  let openHandler: (() => { action: 'deny' }) | null = null
  let removeCount = 0
  const views: Array<{
    view: PluginPanelNativeView
    listeners: Map<string, (event?: PluginPanelViewCancelableEvent) => void>
    destroyed: boolean
    loadedUrl: string
    bounds: Array<{ x: number; y: number; width: number; height: number }>
    visibility: boolean[]
  }> = []
  const addedViews: PluginPanelNativeView[] = []
  const generatedTokens: string[] = []
  const revoked: Array<{ pluginId: string; token: string }> = []
  const apiRequests: Array<{ pluginId: string; method: string }> = []
  const sentMessages: unknown[] = []
  const closedEvents: Array<{ pluginId: string; openToken: number; reason: string }> = []
  const blockedRequestUrls: string[] = []

  const session = {
    protocol: { handle: () => {} },
    webRequest: { onBeforeRequest: (_filter: { urls: string[] }, listener: typeof beforeRequest) => { beforeRequest = listener } },
    setPermissionRequestHandler: (handler: typeof permissionRequest) => { permissionRequest = handler },
    setPermissionCheckHandler: (handler: typeof permissionCheck) => { permissionCheck = handler },
    on: (_event: 'will-download', listener: typeof willDownload) => { willDownload = listener },
  } as unknown as PluginPanelViewSession

  const parent = {
    isDestroyed: () => false,
    isVisible: () => parentVisible,
    addChildView: (view: PluginPanelNativeView) => { addedViews.push(view) },
    removeChildView: (_view: PluginPanelNativeView) => { removeCount += 1 },
  }

  const controller = new PluginPanelViewController({
    preloadPath: '/app/plugin-ui-preload.js',
    tokensCss: ':root {}',
    getParentWindow: () => parent,
    createSession: partition => { sessionPartition = partition; return session },
    createView: viewOptionsValue => {
      viewOptions = viewOptionsValue as unknown as { webPreferences: Record<string, unknown> }
      const state = {
        view: null as unknown as PluginPanelNativeView,
        listeners: new Map<string, (event?: PluginPanelViewCancelableEvent) => void>(),
        destroyed: false,
        loadedUrl: '',
        bounds: [] as Array<{ x: number; y: number; width: number; height: number }>,
        visibility: [] as boolean[],
      }
      const contents = {
        setWindowOpenHandler: (handler: typeof openHandler) => { openHandler = handler },
        on: (event: string, listener: (event?: PluginPanelViewCancelableEvent) => void) => { state.listeners.set(event, listener) },
        loadURL: async (url: string) => {
          state.loadedUrl = url
          await options.loadURL?.(url, views.length)
        },
        send: (_channel: string, data: unknown) => { sentMessages.push(data) },
        destroy: () => { state.destroyed = true },
        isDestroyed: () => state.destroyed,
      }
      state.view = {
        webContents: contents,
        setBounds: bounds => { state.bounds.push(bounds) },
        setVisible: visible => { state.visibility.push(visible) },
      } as unknown as PluginPanelNativeView
      views.push(state)
      return state.view
    },
    createToken: () => {
      tokenSequence += 1
      const value = tokenSequence === 1
        ? token
        : `123e4567-e89b-42d3-a456-${String(tokenSequence).padStart(12, '0')}`
      generatedTokens.push(value)
      return value
    },
    revokeToken: (pluginId, value) => revoked.push({ pluginId, token: value }),
    pluginRootForToken: value => generatedTokens.includes(value) ? '/plugin/sample/1.0.0' : null,
    messageGuard: new PluginUiMessageGuard(() => 10),
    onApiRequest: (pluginId, request) => {
      apiRequests.push({ pluginId, method: request.method })
      return { ok: true, value: { method: request.method } }
    },
    onClosed: event => closedEvents.push(event),
    ackTimeoutMs: options.ackTimeoutMs,
    onBlockedRequest: url => {
      blockedRequestUrls.push(url)
      options.onBlockedRequest?.(url)
    },
  })

  return {
    controller,
    parent,
    setParentVisible: (visible: boolean) => { parentVisible = visible },
    get sessionPartition() { return sessionPartition },
    get viewOptions() { return viewOptions },
    get loadedUrl() { return views[0]?.loadedUrl ?? '' },
    get addedView() { return addedViews.at(-1) ?? null },
    get destroyed() { return views[0]?.destroyed ?? false },
    get permissionRequest() { return permissionRequest },
    get permissionCheck() { return permissionCheck },
    get beforeRequest() { return beforeRequest },
    get willDownload() { return willDownload },
    get openHandler() { return openHandler },
    get removeCount() { return removeCount },
    get views() { return views },
    get addedViews() { return addedViews },
    get listeners() { return views[0]?.listeners ?? new Map() },
    get revoked() { return revoked },
    get apiRequests() { return apiRequests },
    get sentMessages() { return sentMessages },
    get closedEvents() { return closedEvents },
    get blockedRequestUrls() { return blockedRequestUrls },
  }
}

test('plugin panel uses an ephemeral plugin-specific WebContentsView and a token-scoped protocol', async () => {
  const fake = fakeController()
  const result = await fake.controller.open({ pluginId: 'sample-plugin', entry: 'ui/index.html', openToken: 1, bounds: initialBounds })
  assert.deepEqual(result, { ok: true, value: { opened: true, openToken: 1 } })
  assert.equal(fake.sessionPartition, `${PLUGIN_PANEL_PARTITION_PREFIX}sample-plugin`)
  assert.deepEqual(fake.viewOptions?.webPreferences, {
    preload: '/app/plugin-ui-preload.js',
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webviewTag: false,
    webSecurity: true,
    partition: 'plugin-ui-sample-plugin',
    devTools: false,
  })
  assert.equal(fake.loadedUrl, `agent-pets://plugin/${token}/ui/index.html`)
  assert.equal(fake.controller.activePluginId(), 'sample-plugin')

  const decisions: Array<{ url: string; method: string; cancel: boolean }> = []
  fake.beforeRequest?.({ url: fake.loadedUrl, method: 'GET' }, decision => decisions.push({ url: fake.loadedUrl, method: 'GET', cancel: decision.cancel }))
  fake.beforeRequest?.({ url: 'https://example.com/', method: 'GET' }, decision => decisions.push({ url: 'https://example.com/', method: 'GET', cancel: decision.cancel }))
  fake.beforeRequest?.({ url: `agent-pets://plugin/${token}/ui/app.js`, method: 'POST' }, decision => decisions.push({ url: 'post', method: 'POST', cancel: decision.cancel }))
  assert.deepEqual(decisions.map(item => item.cancel), [false, true, true])
  assert.deepEqual(fake.blockedRequestUrls, [
    'https://example.com/',
    `agent-pets://plugin/${token}/ui/app.js`,
  ])

  const deniedPermissions: boolean[] = []
  fake.permissionRequest?.({}, 'media', allowed => deniedPermissions.push(allowed))
  assert.deepEqual(deniedPermissions, [false])
  assert.equal(fake.permissionCheck?.({}, 'media'), false)
  let downloadPrevented = false
  fake.willDownload?.({ preventDefault: () => { downloadPrevented = true } })
  assert.equal(downloadPrevented, true)
  assert.deepEqual(fake.openHandler?.(), { action: 'deny' })

  for (const eventName of ['will-navigate', 'will-redirect', 'will-attach-webview']) {
    let blocked = false
    fake.listeners.get(eventName)?.({ preventDefault: () => { blocked = true } })
    assert.equal(blocked, true, eventName)
  }

  const contents = fake.addedView?.webContents
  const success = await fake.controller.handleApiRequest(contents, 'feed.notify', [{ title: 'ok' }])
  assert.deepEqual(success, { ok: true, value: { method: 'feed.notify' } })
  assert.deepEqual(fake.controller.postMessage('sample-plugin', { type: 'from-worker' }), { ok: true, value: { delivered: true } })
  assert.deepEqual(fake.controller.postMessage('another-plugin', { type: 'private' }), { ok: true, value: { delivered: false } })
  assert.deepEqual(fake.sentMessages, [{ type: 'from-worker' }])
  const forbidden = await fake.controller.handleApiRequest(contents, 'secrets.get', ['secret'])
  assert.deepEqual(forbidden, { ok: false, error: 'not_permitted' })
  assert.deepEqual(
    await fake.controller.handleApiRequest(contents, 'ui.postMessage', ['x'.repeat(PLUGIN_PANEL_MESSAGE_MAX_BYTES + 1)]),
    { ok: false, error: 'too_large' },
  )
  assert.deepEqual(fake.apiRequests, [{ pluginId: 'sample-plugin', method: 'feed.notify' }])
  assert.deepEqual(await fake.controller.handleApiRequest({}, 'storage.get', ['key']), { ok: false, error: 'not_permitted' })

  fake.controller.close()
  assert.deepEqual(fake.controller.postMessage('sample-plugin', { type: 'after-close' }), { ok: true, value: { delivered: false } })
  assert.equal(fake.destroyed, true)
  assert.equal(fake.removeCount, 1)
  assert.deepEqual(fake.revoked, [{ pluginId: 'sample-plugin', token }])
  assert.equal(fake.controller.activePluginId(), null)
  assert.deepEqual(fake.closedEvents, [{ pluginId: 'sample-plugin', openToken: 1, reason: 'closed' }])
})

test('plugin panel refuses to attach a view without valid frame bounds', async () => {
  const fake = fakeController()
  const result = await fake.controller.open({
    pluginId: 'sample-plugin', entry: 'ui/index.html', openToken: 1,
    bounds: { x: 0, y: 0, width: 0, height: 1 },
  })
  assert.deepEqual(result, { ok: false, error: 'invalid_request' })
  assert.equal(fake.views.length, 0)
  assert.equal(fake.addedViews.length, 0)
})

test('stale close after a rapid close-open cannot close the newer panel', async () => {
  let finishFirstLoad: (() => void) | null = null
  const firstLoad = new Promise<void>(resolve => { finishFirstLoad = resolve })
  const fake = fakeController({ loadURL: (_url, viewIndex) => viewIndex === 0 ? firstLoad : Promise.resolve() })
  const firstOpen = fake.controller.open({ pluginId: 'sample-plugin', entry: 'ui/index.html', openToken: 1, bounds: initialBounds })
  await Promise.resolve()
  fake.controller.close('closed', 1)

  const secondResult = await fake.controller.open({ pluginId: 'another-plugin', entry: 'ui/index.html', openToken: 2, bounds: initialBounds })
  assert.deepEqual(secondResult, { ok: true, value: { opened: true, openToken: 2 } })
  finishFirstLoad?.()
  assert.deepEqual(await firstOpen, { ok: false, error: 'disabled' })

  fake.controller.close('closed', 1)
  assert.equal(fake.controller.activePluginId(), 'another-plugin')
  assert.deepEqual(fake.closedEvents, [{ pluginId: 'sample-plugin', openToken: 1, reason: 'closed' }])
  fake.controller.close('closed', 2)
})

test('plugin panel remains hidden until the renderer acknowledges legal bounds', async () => {
  const fake = fakeController()
  const result = await fake.controller.open({
    pluginId: 'sample-plugin', entry: 'ui/index.html', openToken: 1, bounds: initialBounds,
  })
  assert.deepEqual(result, { ok: true, value: { opened: true, openToken: 1 } })
  assert.deepEqual(fake.views[0]?.visibility, [false])

  assert.equal(fake.controller.setBounds(1, { ...initialBounds, width: 0 }), false)
  assert.deepEqual(fake.views[0]?.visibility, [false])

  assert.equal(fake.controller.setBounds(1, initialBounds), true)
  assert.deepEqual(fake.views[0]?.visibility, [false, true])
  fake.controller.close()
})

test('plugin panel closes after the renderer bounds acknowledgement times out', async () => {
  const fake = fakeController({ ackTimeoutMs: 5 })
  await fake.controller.open({
    pluginId: 'sample-plugin', entry: 'ui/index.html', openToken: 1, bounds: initialBounds,
  })
  await new Promise(resolve => setTimeout(resolve, 25))

  assert.equal(fake.controller.activePluginId(), null)
  assert.equal(fake.views[0]?.visibility.includes(true), false)
  assert.equal(fake.views[0]?.destroyed, true)
  assert.deepEqual(fake.closedEvents, [{ pluginId: 'sample-plugin', openToken: 1, reason: 'renderer_unavailable' }])
})

test('plugin panel acknowledgement timeout starts before the renderer finishes loading', async () => {
  let finishLoading: (() => void) | undefined
  const fake = fakeController({
    ackTimeoutMs: 5,
    loadURL: () => new Promise(resolve => { finishLoading = resolve }),
  })
  const opening = fake.controller.open({
    pluginId: 'sample-plugin', entry: 'ui/index.html', openToken: 1, bounds: initialBounds,
  })
  await new Promise(resolve => setTimeout(resolve, 25))

  assert.equal(fake.controller.activePluginId(), null)
  assert.equal(fake.views[0]?.visibility.includes(true), false)
  assert.equal(fake.views[0]?.destroyed, true)
  assert.deepEqual(fake.closedEvents, [{ pluginId: 'sample-plugin', openToken: 1, reason: 'renderer_unavailable' }])

  finishLoading?.()
  assert.deepEqual(await opening, { ok: false, error: 'disabled' })
})

test('plugin panel closes when the host window is hidden', async () => {
  const fake = fakeController()
  await fake.controller.open({
    pluginId: 'sample-plugin', entry: 'ui/index.html', openToken: 1, bounds: initialBounds,
  })
  fake.setParentVisible(false)
  fake.controller.onPanelWindowHidden()

  assert.equal(fake.controller.activePluginId(), null)
  assert.deepEqual(fake.closedEvents, [{ pluginId: 'sample-plugin', openToken: 1, reason: 'hidden' }])
})

test('plugin panel closes when its host renderer reloads', async () => {
  const fake = fakeController()
  await fake.controller.open({
    pluginId: 'sample-plugin', entry: 'ui/index.html', openToken: 1, bounds: initialBounds,
  })
  fake.controller.onPanelRendererReload()

  assert.equal(fake.controller.activePluginId(), null)
  assert.deepEqual(fake.closedEvents, [{ pluginId: 'sample-plugin', openToken: 1, reason: 'renderer_unavailable' }])
})

test('plugin panel ignores bounds acknowledgements with a mismatched open token', async () => {
  const fake = fakeController()
  await fake.controller.open({
    pluginId: 'sample-plugin', entry: 'ui/index.html', openToken: 1, bounds: initialBounds,
  })
  assert.equal(fake.controller.setBounds(2, initialBounds), false)
  assert.deepEqual(fake.views[0]?.visibility, [false])
  assert.equal(fake.controller.activePluginId(), 'sample-plugin')
  fake.controller.close()
})

test('plugin panel refuses to open while the host window is hidden', async () => {
  const fake = fakeController({ parentVisible: false })
  const result = await fake.controller.open({
    pluginId: 'sample-plugin', entry: 'ui/index.html', openToken: 1, bounds: initialBounds,
  })
  assert.deepEqual(result, { ok: false, error: 'panel_unavailable' })
  assert.equal(fake.views.length, 0)
  assert.equal(fake.addedViews.length, 0)
})

test('plugin panel reports load failures and renderer crashes to the host', async () => {
  const loadFailure = fakeController({ loadURL: async () => { throw new Error('load failed') } })
  assert.deepEqual(
    await loadFailure.controller.open({ pluginId: 'sample-plugin', entry: 'ui/index.html', openToken: 1, bounds: initialBounds }),
    { ok: false, error: 'panel_load_failed' },
  )
  assert.deepEqual(loadFailure.closedEvents, [{ pluginId: 'sample-plugin', openToken: 1, reason: 'load_failed' }])
  assert.equal(loadFailure.controller.activePluginId(), null)

  const crashed = fakeController()
  await crashed.controller.open({ pluginId: 'sample-plugin', entry: 'ui/index.html', openToken: 1, bounds: initialBounds })
  crashed.views[0]?.listeners.get('render-process-gone')?.()
  assert.deepEqual(crashed.closedEvents, [{ pluginId: 'sample-plugin', openToken: 1, reason: 'renderer_crashed' }])
  assert.equal(crashed.controller.activePluginId(), null)

  const destroyed = fakeController()
  await destroyed.controller.open({ pluginId: 'sample-plugin', entry: 'ui/index.html', openToken: 1, bounds: initialBounds })
  destroyed.views[0]?.listeners.get('destroyed')?.()
  assert.deepEqual(destroyed.closedEvents, [{ pluginId: 'sample-plugin', openToken: 1, reason: 'destroyed' }])
  assert.equal(destroyed.controller.activePluginId(), null)
})

test('plugin panel request policy rejects external, cross-token, non-GET, and traversal requests', () => {
  assert.equal(isPluginPanelResourceAllowed(`agent-pets://plugin/${token}/ui/index.html`, token), true)
  assert.equal(isPluginPanelResourceAllowed('agent-pets://plugin/_shared/tokens.css', token), true)
  assert.equal(isPluginPanelResourceAllowed('https://example.com/', token), false)
  assert.equal(isPluginPanelResourceAllowed('agent-pets://plugin/other-token/ui/index.html', token), false)
  assert.equal(isPluginPanelResourceAllowed(`agent-pets://plugin/${token}/ui/index.html`, token, 'POST'), false)
  assert.equal(isPluginPanelResourceAllowed(`agent-pets://plugin/${token}/%2e%2e/secret.html`, token), false)
  assert.equal(isPluginPanelResourceAllowed(`agent-pets://plugin/${token}/ui/index.html?redirect=1`, token), false)
})

test('plugin panel preload bridge exposes only the approved API subset and unwraps coded errors', async () => {
  const messages = new Set<(data: unknown) => void>()
  const api = createPluginPanelPublicApi({
    invoke: async (method, args) => {
      if (method === 'feed.notify') return { ok: true, value: { itemId: 'item-1' } }
      if (method === 'ui.postMessage' && args[0] && typeof args[0] === 'object'
        && 'type' in args[0] && args[0].type === 'limited') return { ok: false, error: 'rate_limited' }
      if (method === 'ui.postMessage') return { ok: true, value: { delivered: true } }
      return { ok: false, error: 'not_permitted' }
    },
    onMessage: listener => { messages.add(listener); return () => messages.delete(listener) },
  })
  assert.deepEqual(Object.keys(api).sort(), ['feed', 'log', 'net', 'pet', 'settings', 'storage', 'ui'])
  assert.equal('secrets' in api, false)
  assert.equal('requestHost' in api.net, false)
  assert.deepEqual(await api.feed.notify({ title: 'test' }), { itemId: 'item-1' })
  assert.deepEqual(await api.ui.postMessage({ type: 'panel' }), { delivered: true })
  await assert.rejects(api.ui.postMessage({ type: 'limited' }), (error: unknown) => (
    error instanceof Error && 'code' in error && error.code === 'rate_limited'
  ))
  await assert.rejects(api.storage.get('key'), (error: unknown) => (
    error instanceof Error && 'code' in error && error.code === 'not_permitted'
  ))

  const received: unknown[] = []
  const dispose = api.ui.onMessage(value => received.push(value))
  for (const listener of messages) listener({ type: 'worker' })
  assert.deepEqual(received, [{ type: 'worker' }])
  dispose()
  assert.equal(messages.size, 0)
})


test('hiding the settings panel closes the view with a silent hidden reason', async () => {
  const fake = fakeController()
  const result = await fake.controller.open({ pluginId: 'sample-plugin', entry: 'panel/index.html', openToken: 1, bounds: initialBounds })
  assert.equal(result.ok, true)
  fake.controller.onPanelWindowHidden()
  assert.deepEqual(fake.closedEvents, [{ pluginId: 'sample-plugin', openToken: 1, reason: 'hidden' }])
})
