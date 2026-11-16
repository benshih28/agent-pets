import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { AchievementStore } from '../electron/achievements.ts'
import { HistoryStore } from '../electron/history.ts'
import { IPC_CHANNELS } from '../electron/ipc/channels.ts'
import {
  DB_MAINTENANCE_MIN_INTERVAL_MS,
  GROWTH_RESET_ARM_MIN_INTERVAL_MS,
  GROWTH_RESET_MIN_INTERVAL_MS,
  registerGrowthMaintenanceIpc,
} from '../electron/ipc/growth-maintenance.ts'
import { createDbMaintenanceService } from '../electron/main/db-maintenance-service.ts'
import { createGrowthService, type GrowthState } from '../electron/main/growth-service.ts'
import { ProgressionStore } from '../electron/progression.ts'
import { SqliteBusyError, optimizeAndVacuum, sqliteFootprintBytes } from '../electron/sqlite-maintenance.ts'
import { GROWTH_RESET_TOKEN_TTL_MS, type GrowthResetResult } from '../src/types/growth-maintenance.ts'
import { formatBytes } from '../src/utils/bytes-format.ts'
import { fakeBrowserWindow } from './support/fake-electron.mts'
import { createFakeIpcMain } from './support/fake-ipc.mts'
import { removeTempTree } from './support/temp-dir.mts'

const DAY = 24 * 60 * 60 * 1000
const BASE = Date.UTC(2026, 5, 1, 12)
const localDate = (timestamp: number): string => new Date(timestamp).toISOString().slice(0, 10)

function done(sessionId: string, timestamp: number) {
  return { source: 'codex' as const, sessionId, state: 'success' as const, timestamp }
}

function raw(store: unknown): { prepare(sql: string): { get(): Record<string, number>, all(): Array<Record<string, unknown>> }, exec(sql: string): void } {
  return (store as { database: never }).database
}

const count = (store: unknown, table: string): number =>
  Number(raw(store).prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n)

function harness(t: { after(fn: () => void): void }, options: { now?: () => number } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'agent-pets-growth-maint-'))
  let clock = BASE
  const now = options.now ?? (() => clock)
  const paths = {
    progression: join(directory, 'progression.sqlite'),
    achievements: join(directory, 'achievements.sqlite'),
    history: join(directory, 'history.sqlite'),
  }
  const progression = new ProgressionStore(paths.progression, { now, localDate })
  const achievements = new AchievementStore(paths.achievements, { now, localDate, localHour: ts => new Date(ts).getUTCHours() })
  const history = new HistoryStore(paths.history, { now, localDate })
  t.after(() => {
    for (const store of [progression, achievements, history]) { try { store.close() } catch {} }
    removeTempTree(directory)
  })
  return { directory, paths, progression, achievements, history, now, setNow: (v: number) => { clock = v }, tick: (ms: number) => { clock += ms } }
}

function growthOf(h: ReturnType<typeof harness>, sent: Array<[string, unknown]> = [], logged: string[] = []) {
  const state = {
    progressionStore: h.progression,
    achievementStore: h.achievements,
    achievementStoreRetryTimer: null,
    achievementStoreRetryAttempt: 0,
    historyStore: h.history,
    desktopNotifications: null,
  } as unknown as GrowthState
  const window = {
    isDestroyed: () => false,
    isVisible: () => true,
    webContents: { send: (channel: string, payload?: unknown) => { sent.push([channel, payload]) } },
  }
  const service = createGrowthService({
    state,
    getWindows: () => [window, window],
    openProgressionStore: () => h.progression,
    openAchievementStore: () => h.achievements,
    achievementsEnabled: () => true,
    logError: message => { logged.push(message) },
    logMain: (_level, _channel, message) => { logged.push(message) },
    now: h.now,
  })
  return { service, state }
}

function seed(h: ReturnType<typeof harness>, sessions = 3): void {
  for (let i = 0; i < sessions; i += 1) {
    const event = done(`s${i}`, BASE + i * 1000)
    h.progression.handleEvent(event, 'pet-a')
    h.achievements.recordEvent(event, 'pet-a')
    h.history.recordEvent({ ...event, routedPetId: 'pet-a' }, 'pet-a', BASE + i * 1000)
  }
}

