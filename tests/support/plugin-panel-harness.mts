// 在 Node 掛載真的 `usePluginPanelController()`：以最小的自訂 renderer 讓 onMounted／onUnmounted
// 真的執行，假的 window／document／ResizeObserver／HTMLElement，可記錄呼叫與訂閱的 electronAPI，
// 以及 node:test 的假計時器（setTimeout／Date）。每個測試呼叫 `mountPluginPanel()`，結束時 `unmount()`。
import './src-alias.mts'
import { mock } from 'node:test'
import { createRenderer, defineComponent, nextTick, reactive } from 'vue'
import type {
  PluginPanelPlugin,
  PluginPanelSnapshot,
  PluginPreferences,
} from '../../src/types/plugin.ts'

export const START_TIME = Date.UTC(2026, 10, 10, 8, 0, 0)

export interface ApiCall { name: string; args: unknown[] }

type ApiOverride = (...args: never[]) => unknown

// --- 假 DOM -----------------------------------------------------------------

interface Rect { left: number; top: number; width: number; height: number }

export class FakeHTMLElement {
  isConnected = true
  scrollTop = 0
  focusCount = 0
  name: string
  rect: Rect
  scrollParent: FakeHTMLElement | null
  constructor(name: string, rect: Rect = { left: 0, top: 0, width: 0, height: 0 }, scrollParent: FakeHTMLElement | null = null) {
    this.name = name
    this.rect = rect
    this.scrollParent = scrollParent
  }
  getBoundingClientRect(): DOMRect {
    const { left, top, width, height } = this.rect
    return { left, top, width, height, x: left, y: top, right: left + width, bottom: top + height, toJSON: () => ({}) } as DOMRect
  }
  closest(): FakeHTMLElement | null { return this.scrollParent }
  focus(): void {
    this.focusCount += 1
    fakeDocument.activeElement = this
  }
}

interface Listener { fn: (event: unknown) => void; capture: boolean }

class FakeWindow {
  electronAPI: unknown = undefined
  innerWidth = 460
  innerHeight = 720
  outerWidth = 460
  outerHeight = 720
  screen = { availWidth: 1512, availHeight: 944 }
  readonly listeners = new Map<string, Listener[]>()
  addEventListener(type: string, fn: (event: unknown) => void, capture?: boolean): void {
    const list = this.listeners.get(type) ?? []
    if (!list.some(item => item.fn === fn && item.capture === Boolean(capture))) list.push({ fn, capture: Boolean(capture) })
    this.listeners.set(type, list)
  }
  removeEventListener(type: string, fn: (event: unknown) => void, capture?: boolean): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter(item => !(item.fn === fn && item.capture === Boolean(capture))))
  }
  count(type: string): number { return this.listeners.get(type)?.length ?? 0 }
  dispatch(type: string, event: unknown): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener.fn(event)
  }
}

const fakeDocument = {
  activeElement: null as FakeHTMLElement | null,
  modalOpen: false,
  documentElement: { lang: '' },
  querySelector(selector: string): object | null {
    return selector === '[aria-modal="true"]' && fakeDocument.modalOpen ? {} : null
  },
}

export class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []
  readonly observed: unknown[] = []
  disconnected = false
  callback: () => void
  constructor(callback: () => void) {
    this.callback = callback
    FakeResizeObserver.instances.push(this)
  }
  observe(target: unknown): void { this.observed.push(target) }
  disconnect(): void { this.disconnected = true }
}

const fakeWindow = new FakeWindow()
const globals = globalThis as unknown as Record<string, unknown>
globals.window = fakeWindow
globals.document = fakeDocument
globals.HTMLElement = FakeHTMLElement
globals.ResizeObserver = FakeResizeObserver

const { usePluginPanelController } = await import('../../src/composables/usePluginPanelController.ts')

export type PluginPanelController = ReturnType<typeof usePluginPanelController>

// --- 最小 renderer：只需要讓元件的生命週期鉤子執行 --------------------------------

const renderer = createRenderer<object, object>({
  patchProp() {},
  insert() {},
  remove() {},
  createElement: () => ({}),
  createText: () => ({}),
  createComment: () => ({}),
  setText() {},
  setElementText() {},
  parentNode: () => null,
  nextSibling: () => null,
})

// --- Fixture ---------------------------------------------------------------

export function preferences(patch: Partial<PluginPreferences> = {}): PluginPreferences {
  return {
    pluginsEnabled: true,
    developerMode: false,
    onlineCatalogEnabled: false,
    dailyUpdateCheck: false,
    catalogUrl: 'https://catalog.example/index.json',
    resources: {
      maxEnabledPlugins: 10,
      memoryMbPerPlugin: 64,
      netMaxResponseBytes: 2 * 1024 * 1024,
      netTimeoutSeconds: 15,
      netRequestsPerMinute: 30,
      storageBytesPerPlugin: 1024 * 1024,
      globalFeedPer10Min: 60,
      scheduleMinIntervalSeconds: 60,
    },
    plugins: {},
    ...patch,
  }
}

export function plugin(id: string, patch: { settings?: boolean; panelView?: boolean; enabled?: boolean } = {}): PluginPanelPlugin {
  const contributes: Record<string, unknown> = {}
  if (patch.settings !== false) {
    contributes.settings = {
      type: 'object',
      properties: {
        city: { type: 'string', title: 'City', default: 'Taipei', maxLength: 20 },
        count: { type: 'number', minimum: 1, maximum: 5, default: 1 },
        token: { type: 'string', format: 'secret' },
      },
    }
  }
  if (patch.panelView !== false) contributes.panelView = { title: { 'zh-TW': id, 'en-US': id }, entry: 'panel.html' }
  return {
    id,
    currentVersion: '1.0.0',
    status: 'enabled',
    installedAt: 1,
    grantedPermissions: {},
    manifest: {
      id,
      name: { 'zh-TW': `插件 ${id}`, 'en-US': `Plugin ${id}` },
      version: '1.0.0',
      apiVersion: '1',
      author: 'Tester',
      permissions: { secrets: ['token'] },
      contributes,
    } as PluginPanelPlugin['manifest'],
    development: false,
    preference: { enabled: patch.enabled ?? true, muted: false, rateLimitPer10Min: 10, targetPetId: null, grantedHosts: [] },
  }
}

