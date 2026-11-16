import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test, { type TestContext } from 'node:test'
import {
  createPluginCatalogRuntime,
  decodeCatalogBase64,
  type PluginCatalogRuntimeState,
} from '../electron/main/plugin-catalog-runtime.ts'
import type { PluginFeedController } from '../electron/plugin-feed.ts'
import type { PluginNetworkClient } from '../electron/plugin-net.ts'
import type { PluginPreferencesStore } from '../electron/plugin-preferences.ts'
import type { PluginRegistry } from '../electron/plugin-registry.ts'
import { fakeService } from './support/fake-service.mts'

// 階段 11 後續：plugin catalog 閘道與每日自動檢查原本在 electron/main/runtime.ts，
// 改由抽出的服務搭配假 state 與 node:test 假計時器驗證。

const CATALOG_URL = 'https://raw.githubusercontent.com/example/agent-pets-catalog/main/registry.json'
// 以片段組合：ipc-inventory 以子字串比對 preload API 名稱，完整字串會把這個測試誤列為 agentPets API 的測試。
const E2E_KEY = ['__agent', 'PetsE2E'].join('')

interface FakeOptions {
  enabled?: boolean
  lastDay?: string | null
  // 部分案例刻意回傳不符 PluginNetworkClient 形狀的值，所以只約束到成員名稱。
  network?: Parameters<typeof fakeService<PluginNetworkClient>>[0] | null
}

function setup(t: TestContext, options: FakeOptions = {}) {
  // 同一個測試可能呼叫多次 setup；計時器只啟用一次。
  try { t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] }) } catch {}
  const calls: string[] = []
  const state: PluginCatalogRuntimeState = {
    pluginNetworkClient: options.network ? fakeService<PluginNetworkClient>(options.network) : null,
    pluginRegistry: fakeService<PluginRegistry>({ list: () => [] }),
    pluginPreferences: fakeService<PluginPreferencesStore>({
      get: () => ({
        onlineCatalogEnabled: options.enabled ?? false,
        dailyUpdateCheck: true,
        catalogUrl: CATALOG_URL,
      }),
      getLastCatalogAutoCheckDay: () => options.lastDay ?? null,
      setLastCatalogAutoCheckDay: (day: string) => { calls.push(`day:${day}`) },
    }),
    pluginFeedController: fakeService<PluginFeedController>({
      addSystemNotification: (...args: unknown[]) => { calls.push(`notify:${String(args[2])}|${String(args[3])}`) },
    }),
    pluginCatalogAutoCheckSchedule: null,
    pluginCatalogAutoCheckTimer: null,
  }
  const runtime = createPluginCatalogRuntime({
    state,
    appVersion: () => '1.13.1',
    translate: (key, params) => `${key}${params ? JSON.stringify(params) : ''}`,
  })
  return { state, runtime, calls }
}

function withE2e(value: unknown, body: () => Promise<void>): Promise<void> {
  // 用 Reflect 讀寫 globalThis 上的動態鍵，不需要把 globalThis 轉型成索引型別。
  const had = Reflect.has(globalThis, E2E_KEY)
  const previous: unknown = Reflect.get(globalThis, E2E_KEY)
  Reflect.set(globalThis, E2E_KEY, value)
  return body().finally(() => {
    if (had) Reflect.set(globalThis, E2E_KEY, previous)
    else Reflect.deleteProperty(globalThis, E2E_KEY)
  })
}

test('auto-check creates the schedule and the hourly timer exactly once', async t => {
  const { state, runtime } = setup(t)
  runtime.initializeAutoCheck()
  const schedule = state.pluginCatalogAutoCheckSchedule
  const timer = state.pluginCatalogAutoCheckTimer
  assert.ok(schedule)
  assert.ok(timer)
  runtime.initializeAutoCheck()
  assert.equal(state.pluginCatalogAutoCheckSchedule, schedule)
  assert.equal(state.pluginCatalogAutoCheckTimer, timer)
  runtime.dispose()
})

test('auto-check does nothing until plugin preferences and registry exist', t => {
  const { state, runtime } = setup(t)
  state.pluginPreferences = null
  runtime.initializeAutoCheck()
  assert.equal(state.pluginCatalogAutoCheckSchedule, null)
  assert.equal(state.pluginCatalogAutoCheckTimer, null)
})

test('the hourly timer wakes the schedule and dispose stops it', async t => {
  const { state, runtime, calls } = setup(t, { enabled: true, lastDay: '2000-01-01' })
  runtime.initializeAutoCheck()
  // 啟動時立即檢查一次（今天尚未檢查過）。
  await Promise.resolve()
  assert.equal(calls.filter(call => call.startsWith('day:')).length, 1)
  const schedule = state.pluginCatalogAutoCheckSchedule!
  let wakes = 0
  const original = schedule.checkIfDue.bind(schedule)
  schedule.checkIfDue = () => { wakes += 1; return original() }
  t.mock.timers.tick(60 * 60 * 1_000)
  assert.equal(wakes, 1)
  t.mock.timers.tick(60 * 60 * 1_000)
  assert.equal(wakes, 2)
  runtime.dispose()
  assert.equal(state.pluginCatalogAutoCheckTimer, null)
  t.mock.timers.tick(5 * 60 * 60 * 1_000)
  assert.equal(wakes, 2)
  runtime.dispose()
})