test('resetGrowth clears XP and achievements, keeps pets and the active pet, and is idempotent', t => {
  const h = harness(t)
  seed(h)
  h.progression.setActivePet('pet-a')
  assert.ok(h.progression.getSnapshot('pet-a').totalXp > 0)
  assert.ok(count(h.achievements, 'achievement_unlocks') > 0)
  const pets = count(h.progression, 'pets')

  h.achievements.resetGrowth(BASE + 5000, () => { h.progression.resetGrowth() })
  const snapshot = h.progression.getSnapshot('pet-a')
  assert.equal(snapshot.totalXp, 0)
  assert.equal(snapshot.currentStreak, 0)
  assert.equal(count(h.progression, 'xp_ledger'), 0)
  assert.equal(count(h.achievements, 'achievement_unlocks'), 0)
  assert.equal(count(h.achievements, 'completed_sessions'), 0)
  assert.equal(h.achievements.getSnapshot('pet-a').totalUnlocked, 0)
  assert.equal(count(h.progression, 'pets'), pets)
  assert.equal(h.progression.getActivePetId(), 'pet-a')

  // 第二次重設結果相同，不丟錯。
  h.achievements.resetGrowth(BASE + 6000, () => { h.progression.resetGrowth() })
  assert.equal(h.progression.getSnapshot('pet-a').totalXp, 0)
  assert.equal(h.achievements.getGrowthResetAt(), BASE + 6000)
})

test('resetGrowth is atomic: a failure in either database restores everything', t => {
  const h = harness(t)
  seed(h)
  const xpBefore = h.progression.getSnapshot('pet-a').totalXp
  const unlocksBefore = count(h.achievements, 'achievement_unlocks')

  // 進度端在成就端 COMMIT 之前丟錯：成就端要整個回復。
  assert.throws(() => h.achievements.resetGrowth(BASE + 9000, () => { throw new Error('progression failed') }), /progression failed/)
  assert.equal(h.achievements.getGrowthResetAt(), 0)
  assert.equal(count(h.achievements, 'achievement_unlocks'), unlocksBefore)
  assert.equal(count(h.achievements, 'completed_sessions'), 3)
  assert.equal(h.progression.getSnapshot('pet-a').totalXp, xpBefore)

  // 進度端自己的交易中途失敗（刪完帳本後 UPDATE 失敗）：進度端回復，成就端也回復。
  raw(h.progression).exec('CREATE TRIGGER fail_reset BEFORE UPDATE ON pet_progress BEGIN SELECT RAISE(ABORT, \'boom\'); END')
  assert.throws(() => h.achievements.resetGrowth(BASE + 9000, () => { h.progression.resetGrowth() }), /boom/)
  assert.equal(count(h.progression, 'xp_ledger') > 0, true)
  assert.equal(h.progression.getSnapshot('pet-a').totalXp, xpBefore)
  assert.equal(count(h.achievements, 'achievement_unlocks'), unlocksBefore)
  assert.equal(h.achievements.getGrowthResetAt(), 0)
  // 失敗之後 store 仍可正常使用（沒有遺留開啟中的交易）。
  raw(h.progression).exec('DROP TRIGGER fail_reset')
  h.achievements.resetGrowth(BASE + 9000, () => { h.progression.resetGrowth() })
  assert.equal(h.progression.getSnapshot('pet-a').totalXp, 0)
})

