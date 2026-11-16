import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import {
  ACHIEVEMENT_PROGRESS_DEBOUNCE_MS,
  ACHIEVEMENT_STORE_RETRY_DELAYS_MS,
  createGrowthService,
  type GrowthState,
  type GrowthWindow,
} from '../electron/main/growth-service.ts'
import { IPC_CHANNELS } from '../electron/ipc/channels.ts'
import type { AchievementStore } from '../electron/achievements.ts'
import type { HistoryStore } from '../electron/history.ts'
import type { ProgressionStore } from '../electron/progression.ts'
import type { AgentStatusEvent } from '../src/types/agent.ts'
import type { ProgressionAward, ProgressionEventResult, ProgressionSnapshot } from '../src/types/progression.ts'
import { makeAgentStatusEvent } from './support/agent-status-event.mts'
import { fakeService } from './support/fake-service.mts'

// 階段 11 之前在 electron/main/runtime.ts 內的成就／progression 行為，改由抽出的服務搭配
// 假 store、假視窗與 node:test 假計時器驗證。

const snapshot = (xp: number): ProgressionSnapshot => ({
  petId: 'pet-a', totalXp: xp, level: 1, xpIntoLevel: xp, xpToNext: 10, evolutionStage: 'egg',
  currentStreak: 0, longestStreak: 0, updatedAt: 1,
})

function fakeWindow(sent: Array<[string, unknown]>, visible = true): GrowthWindow {
  return {
    isDestroyed: () => false,
    isVisible: () => visible,
    webContents: { send: (channel: string, payload?: unknown) => { sent.push([channel, payload]) } },
  }
}

function setup(t: TestContext, options: { failOpens?: number; enabled?: boolean; progressionXp?: number; hiddenWindow?: boolean } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const calls: string[] = []
  const sent: Array<[string, unknown]> = []
  const logged: string[] = []
  let failOpens = options.failOpens ?? 0
  let enabled = options.enabled ?? true
  let xp = options.progressionXp ?? 1
  let ledgerChanged = true
  const unlocks: unknown[] = []
  const achievement = fakeService<AchievementStore>({
    recordEvent: () => { calls.push('recordEvent'); return unlocks },
    getSnapshot: () => ({ snap: true }),
    syncLocalTokenUsage: () => { calls.push('sync'); return { changed: ledgerChanged } },
    evaluateTokenAchievements: () => { calls.push('evaluate'); return unlocks },
    reconcileCompletedSessions: () => { calls.push('reconcile'); return [] },
    getGrowthResetAt: () => 0,
    close: () => calls.push('achievement.close'),
  })
  const progression = fakeService<ProgressionStore>({
    getActivePetId: () => 'pet-a',
    getSnapshot: () => snapshot(xp),
    setActivePet: () => snapshot(xp),
    handleEvent: () => { calls.push('handleEvent'); return { snapshot: snapshot(xp), awards: [], levelBefore: 1, stageBefore: 'egg' } },
    close: () => calls.push('progression.close'),
  })
  const state: GrowthState = {
    progressionStore: null,
    achievementStore: null,
    achievementStoreRetryTimer: null,
    achievementStoreRetryAttempt: 0,
    historyStore: fakeService<HistoryStore>({
      getAchievementReconciledAt: () => 0,
      getAchievementCompletedSessions: () => [],
      setAchievementReconciledAt: () => { calls.push('reconciledAt') },
    }),
    desktopNotifications: null,
  }
  const hiddenSent: Array<[string, unknown]> = []
  const hiddenWindow = options.hiddenWindow ? fakeWindow(hiddenSent, false) : undefined
  const windows = [fakeWindow(sent), hiddenWindow ?? null]
  const service = createGrowthService({
    state,
    getWindows: () => windows,
    openProgressionStore: () => progression,
    openAchievementStore: () => {
      calls.push('open')
      if (failOpens > 0) { failOpens -= 1; throw new Error('locked') }
      return achievement
    },
    achievementsEnabled: () => enabled,
    logError: message => { logged.push(message) },
    logMain: (_level, _channel, message) => { logged.push(message) },
  })
  return {
    service, state, calls, sent, logged, unlocks, hiddenSent, hiddenWindow,
    setEnabled: (v: boolean) => { enabled = v },
    setXp: (v: number) => { xp = v },
    setLedgerChanged: (v: boolean) => { ledgerChanged = v },
  }
}