test('dispose before any initialization is a no-op', t => {
  const { state, runtime } = setup(t)
  runtime.dispose()
  assert.equal(state.pluginCatalogAutoCheckTimer, null)
})

test('checkUpdates refuses when services are missing or auto-check is disabled', async t => {
  const missing = setup(t)
  missing.state.pluginRegistry = null
  await assert.rejects(missing.runtime.checkUpdates(), /services unavailable/)
  const disabled = setup(t, { enabled: false })
  await assert.rejects(disabled.runtime.checkUpdates(), /auto-check disabled/)
})

test('the e2e fixture replaces the network for registry and archive downloads', async t => {
  const { runtime } = setup(t)
  const bytes = Buffer.from('plugin-archive')
  const downloadUrl = 'https://github.com/example/agent-pets-catalog/releases/download/v1/p.zip'
  await withE2e({
    catalogFixture: {
      registry: { schemaVersion: 1, plugins: [] },
      downloads: { [downloadUrl]: bytes.toString('base64') },
    },
  }, async () => {
    const loaded = await runtime.gateway().load(CATALOG_URL)
    assert.deepEqual(loaded, { ok: true, value: { schemaVersion: 1, plugins: [] } })
    const downloaded = await runtime.gateway().download({
      version: '1.0.0',
      apiVersion: '1',
      url: downloadUrl,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.byteLength,
      publishedAt: '2026-01-01T00:00:00Z',
    })
    assert.equal(downloaded.ok, true)
    assert.deepEqual(downloaded.ok && Buffer.from(downloaded.value), bytes)
  })
})

test('e2e mode without a fixture never falls through to the network', async t => {
  let fetched = false
  const { runtime } = setup(t, { network: { fetch: async () => { fetched = true } } })
  await withE2e({}, async () => {
    assert.deepEqual(await runtime.gateway().load(CATALOG_URL), { ok: false, error: 'catalog_unavailable' })
  })
  await withE2e(undefined, async () => {
    assert.deepEqual(await runtime.gateway().load(CATALOG_URL), { ok: false, error: 'catalog_unavailable' })
  })
  assert.equal(fetched, false)
})

test('network responses map to the established catalog errors', async t => {
  const respond = (status: number, body = '') => ({
    fetch: async () => ({ ok: true, value: { status, body, isBase64Encoded: false } }),
  })
  assert.deepEqual(await setup(t, { network: respond(404) }).runtime.gateway().load(CATALOG_URL),
    { ok: false, error: 'catalog_not_found' })
  assert.deepEqual(await setup(t, { network: respond(500) }).runtime.gateway().load(CATALOG_URL),
    { ok: false, error: 'catalog_unavailable' })
  assert.deepEqual(await setup(t, { network: null }).runtime.gateway().load(CATALOG_URL),
    { ok: false, error: 'catalog_unavailable' })
  assert.deepEqual(await setup(t, { network: respond(200, JSON.stringify({ schemaVersion: 1, plugins: [] })) }).runtime.gateway().load(CATALOG_URL),
    { ok: true, value: { schemaVersion: 1, plugins: [] } })
  const encoded = Buffer.from(JSON.stringify({ schemaVersion: 1, plugins: [] })).toString('base64')
  const base64Network = { fetch: async () => ({ ok: true, value: { status: 200, body: encoded, isBase64Encoded: true } }) }
  assert.equal((await setup(t, { network: base64Network }).runtime.gateway().load(CATALOG_URL)).ok, true)
})

test('only allow-listed catalog hosts are ever requested', async t => {
  let fetched = false
  const { runtime } = setup(t, { network: { fetch: async () => { fetched = true } } })
  assert.deepEqual(await runtime.gateway().load('https://example.com/registry.json'), { ok: false, error: 'host_not_allowed' })
  assert.equal(fetched, false)
})

test('decodeCatalogBase64 accepts canonical base64 only', () => {
  assert.deepEqual(Buffer.from(decodeCatalogBase64('aGVsbG8=')), Buffer.from('hello'))
  for (const bad of ['', 'aGVsbG8', 'aGVsbG8==', 'a GVsbG8=', 'aGVsbG9=', 42, null, undefined, 'x'.repeat(36_000_004)]) {
    assert.throws(() => decodeCatalogBase64(bad), /Invalid catalog base64/, String(bad).slice(0, 12))
  }
})