test('growth service reset reports failure, changes nothing, and broadcasts only on success', t => {
  const h = harness(t)
  seed(h)
  const sent: Array<[string, unknown]> = []
  const logged: string[] = []
  const { service } = growthOf(h, sent, logged)
  const original = h.progression.resetGrowth.bind(h.progression)
  h.progression.resetGrowth = () => { throw new Error('disk') }
  assert.deepEqual(service.resetGrowth(), { ok: false, error: 'failed' })
  assert.equal(sent.length, 0)
  assert.ok(h.progression.getSnapshot('pet-a').totalXp > 0)
  assert.ok(count(h.achievements, 'achievement_unlocks') > 0)

  h.progression.resetGrowth = original
  assert.deepEqual(service.resetGrowth(), { ok: true })
  const channels = sent.map(([channel]) => channel)
  // 兩個視窗各收到進度與成就廣播。
  assert.equal(channels.filter(c => c === IPC_CHANNELS.progressionUpdated).length, 2)
  assert.equal(channels.filter(c => c === IPC_CHANNELS.achievementsUpdated).length, 2)
  assert.equal((sent.find(([c]) => c === IPC_CHANNELS.progressionUpdated)?.[1] as { totalXp: number }).totalXp, 0)
  // 重設之後再重設仍成功（冪等）。
  assert.deepEqual(service.resetGrowth(), { ok: true })
})

test('growth service reset is unavailable when a store is missing and touches nothing', t => {
  const h = harness(t)
  seed(h)
  const { service, state } = growthOf(h)
  ;(state as { achievementStore: unknown }).achievementStore = null
  assert.deepEqual(service.resetGrowth(), { ok: false, error: 'unavailable' })
  assert.ok(h.progression.getSnapshot('pet-a').totalXp > 0)
})

test('history reconcile and local token sync do not restore data from before the reset', t => {
  const h = harness(t)
  seed(h)
  h.achievements.syncLocalTokenUsage([{ adapterId: 'codex', sourceEventId: 'old-1', occurredAt: BASE, input: 500, output: 500 }], { compactBefore: 0, evaluatePetId: null })
  assert.equal(count(h.achievements, 'local_token_usage'), 1)
  const { service } = growthOf(h)
  h.tick(10 * 60 * 1000)
  assert.deepEqual(service.resetGrowth(), { ok: true })

  // 完整歷史仍在；reconcile 不可補回重設前的 session。
  assert.equal(h.history.getAchievementCompletedSessions(0).length, 3)
  service.reconcileFromHistory()
  assert.equal(count(h.achievements, 'completed_sessions'), 0)
  assert.equal(count(h.achievements, 'achievement_unlocks'), 0)

  // 重設前的本機 token 記錄再次出現也不計；重設後的新記錄正常計入。
  service.syncLocalTokenUsage([{ adapterId: 'codex', agentId: 'codex', sourceEventId: 'old-1', occurredAt: BASE, input: 500, output: 500, quality: 'exact' }], 90)
  assert.equal(count(h.achievements, 'local_token_usage'), 0)
  service.syncLocalTokenUsage([{ adapterId: 'codex', agentId: 'codex', sourceEventId: 'new-1', occurredAt: BASE + 11 * 60 * 1000, input: 5, output: 5, quality: 'exact' }], 90)
  assert.equal(count(h.achievements, 'local_token_usage'), 1)

  // 重設後的新完成 session 仍可被 reconcile 取得。
  h.history.recordEvent({ ...done('after', BASE + 20 * 60 * 1000), routedPetId: 'pet-a' }, 'pet-a', BASE + 20 * 60 * 1000)
  service.reconcileFromHistory()
  assert.equal(count(h.achievements, 'completed_sessions'), 1)
})

test('the reset cutoff survives a restart of the achievement store', t => {
  const h = harness(t)
  seed(h)
  h.achievements.resetGrowth(BASE + 7000)
  h.achievements.close()
  const reopened = new AchievementStore(h.paths.achievements, { now: () => BASE, localDate })
  // 在測試本體內關閉：t.after 依註冊順序執行，harness 的刪目錄會先跑，Windows 上資料庫還開著就刪會 EPERM。
  try {
    assert.equal(reopened.getGrowthResetAt(), BASE + 7000)
    const fact = { petId: 'pet-a', source: 'codex', sessionId: 'x', projectId: '', adapterId: 'codex', completedAt: BASE }
    reopened.reconcileCompletedSessions([fact])
    assert.equal(count(reopened, 'completed_sessions'), 0)
  } finally {
    reopened.close()
  }
})