const eventOf = (over: Partial<AgentStatusEvent> = {}): AgentStatusEvent => makeAgentStatusEvent(over.state ?? 'thinking', over)

test('achievement init retries with 3s/10s/30s backoff and stops at the cap', t => {
  const h = setup(t, { failOpens: 99 })
  h.service.startAchievements()
  assert.equal(h.calls.filter(c => c === 'open').length, 1)
  let opens = 1
  for (const delay of ACHIEVEMENT_STORE_RETRY_DELAYS_MS) {
    t.mock.timers.tick(delay - 1)
    assert.equal(h.calls.filter(c => c === 'open').length, opens)
    t.mock.timers.tick(1)
    opens += 1
    assert.equal(h.calls.filter(c => c === 'open').length, opens)
  }
  t.mock.timers.tick(10 * 60_000)
  assert.equal(h.calls.filter(c => c === 'open').length, opens)
  assert.equal(h.state.achievementStoreRetryTimer, null)
  assert.equal(h.state.achievementStoreRetryAttempt, ACHIEVEMENT_STORE_RETRY_DELAYS_MS.length)
})

test('a successful retry clears the timer, pushes a snapshot and reconciles history', t => {
  const h = setup(t, { failOpens: 1 })
  h.service.startProgression()
  h.service.startAchievements()
  assert.ok(h.state.achievementStoreRetryTimer)
  t.mock.timers.tick(ACHIEVEMENT_STORE_RETRY_DELAYS_MS[0])
  assert.ok(h.state.achievementStore)
  assert.equal(h.state.achievementStoreRetryTimer, null)
  assert.equal(h.state.achievementStoreRetryAttempt, 0)
  assert.ok(h.sent.some(([channel]) => channel.includes('chievements')))
  assert.ok(h.calls.includes('reconcile'))
})

test('event hot path only records success or token-usage events while enabled', t => {
  const h = setup(t)
  h.service.startProgression()
  h.service.startAchievements()
  h.calls.length = 0
  h.service.handleEvent(eventOf())
  assert.deepEqual(h.calls, ['handleEvent'])
  h.service.handleEvent(eventOf({ state: 'success' }))
  h.service.handleEvent(eventOf({ tokenUsage: { input: 1, output: 0, quality: 'exact' } }))
  assert.equal(h.calls.filter(c => c === 'recordEvent').length, 2)
  h.setEnabled(false)
  h.service.handleEvent(eventOf({ state: 'success' }))
  assert.equal(h.calls.filter(c => c === 'recordEvent').length, 2)
})

test('an unchanged progression snapshot is not broadcast again', t => {
  const h = setup(t)
  h.service.startProgression()
  h.service.handleEvent(eventOf())
  const count = h.sent.length
  assert.equal(count, 1)
  h.service.handleEvent(eventOf())
  assert.equal(h.sent.length, count)
  h.setXp(5)
  h.service.handleEvent(eventOf())
  assert.equal(h.sent.length, count + 1)
})

test('local token ledger updates while disabled but only evaluates when enabled, once per scan', t => {
  const h = setup(t, { enabled: false })
  h.service.startProgression()
  h.service.startAchievements()
  h.calls.length = 0
  h.service.syncLocalTokenUsage([], 30)
  h.service.syncLocalTokenUsage([], 30)
  h.service.evaluateLocalTokens()
  h.service.evaluateLocalTokens()
  assert.equal(h.calls.filter(c => c === 'sync').length, 2)
  assert.equal(h.calls.includes('evaluate'), false)
  h.setEnabled(true)
  h.service.syncLocalTokenUsage([], 30)
  h.service.syncLocalTokenUsage([], 30)
  h.service.evaluateLocalTokens()
  h.service.evaluateLocalTokens()
  assert.equal(h.calls.filter(c => c === 'evaluate').length, 1)
})