export function snapshotOf(plugins: PluginPanelPlugin[], patch: Partial<PluginPreferences> = {}): PluginPanelSnapshot {
  const prefs = preferences(patch)
  prefs.plugins = Object.fromEntries(plugins.map(item => [item.id, { ...item.preference, grantedHosts: [...item.preference.grantedHosts] }]))
  return { preferences: prefs, plugins }
}

export function ok<T>(value: T) { return { ok: true as const, value } }
export function fail(error: string) { return { ok: false as const, error } }

export interface Deferred<T> { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void }
export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

// --- Harness ---------------------------------------------------------------

export interface PluginPanelHarness {
  controller: PluginPanelController
  props: { requestedPluginId?: string; requestNonce?: number }
  calls: ApiCall[]
  callsOf(name: string): ApiCall[]
  /** 目前有效（尚未取消）的 electronAPI 事件訂閱數。 */
  liveSubscriptions(): number
  emit(name: string, payload?: unknown): void
  window: FakeWindow
  document: typeof fakeDocument
  /** 還沒觸發、也沒被 clearTimeout 的計時器數量。 */
  liveTimers(): number
  tick(ms: number): void
  flush(rounds?: number): Promise<void>
  unmount(): void
}

let mounted: { unmount(): void } | null = null

export async function mountPluginPanel(options: {
  snapshot?: PluginPanelSnapshot
  api?: Record<string, ApiOverride>
  props?: { requestedPluginId?: string; requestNonce?: number }
  now?: number
} = {}): Promise<PluginPanelHarness> {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: options.now ?? START_TIME })
  const mockedSet = globalThis.setTimeout
  const mockedClear = globalThis.clearTimeout
  const live = new Set<unknown>()
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    const handle = mockedSet(() => {
      live.delete(handle)
      callback(...args)
    }, ms)
    live.add(handle)
    return handle
  }) as typeof setTimeout
  globalThis.clearTimeout = ((handle?: Parameters<typeof clearTimeout>[0]) => {
    live.delete(handle)
    mockedClear(handle)
  }) as typeof clearTimeout

  fakeWindow.listeners.clear()
  fakeDocument.activeElement = null
  fakeDocument.modalOpen = false
  FakeResizeObserver.instances = []

  const snapshot = options.snapshot ?? snapshotOf([plugin('alpha'), plugin('beta')])
  const defaults: Record<string, ApiOverride> = {
    getPluginPanelSnapshot: () => Promise.resolve(ok(structuredClone(snapshot))),
    listPluginNotifications: () => Promise.resolve(ok([])),
    loadPets: () => Promise.resolve([]),
    getPluginBadges: () => Promise.resolve([]),
    getPluginEventSourceStatuses: () => Promise.resolve([]),
    getPluginDiagnostics: () => Promise.resolve(ok({ logs: [], diagnostics: [] })),
    getPluginSettings: () => Promise.resolve(ok({ values: { city: 'Tainan', count: 2 }, secrets: { token: false } })),
  }
  const overrides = { ...defaults, ...options.api }
  const calls: ApiCall[] = []
  const subscriptions = new Map<string, Set<(payload: unknown) => void>>()
  fakeWindow.electronAPI = new Proxy({}, {
    get(_target, name) {
      if (typeof name !== 'string') return undefined
      return (...args: unknown[]) => {
        calls.push({ name, args })
        if (/^on[A-Z]/.test(name)) {
          const handler = args[0] as (payload: unknown) => void
          const set = subscriptions.get(name) ?? new Set()
          set.add(handler)
          subscriptions.set(name, set)
          return () => { set.delete(handler) }
        }
        const override = overrides[name] as ((...values: unknown[]) => unknown) | undefined
        // 沒有指定回應的 invoke 一律回傳已完成的 Promise；send 類呼叫的回傳值不會被讀。
        return override ? override(...args) : Promise.resolve(undefined)
      }
    },
  })

  const props = reactive<{ requestedPluginId?: string; requestNonce?: number }>({ ...options.props })
  let controller!: PluginPanelController
  const Root = defineComponent({
    setup() {
      controller = usePluginPanelController(props)
      return () => null
    },
  })
  const app = renderer.createApp(Root)
  app.mount({})
  let disposed = false
  const unmount = () => {
    if (disposed) return
    disposed = true
    app.unmount()
    mock.timers.reset()
    fakeWindow.electronAPI = undefined
    mounted = null
  }
  mounted = { unmount }

  const flush = async (rounds = 6) => {
    for (let index = 0; index < rounds; index += 1) {
      await nextTick()
      await Promise.resolve()
    }
  }
  await flush()

  return {
    controller,
    props,
    calls,
    callsOf: name => calls.filter(call => call.name === name),
    liveSubscriptions: () => [...subscriptions.values()].reduce((sum, set) => sum + set.size, 0),
    emit: (name, payload) => { for (const handler of [...(subscriptions.get(name) ?? [])]) handler(payload) },
    window: fakeWindow,
    document: fakeDocument,
    liveTimers: () => live.size,
    tick: ms => mock.timers.tick(ms),
    flush,
    unmount,
  }
}

/** afterEach 用：前一個測試忘了 unmount 時補做。 */
export function unmountLeftover(): void {
  mounted?.unmount()
}