test('optimizeAndVacuum refuses while a transaction is open', t => {
  const h = harness(t)
  raw(h.achievements).exec('BEGIN IMMEDIATE')
  assert.throws(() => h.achievements.compact(), SqliteBusyError)
  raw(h.achievements).exec('ROLLBACK')
  assert.doesNotThrow(() => h.achievements.compact())
  // 呼叫端自己的交易計數（HistoryStore.transactionDepth）也算忙碌。
  assert.throws(() => optimizeAndVacuum({ exec: () => assert.fail('must not run') }, true), SqliteBusyError)
  assert.throws(() => optimizeAndVacuum({ exec: () => assert.fail('must not run'), isTransaction: true }), SqliteBusyError)
  // VACUUM 之後 store 的快取語句仍可使用。
  assert.equal(h.achievements.getSnapshot('pet-a').totalUnlocked, 0)
})

test('history compact refuses inside HistoryStore.batch', t => {
  const h = harness(t)
  h.history.batch(() => {
    assert.throws(() => h.history.compact(), SqliteBusyError)
  })
  assert.doesNotThrow(() => h.history.compact())
})

const roomy = async () => ({ bavail: 1e9, bsize: 4096 })

function maintenance(h: ReturnType<typeof harness>, extra: { scanning?: () => boolean, logged?: string[], statfs?: (directory: string) => Promise<{ bavail: number | bigint, bsize: number | bigint }> } = {}) {
  return createDbMaintenanceService({
    statfs: extra.statfs ?? roomy,
    getHistoryStore: () => h.history,
    getProgressionStore: () => h.progression,
    getAchievementStore: () => h.achievements,
    databasePaths: () => [h.paths.history, h.paths.progression, h.paths.achievements],
    isLocalScanActive: extra.scanning ?? (() => false),
    logError: message => { extra.logged?.push(message) },
    now: () => BASE,
  })
}

test('maintenance prunes only expired data, vacuums, and reports sizes', async t => {
  const h = harness(t, { now: () => BASE })
  // 超過 90 天保留期的舊資料 + 近期資料。
  const old = BASE - 200 * DAY
  h.history.batch(() => {
    for (let i = 0; i < 400; i += 1) {
      h.history.recordEvent({ source: 'codex', sessionId: `old-${i}`, state: 'success', timestamp: old + i, routedPetId: 'pet-a' }, 'pet-a', old + i)
    }
    for (let i = 0; i < 20; i += 1) {
      h.history.recordEvent({ source: 'codex', sessionId: `new-${i}`, state: 'success', timestamp: BASE - i, routedPetId: 'pet-a' }, 'pet-a', BASE - i)
    }
  })
  const recentBefore = Number(raw(h.history).prepare(`SELECT COUNT(*) AS n FROM events WHERE occurred_at >= ${BASE - 90 * DAY}`).get().n)
  const result = await maintenance(h).run()
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.ok(result.prunedRows >= 400)
  assert.equal(Number(raw(h.history).prepare(`SELECT COUNT(*) AS n FROM events WHERE occurred_at >= ${BASE - 90 * DAY}`).get().n), recentBefore)
  assert.equal(Number(raw(h.history).prepare(`SELECT COUNT(*) AS n FROM events WHERE occurred_at < ${BASE - 90 * DAY}`).get().n), 0)
  assert.equal(result.freedBytes, Math.max(0, result.beforeBytes - result.afterBytes))
  assert.ok(result.beforeBytes > 0 && result.afterBytes > 0)
  const actual = [h.paths.history, h.paths.progression, h.paths.achievements]
    .reduce((sum, path) => sum + sqliteFootprintBytes(path), 0)
  assert.equal(result.afterBytes, actual)
  // VACUUM 後 WAL 已截斷。
  assert.equal(!existsSync(`${h.paths.history}-wal`) || statSync(`${h.paths.history}-wal`).size === 0, true)
})

