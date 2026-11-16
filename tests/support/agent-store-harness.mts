// 在 Node 直接跑真的 `useAgentStore()`：假的 localStorage、可記錄呼叫的 electronAPI、
// node:test 的假計時器（setTimeout／Date），並追蹤還沒觸發也沒被清掉的計時器。
// 每個測試呼叫 `createAgentStoreHarness()` 拿一個新的 Pinia 與 store，結束時呼叫 `dispose()`。
import './src-alias.mts'
import { mock } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'

export const START_TIME = Date.UTC(2026, 10, 10, 4, 0, 0)

export class FakeStorage {
  readonly values = new Map<string, string>()
  readonly writes: Array<[string, string]> = []
  get length(): number { return this.values.size }
  key(index: number): string | null { return [...this.values.keys()].at(index) ?? null }
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void {
    this.values.set(key, String(value))
    this.writes.push([key, String(value)])
  }
  removeItem(key: string): void { this.values.delete(key) }
  clear(): void { this.values.clear() }
}

export interface ApiCall { name: string; args: unknown[] }

type ApiOverrides = Record<string, (...args: never[]) => unknown>

interface Globals {
  window?: unknown
  localStorage?: unknown
  electronAPI?: unknown
}

const globals = globalThis as unknown as Globals
globals.window = globalThis

const { useAgentStore } = await import('../../src/stores/agentStore.ts')

export type AgentStore = ReturnType<typeof useAgentStore>

export interface AgentStoreHarness {
  store: AgentStore
  storage: FakeStorage
  calls: ApiCall[]
  /** 還沒觸發、也沒被 clearTimeout 的計時器數量。 */
  liveTimers(): number
  tick(ms: number): void
  flush(): Promise<void>
  dispose(): void
}

export function createAgentStoreHarness(options: {
  storage?: Record<string, string>
  api?: ApiOverrides | null
  now?: number
} = {}): AgentStoreHarness {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: options.now ?? START_TIME })
  const mockedSet = globalThis.setTimeout
  const mockedClear = globalThis.clearTimeout
  const live = new Set<unknown>()
  const trackedSet = ((callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    const handle = mockedSet(() => {
      live.delete(handle)
      callback(...args)
    }, ms)
    live.add(handle)
    return handle
  }) as typeof setTimeout
  globalThis.setTimeout = trackedSet
  globalThis.clearTimeout = ((handle?: Parameters<typeof clearTimeout>[0]) => {
    live.delete(handle)
    mockedClear(handle)
  }) as typeof clearTimeout

  const storage = new FakeStorage()
  for (const [key, value] of Object.entries(options.storage ?? {})) storage.values.set(key, value)
  globals.localStorage = storage

  const calls: ApiCall[] = []
  if (options.api === null) {
    globals.electronAPI = undefined
  } else {
    const overrides = options.api ?? {}
    globals.electronAPI = new Proxy({}, {
      get(_target, name) {
        if (typeof name !== 'string') return undefined
        return (...args: unknown[]) => {
          calls.push({ name, args })
          const override = overrides[name] as ((...values: unknown[]) => unknown) | undefined
          // 沒有指定回應的 IPC 一律回傳已完成的 Promise，跟 preload 的 invoke 形狀一致。
          return override ? override(...args) : Promise.resolve(undefined)
        }
      },
    })
  }

  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useAgentStore()

  return {
    store,
    storage,
    calls,
    liveTimers: () => live.size,
    tick: ms => mock.timers.tick(ms),
    flush: async () => {
      await nextTick()
      await Promise.resolve()
    },
    dispose: () => {
      store.$dispose()
      mock.timers.reset()
      globals.electronAPI = undefined
      globals.localStorage = undefined
    },
  }
}
