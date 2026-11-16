import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import {
  createHistoryRuntimeService,
  HISTORY_PRUNE_INTERVAL_MS,
  HISTORY_STORE_RETRY_DELAYS_MS,
  LOCAL_USAGE_MIN_SCAN_INTERVAL_MS,
  STARTUP_DEFERRED_WORK_MS,
  type HistoryRuntimeState,
} from '../electron/main/history-runtime-service.ts'
import type { HistoryStore } from '../electron/history.ts'
import type { LocalUsageReader, LocalUsageReaderOptions } from '../electron/local-usage.ts'
import type { ProgressionStore } from '../electron/progression.ts'
import { LOCAL_USAGE_CATCH_UP_DELAY_MS, LOCAL_USAGE_TICK_MS } from '../electron/main/scan-schedule.ts'
import { fakeService } from './support/fake-service.mts'

// 階段 11 之前在 electron/main/runtime.ts 內 createHistoryServices()／refreshLocalUsage()
// 的行為，改由抽出的服務搭配假 store 與 node:test 假計時器驗證。

interface ScanResult { recordsImported: number; bytesRead: number; pending: boolean }

function setup(t: TestContext, options: { failOpens?: number; scan?: () => ScanResult } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
  const calls: string[] = []
  let failOpens = options.failOpens ?? 0
  let scans = 0
  const store = fakeService<HistoryStore>({
    quickCheck: () => true,
    close: () => calls.push('store.close'),
    getRetentionDays: () => 30,
    pruneInBatches: async () => { calls.push('prune') },
  })
  const state: HistoryRuntimeState = {
    historyStore: null,
    localUsageReader: null,
    localUsageScanTimer: null,
    localUsageScanPromise: null,
    progressionStore: fakeService<ProgressionStore>({ pruneStaleActivity: () => calls.push('xp-prune') }),
    projectRoutingStore: null,
    isQuitting: false,
  }
  let readerOptions: LocalUsageReaderOptions | null = null
  const service = createHistoryRuntimeService({
    state,
    databasePath: () => 'history.sqlite',
    openStore: path => {
      calls.push(`open:${path}`)
      if (failOpens > 0) {
        failOpens -= 1
        throw new Error('locked')
      }
      return store
    },
    createLocalUsageReader: readerOpts => {
      readerOptions = readerOpts
      return fakeService<LocalUsageReader>({
        scan: async () => {
          scans += 1
          return options.scan?.() ?? { recordsImported: 0, bytesRead: 10, pending: false }
        },
      })
    },
    homeDir: () => 'home',
    configDirs: () => ({ claude: 'c', codex: 'x' }),
    isOnBatteryPower: () => false,
    onRecovered: () => calls.push('recovered'),
    onHistoryUpdated: () => calls.push('historyUpdated'),
    onLocalRecordsImported: (_records, retentionDays) => calls.push(`imported:${retentionDays}`),
    onLocalScanFinished: () => calls.push('scanFinished'),
    onDeferredStartupWork: () => calls.push('deferred'),
    logError: message => calls.push(`error:${message}`),
  })
  t.after(() => {
    service.dispose()
    if (state.localUsageScanTimer) clearInterval(state.localUsageScanTimer)
  })
  return { service, state, calls, scans: () => scans, readerOptions: () => readerOptions }
}

// 讓掃描的 promise 鏈（then／catch／finally）在假計時器下跑完。
async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve()
}

test('start opens the store once and wires the local usage reader', t => {
  const { service, state, calls, readerOptions } = setup(t)
  service.start()
  service.start()
  assert.equal(calls.filter(call => call.startsWith('open:')).length, 1)
  assert.ok(state.historyStore)
  assert.ok(state.localUsageReader)
  assert.ok(state.localUsageScanTimer)
  const options = readerOptions()
  assert.equal(options?.homeDir, 'home')
  assert.equal(options?.history, state.historyStore)
  ;options?.onRecordsImported?.([])
  assert.ok(calls.includes('imported:30'))
})

test('deferred startup work runs after the pet has been on screen', async t => {
  const { service, calls, scans } = setup(t)
  service.start()
  t.mock.timers.tick(STARTUP_DEFERRED_WORK_MS - 1)
  assert.ok(!calls.includes('deferred'))
  t.mock.timers.tick(1)
  assert.ok(calls.includes('deferred'))
  await settle()
  assert.equal(scans(), 1)
  assert.ok(calls.includes('scanFinished'))
})