test('maintenance rejects re-entry, a running local scan, and open transactions', async t => {
  const h = harness(t)
  let scanning = true
  const service = maintenance(h, { scanning: () => scanning })
  assert.deepEqual(await service.run(), { ok: false, error: 'scanning' })

  scanning = false
  // 重入：第一個還沒結束（pruneInBatches 讓出事件迴圈）時第二個直接 busy。
  const first = service.run()
  const second = await service.run()
  assert.deepEqual(second, { ok: false, error: 'busy' })
  assert.equal((await first).ok, true)
  // 結束後可以再跑。
  assert.equal((await service.run()).ok, true)

  // 清理讓出期間掃描啟動：VACUUM 前重查，回報 scanning 而不是硬跑。
  let calls = 0
  const late = maintenance(h, { scanning: () => ++calls > 1 })
  assert.deepEqual(await late.run(), { ok: false, error: 'scanning' })

  // 交易進行中：回報 busy，且之後可恢復。
  raw(h.progression).exec('BEGIN IMMEDIATE')
  assert.deepEqual(await maintenance(h).run(), { ok: false, error: 'busy' })
  raw(h.progression).exec('ROLLBACK')
  assert.equal((await maintenance(h).run()).ok, true)
})

test('maintenance is unavailable without stores and never throws on store failures', async t => {
  const empty = createDbMaintenanceService({
    getHistoryStore: () => null, getProgressionStore: () => null, getAchievementStore: () => null,
    databasePaths: () => [], isLocalScanActive: () => false, logError: () => {},
  })
  assert.deepEqual(await empty.run(), { ok: false, error: 'unavailable' })
  const logged: string[] = []
  const broken = createDbMaintenanceService({
    getHistoryStore: () => null,
    getProgressionStore: () => ({ pruneStaleActivity: () => { throw new Error('x') }, compact: () => {} }),
    getAchievementStore: () => null,
    databasePaths: () => [], isLocalScanActive: () => false, logError: m => { logged.push(m) },
  })
  assert.deepEqual(await broken.run(), { ok: false, error: 'failed' })
  assert.equal(logged.length, 1)
  void t
})

test('maintenance stops with insufficient_space before touching any database', async t => {
  const h = harness(t)
  seed(h)
  const compacted: string[] = []
  for (const [name, store] of [['history', h.history], ['progression', h.progression], ['achievements', h.achievements]] as const) {
    const original = store.compact.bind(store)
    store.compact = () => { compacted.push(name); original() }
  }
  const asked: string[] = []
  const result = await maintenance(h, { statfs: async directory => { asked.push(directory); return { bavail: 1, bsize: 1 } } }).run()
  assert.equal(result.ok, false)
  if (result.ok || result.error !== 'insufficient_space') return assert.fail('expected insufficient_space')
  assert.equal(result.availableBytes, 1)
  assert.equal(result.neededBytes, sqliteFootprintBytes(h.paths.history) * 2)
  assert.deepEqual(compacted, [])
  assert.deepEqual(asked, [h.directory])
  // 空間足夠剛好兩倍時放行（BigInt 結果也可接受）。
  const exact = sqliteFootprintBytes(h.paths.history) * 2
  assert.equal((await maintenance(h, { statfs: async () => ({ bavail: BigInt(exact + 1_000_000), bsize: 1n }) }).run()).ok, true)
})

test('maintenance yields between databases and rechecks scanning before each compact', async t => {
  const h = harness(t)
  const order: string[] = []
  for (const [name, store] of [['history', h.history], ['progression', h.progression], ['achievements', h.achievements]] as const) {
    const original = store.compact.bind(store)
    store.compact = () => { order.push(name); original() }
  }
  // 在第一個 compact 之後的讓出期間啟動掃描：第二個資料庫不可被整理。
  let scanning = false
  const timer = { fired: false }
  const service = maintenance(h, { scanning: () => scanning })
  const originalCompact = h.history.compact.bind(h.history)
  h.history.compact = () => { originalCompact(); order.push('history-done'); setImmediate(() => { timer.fired = true }); setImmediate(() => { scanning = true }) }
  assert.deepEqual(await service.run(), { ok: false, error: 'scanning' })
  assert.equal(timer.fired, true)
  assert.deepEqual(order, ['history', 'history-done'])

  // 讓出期間有交易：compact 回報 busy。
  scanning = false
  raw(h.progression).exec('BEGIN IMMEDIATE')
  assert.deepEqual(await maintenance(h).run(), { ok: false, error: 'busy' })
  raw(h.progression).exec('ROLLBACK')
})