test('progress broadcast is debounced and dispose cancels it', t => {
  const h = setup(t)
  h.service.startProgression()
  h.service.startAchievements()
  h.sent.length = 0
  h.service.syncLocalTokenUsage([], 30)
  h.service.evaluateLocalTokens()
  h.service.syncLocalTokenUsage([], 30)
  h.service.evaluateLocalTokens()
  t.mock.timers.tick(ACHIEVEMENT_PROGRESS_DEBOUNCE_MS)
  assert.equal(h.sent.length, 1)

  h.service.syncLocalTokenUsage([], 30)
  h.service.evaluateLocalTokens()
  h.service.dispose()
  h.sent.length = 0
  t.mock.timers.tick(ACHIEVEMENT_PROGRESS_DEBOUNCE_MS * 2)
  assert.equal(h.sent.length, 0)
})

test('dispose releases progression, retry timer and achievement store in order', t => {
  const h = setup(t, { failOpens: 1 })
  h.service.startProgression()
  h.service.startAchievements()
  h.service.dispose()
  assert.equal(h.state.achievementStoreRetryTimer, null)
  h.calls.length = 0
  t.mock.timers.tick(60_000)
  assert.equal(h.calls.includes('open'), false)
})

test('dispose closes both stores in order and is idempotent', t => {
  const g = setup(t)
  g.service.startProgression()
  g.service.startAchievements()
  g.calls.length = 0
  g.service.dispose()
  g.service.dispose()
  assert.deepEqual(g.calls, ['progression.close', 'achievement.close'])
  assert.equal(g.state.progressionStore, null)
  assert.equal(g.state.achievementStore, null)
})

test('a window hidden during a broadcast gets exactly one resync on show', t => {
  const h = setup(t, { hiddenWindow: true })
  h.service.startProgression()
  h.service.broadcastProgression()
  assert.equal(h.hiddenSent.length, 0)
  h.service.resyncProgression(h.hiddenWindow!)
  assert.equal(h.hiddenSent.length, 1)
  h.service.resyncProgression(h.hiddenWindow!)
  assert.equal(h.hiddenSent.length, 1)
})

test('granted awards are broadcast with level and stage transitions; an empty result sends nothing', t => {
  const h = setup(t)
  const base = { snapshot: { ...snapshot(5), level: 2, evolutionStage: 'baby' as const }, levelBefore: 1, stageBefore: 'egg' as const } satisfies Omit<ProgressionEventResult, 'awards'>
  h.service.broadcastProgressionAwards({ ...base, awards: [] })
  assert.equal(h.sent.filter(([channel]) => channel === IPC_CHANNELS.progressionAwarded).length, 0)

  // 以變數傳入以保留額外欄位 extra：驗證服務不會把 ledger 的其他欄位送出去。
  const award = { ruleId: 'task-success', amount: 3, extra: 'dropped' }
  const awards: ProgressionAward[] = [award]
  h.service.broadcastProgressionAwards({ ...base, awards })
  const awarded = h.sent.filter(([channel]) => channel === IPC_CHANNELS.progressionAwarded)
  assert.equal(awarded.length, 1)
  const payload = awarded[0][1] as Record<string, unknown>
  // 只送出規則與數量；ledger 的其他欄位不外流到 renderer。
  assert.deepEqual(payload.awards, [{ ruleId: 'task-success', amount: 3 }])
  assert.deepEqual(
    { petId: payload.petId, levelBefore: payload.levelBefore, levelAfter: payload.levelAfter, stageBefore: payload.stageBefore, stageAfter: payload.stageAfter },
    { petId: 'pet-a', levelBefore: 1, levelAfter: 2, stageBefore: 'egg', stageAfter: 'baby' },
  )
})