test('a failed open retries with backoff and stops after the last delay', t => {
  const { service, state, calls } = setup(t, { failOpens: 10 })
  service.start()
  assert.equal(state.historyStore, null)
  assert.ok(calls.includes('error:History storage is unavailable'))
  const opens = () => calls.filter(call => call.startsWith('open:')).length
  // openWithCorruptionRecovery 每次嘗試可能開不只一次；以次數是否增加判斷。
  let previous = opens()
  for (const delay of HISTORY_STORE_RETRY_DELAYS_MS) {
    t.mock.timers.tick(delay - 1)
    assert.equal(opens(), previous)
    t.mock.timers.tick(1)
    assert.ok(opens() > previous)
    previous = opens()
  }
  t.mock.timers.tick(HISTORY_STORE_RETRY_DELAYS_MS.at(-1)! * 2)
  assert.equal(opens(), previous)
})

test('no retry is scheduled while quitting', t => {
  const { service, state, calls } = setup(t, { failOpens: 10 })
  state.isQuitting = true
  service.start()
  const opens = calls.filter(call => call.startsWith('open:')).length
  t.mock.timers.tick(HISTORY_STORE_RETRY_DELAYS_MS[0] * 2)
  assert.equal(calls.filter(call => call.startsWith('open:')).length, opens)
})

test('a recovered store resets the retry backoff', t => {
  const { service, state } = setup(t, { failOpens: 1 })
  service.start()
  assert.equal(state.historyStore, null)
  t.mock.timers.tick(HISTORY_STORE_RETRY_DELAYS_MS[0])
  assert.ok(state.historyStore)
})

test('panel refreshes are throttled, catch-up scans are not', async t => {
  const { service, scans } = setup(t)
  service.start()
  await service.refreshLocalUsage({ catchUp: true })
  assert.equal(scans(), 1)
  await service.refreshLocalUsage()
  assert.equal(scans(), 1)
  t.mock.timers.tick(LOCAL_USAGE_MIN_SCAN_INTERVAL_MS)
  await service.refreshLocalUsage()
  assert.equal(scans(), 2)
})

test('a scan in flight is shared instead of starting another', async t => {
  const { service, state, scans } = setup(t)
  service.start()
  const first = service.refreshLocalUsage({ catchUp: true })
  assert.ok(state.localUsageScanPromise)
  const second = service.refreshLocalUsage({ catchUp: true })
  await Promise.all([first, second])
  assert.equal(scans(), 1)
  assert.equal(state.localUsageScanPromise, null)
})

test('imported records broadcast once and a pending scan continues shortly', async t => {
  const { service, calls, scans } = setup(t, { scan: () => ({ recordsImported: 3, bytesRead: 10, pending: true }) })
  service.start()
  await service.refreshLocalUsage({ catchUp: true })
  assert.equal(calls.filter(call => call === 'historyUpdated').length, 1)
  t.mock.timers.tick(LOCAL_USAGE_CATCH_UP_DELAY_MS)
  await settle()
  assert.equal(scans(), 2)
})

test('the regular tick scans without a panel request', async t => {
  const { service, scans } = setup(t)
  service.start()
  t.mock.timers.tick(LOCAL_USAGE_TICK_MS)
  await settle()
  assert.equal(scans(), 1)
})

test('the prune interval expires history and XP activity', async t => {
  const { service, calls } = setup(t)
  service.start()
  t.mock.timers.tick(HISTORY_PRUNE_INTERVAL_MS)
  await settle()
  assert.ok(calls.includes('prune'))
  assert.ok(calls.includes('xp-prune'))
})

test('dispose stops deferred work, retries, catch-up scans and pruning', async t => {
  const pending = setup(t, { scan: () => ({ recordsImported: 0, bytesRead: 10, pending: true }) })
  pending.service.start()
  await pending.service.refreshLocalUsage({ catchUp: true })
  pending.service.dispose()
  pending.service.dispose()
  if (pending.state.localUsageScanTimer) clearInterval(pending.state.localUsageScanTimer)
  t.mock.timers.tick(HISTORY_PRUNE_INTERVAL_MS)
  await settle()
  assert.equal(pending.scans(), 1)
  assert.ok(!pending.calls.includes('deferred'))
  assert.ok(!pending.calls.includes('prune'))
})

test('dispose cancels a pending open retry', t => {
  const { service, calls } = setup(t, { failOpens: 10 })
  service.start()
  const opens = calls.filter(call => call.startsWith('open:')).length
  service.dispose()
  t.mock.timers.tick(HISTORY_STORE_RETRY_DELAYS_MS[0] * 2)
  assert.equal(calls.filter(call => call.startsWith('open:')).length, opens)
})