test('maintenance proceeds when statfs itself fails, since VACUUM would roll back safely', async t => {
  const h = harness(t)
  const result = await maintenance(h, { statfs: async () => { throw new Error('ENOSYS') } }).run()
  assert.equal(result.ok, true)
  const nan = await maintenance(h, { statfs: async () => ({ bavail: Number.NaN, bsize: 4096 }) }).run()
  assert.equal(nan.ok, true)
})

function ipcHarness(overrides: { resetResult?: GrowthResetResult } = {}) {
  const { ipcMain, handlers } = createFakeIpcMain()
  const panel = fakeBrowserWindow()
  let resets = 0
  let runs = 0
  let clock = 1_000_000
  registerGrowthMaintenanceIpc({
    ipcMain,
    assertTrustedIpcSender: (event, required) => {
      if ((event as unknown as { sender: unknown }).sender !== required) throw new Error('untrusted sender')
    },
    getPanelWindow: () => panel,
    resetGrowth: () => { resets += 1; return overrides.resetResult ?? { ok: true } },
    runDbMaintenance: async () => { runs += 1; return { ok: true, beforeBytes: 2, afterBytes: 1, freedBytes: 1, prunedRows: 0 } },
    now: () => clock,
  })
  return {
    invoke: (channel: string, sender: unknown, ...args: unknown[]) => handlers.get(channel)?.({ sender }, ...args),
    panel,
    counts: () => ({ resets, runs }),
    advance: (ms: number) => { clock += ms },
    channels: [...handlers.keys()],
  }
}

type ArmResult = { ok: true, token: string } | { ok: false, error: string }
const arm = async (h: ReturnType<typeof ipcHarness>): Promise<string> => {
  const result = await h.invoke(IPC_CHANNELS.growthResetArm, h.panel) as ArmResult
  assert.equal(result.ok, true)
  return (result as { token: string }).token
}

test('growth reset IPC only serves the panel window and rejects missing or malformed tokens', async () => {
  const h = ipcHarness()
  assert.deepEqual(h.channels, [IPC_CHANNELS.growthResetArm, IPC_CHANNELS.growthReset, IPC_CHANNELS.dbMaintenanceRun])
  assert.throws(() => h.invoke(IPC_CHANNELS.growthResetArm, { id: 'pet' }), /untrusted/)
  assert.throws(() => h.invoke(IPC_CHANNELS.growthReset, { id: 'pet' }, 'x'), /untrusted/)
  assert.deepEqual(h.counts(), { resets: 0, runs: 0 })
  // 沒有 arm 過：任何值都拒絕，包含舊版的固定字面值。
  for (const bad of [undefined, null, 'reset-growth', 1]) {
    h.advance(GROWTH_RESET_MIN_INTERVAL_MS)
    assert.deepEqual(await h.invoke(IPC_CHANNELS.growthReset, h.panel, bad), { ok: false, error: 'invalid_request' })
  }
  // arm 之後，缺少、型別錯誤、長度錯誤、同長度錯誤值都拒絕，且每次嘗試都會讓 token 失效。
  for (const bad of [undefined, null, true, 7, {}, [], '', 'short', 'x'.repeat(64), '0'.repeat(64)]) {
    const token = await arm(h)
    assert.notEqual(token, bad)
    assert.deepEqual(await h.invoke(IPC_CHANNELS.growthReset, h.panel, bad), { ok: false, error: 'invalid_request' })
    assert.deepEqual(await h.invoke(IPC_CHANNELS.growthReset, h.panel, token), { ok: false, error: 'invalid_request' })
    h.advance(GROWTH_RESET_ARM_MIN_INTERVAL_MS)
  }
  assert.equal(h.counts().resets, 0)
})

test('growth reset IPC succeeds once after arm and the token is single-use', async () => {
  const h = ipcHarness()
  const token = await arm(h)
  assert.match(token, /^[0-9a-f]{64}$/)
  assert.deepEqual(await h.invoke(IPC_CHANNELS.growthReset, h.panel, token), { ok: true })
  assert.equal(h.counts().resets, 1)
  h.advance(GROWTH_RESET_MIN_INTERVAL_MS)
  assert.deepEqual(await h.invoke(IPC_CHANNELS.growthReset, h.panel, token), { ok: false, error: 'invalid_request' })
  assert.equal(h.counts().resets, 1)
})

test('growth reset IPC token expires, only the newest token is valid, and a failed reset still burns it', async () => {
  const h = ipcHarness({ resetResult: { ok: false, error: 'failed' } })
  const expired = await arm(h)
  h.advance(GROWTH_RESET_TOKEN_TTL_MS + 1)
  assert.deepEqual(await h.invoke(IPC_CHANNELS.growthReset, h.panel, expired), { ok: false, error: 'invalid_request' })

  const older = await arm(h)
  h.advance(GROWTH_RESET_ARM_MIN_INTERVAL_MS)
  const newer = await arm(h)
  assert.notEqual(older, newer)
  assert.deepEqual(await h.invoke(IPC_CHANNELS.growthReset, h.panel, older), { ok: false, error: 'invalid_request' })
  // 舊 token 的嘗試已讓目前 token 一併失效。
  assert.deepEqual(await h.invoke(IPC_CHANNELS.growthReset, h.panel, newer), { ok: false, error: 'invalid_request' })
  assert.equal(h.counts().resets, 0)

  h.advance(GROWTH_RESET_ARM_MIN_INTERVAL_MS)
  const last = await arm(h)
  h.advance(GROWTH_RESET_TOKEN_TTL_MS)
  assert.deepEqual(await h.invoke(IPC_CHANNELS.growthReset, h.panel, last), { ok: false, error: 'failed' })
  assert.deepEqual(await h.invoke(IPC_CHANNELS.growthReset, h.panel, last), { ok: false, error: 'invalid_request' })
  assert.equal(h.counts().resets, 1)
})

test('growth reset IPC rate limits both arming and repeated resets', async () => {
  const h = ipcHarness()
  const token = await arm(h)
  assert.deepEqual(await h.invoke(IPC_CHANNELS.growthResetArm, h.panel), { ok: false, error: 'rate_limited' })
  assert.deepEqual(await h.invoke(IPC_CHANNELS.growthReset, h.panel, token), { ok: true })
  h.advance(GROWTH_RESET_ARM_MIN_INTERVAL_MS)
  const second = await arm(h)
  assert.deepEqual(await h.invoke(IPC_CHANNELS.growthReset, h.panel, second), { ok: false, error: 'rate_limited' })
  assert.equal(h.counts().resets, 1)
  h.advance(GROWTH_RESET_MIN_INTERVAL_MS)
  assert.deepEqual(await h.invoke(IPC_CHANNELS.growthReset, h.panel, await arm(h)), { ok: true })
})

test('db maintenance IPC only serves the panel window and rate limits', async () => {
  const h = ipcHarness()
  assert.throws(() => h.invoke(IPC_CHANNELS.dbMaintenanceRun, { id: 'pet' }), /untrusted/)
  assert.equal(h.counts().runs, 0)
  assert.equal(((await h.invoke(IPC_CHANNELS.dbMaintenanceRun, h.panel)) as { ok: boolean }).ok, true)
  assert.deepEqual(await h.invoke(IPC_CHANNELS.dbMaintenanceRun, h.panel), { ok: false, error: 'rate_limited' })
  assert.equal(h.counts().runs, 1)
  h.advance(DB_MAINTENANCE_MIN_INTERVAL_MS)
  assert.equal(((await h.invoke(IPC_CHANNELS.dbMaintenanceRun, h.panel)) as { ok: boolean }).ok, true)
})

test('formatBytes renders binary units with at most one decimal and tolerates bad input', () => {
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(1023), '1023 B')
  assert.equal(formatBytes(1024), '1 KB')
  assert.equal(formatBytes(1536), '1.5 KB')
  assert.equal(formatBytes(5 * 1024 * 1024), '5 MB')
  assert.equal(formatBytes(3 * 1024 ** 3), '3 GB')
  assert.equal(formatBytes(2048 * 1024 ** 3), '2048 GB')
  assert.equal(formatBytes(Number.NaN), '0 B')
  assert.equal(formatBytes(-5), '0 B')
})
