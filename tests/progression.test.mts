import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProgressionStore } from '../electron/progression.ts'
import {
  evolutionStageForLevel,
  levelForTotalXp,
  totalXpForLevel,
  xpToNext,
} from '../src/types/progression.ts'

function event(state: 'thinking' | 'tool-running' | 'success' | 'error', timestamp: number, sessionId = 'session-1') {
  return {
    source: 'codex' as const,
    sessionId,
    state,
    timestamp,
  }
}

function withStore<T>(work: (store: ProgressionStore, path: string) => T): T {
  const directory = mkdtempSync(join(tmpdir(), 'agent-pets-progression-'))
  const path = join(directory, 'progression.sqlite')
  const store = new ProgressionStore(path, { now: () => 1_700_000_000_000 })
  try {
    return work(store, path)
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

test('progression policy derives levels and evolution without floating point state', () => {
  assert.equal(xpToNext(1), 100)
  assert.equal(totalXpForLevel(5), 550)
  assert.equal(levelForTotalXp(549), 4)
  assert.equal(levelForTotalXp(550), 5)
  assert.equal(evolutionStageForLevel(1), 'egg')
  assert.equal(evolutionStageForLevel(5), 'baby')
  assert.equal(evolutionStageForLevel(35), 'master')
})

test('completed sessions award XP once and survive restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-pets-progression-restart-'))
  const path = join(directory, 'progression.sqlite')
  const first = new ProgressionStore(path)
  const firstResult = first.handleEvent(event('success', Date.now()))
  assert.equal(firstResult.awards.reduce((sum, award) => sum + award.amount, 0), 30)
  assert.equal(firstResult.snapshot.totalXp, 30)
  first.close()

  const second = new ProgressionStore(path)
  const duplicate = second.handleEvent(event('success', Date.now()))
  assert.equal(duplicate.awards.length, 0)
  assert.equal(duplicate.snapshot.totalXp, 30)
  second.close()
  rmSync(directory, { recursive: true, force: true })
})

test('failed sessions do not award permanent XP', () => {
  withStore((store) => {
    const result = store.handleEvent(event('error', Date.now()))
    assert.equal(result.awards.length, 0)
    assert.equal(result.snapshot.totalXp, 0)
  })
})

test('observed active time is capped per session and idempotent', () => {
  withStore((store) => {
    const start = 1_700_000_000_000
    store.handleEvent(event('thinking', start, 'active-session'))
    let result = store.handleEvent(event('tool-running', start + 5 * 60 * 1000, 'active-session'))
    let awarded = result
    for (let minute = 10; minute <= 35; minute += 5) {
      result = store.handleEvent(event('tool-running', start + minute * 60 * 1000, 'active-session'))
      if (result.awards.length > 0) awarded = result
    }
    assert.equal(awarded.awards.reduce((sum, award) => sum + award.amount, 0), 2)
    const duplicate = store.handleEvent(event('tool-running', start + 31 * 60 * 1000, 'active-session'))
    assert.equal(duplicate.awards.length, 0)
    assert.equal(duplicate.snapshot.totalXp, 2)
  })
})

test('streak increments only on the next local day', () => {
  withStore((store) => {
    const dayOne = new Date(2026, 0, 1, 12).getTime()
    const dayTwo = new Date(2026, 0, 2, 12).getTime()
    const first = store.handleEvent(event('success', dayOne, 'day-one'))
    assert.equal(first.snapshot.currentStreak, 1)
    assert.equal(first.snapshot.longestStreak, 1)

    const second = store.handleEvent(event('success', dayTwo, 'day-two'))
    assert.equal(second.snapshot.currentStreak, 2)
    assert.equal(second.snapshot.longestStreak, 2)
    assert.equal(second.awards.some((award) => award.ruleId.endsWith('daily-streak')), true)
  })
})

test('project routing snapshots XP to the routed pet and keeps route changes separate', () => {
  withStore((store) => {
    const projectA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const projectB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    const first = store.handleEvent({
      ...event('success', 1_700_000_000_000, 'shared-session'),
      projectId: projectA,
    }, 'wolf')
    assert.equal(first.snapshot.petId, 'wolf')
    assert.equal(first.snapshot.totalXp, 30)

    const second = store.handleEvent({
      ...event('success', 1_700_000_001_000, 'shared-session'),
      projectId: projectB,
    }, 'aang-airbender')
    assert.equal(second.snapshot.petId, 'aang-airbender')
    assert.equal(second.snapshot.totalXp, 30)
    assert.equal(store.getSnapshot('wolf').totalXp, 30)
  })
})

test('a success event reports each award plus the level boundary it crossed', () => {
  withStore(store => {
    const result = store.handleEvent(event('success', 1_700_000_000_000))
    assert.deepEqual(result.awards.map(award => award.ruleId).sort(), [
      'v1.first-completion-of-day',
      'v1.session-completed',
    ])
    assert.equal(result.levelBefore, 1)
    assert.equal(result.stageBefore, 'egg')
    // Replaying the same event grants nothing: awards are idempotent.
    assert.deepEqual(store.handleEvent(event('success', 1_700_000_000_000)).awards, [])
  })
})

test('insights expose today XP, the claimed daily bonus, recent ledger and a pace estimate', () => {
  const day = 24 * 60 * 60 * 1000
  const base = 1_700_000_000_000
  const directory = mkdtempSync(join(tmpdir(), 'agent-pets-progression-insights-'))
  let now = base
  const store = new ProgressionStore(join(directory, 'progression.sqlite'), { now: () => now })
  try {
    assert.equal(store.getInsights().firstCompletionClaimed, false)
    assert.equal(store.getInsights().averageDailyXp, null)
    for (let index = 0; index < 3; index += 1) {
      now = base + index * day
      store.handleEvent(event('success', now, `s-${index}`))
    }
    const insights = store.getInsights()
    assert.equal(insights.firstCompletionClaimed, true)
    assert.ok(insights.todayXp >= 30)
    assert.ok(insights.recent.length >= 2 && insights.recent[0].occurredAt >= insights.recent[1].occurredAt)
    assert.ok(insights.averageDailyXp !== null && insights.averageDailyXp > 0)
    assert.equal(store.getRecentLedger('aang-airbender', 1).length, 1)
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('a late event for an earlier day pays XP but never resets the streak', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-pets-progression-late-'))
  const day = 24 * 60 * 60 * 1000
  const base = Date.UTC(2026, 2, 10, 12)
  const store = new ProgressionStore(join(directory, 'progression.sqlite'), { now: () => base + 3 * day })
  try {
    store.handleEvent(event('success', base, 'd1'))
    store.handleEvent(event('success', base + day, 'd2'))
    const head = store.handleEvent(event('success', base + 2 * day, 'd3')).snapshot
    assert.equal(head.currentStreak, 3)
    const late = store.handleEvent(event('success', base - 5 * day, 'late'))
    assert.ok(late.awards.length > 0)
    assert.equal(late.snapshot.currentStreak, 3)
    assert.equal(late.snapshot.lastActiveLocalDate, head.lastActiveLocalDate)
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('streak continues across a DST change when days are identified by local date', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-pets-progression-dst-'))
  const dates = ['2026-03-07', '2026-03-08', '2026-03-09']
  const store = new ProgressionStore(join(directory, 'progression.sqlite'), {
    now: () => 0,
    localDate: timestamp => dates[timestamp] ?? '2026-03-09',
  })
  try {
    let last = store.getSnapshot()
    for (let index = 0; index < dates.length; index += 1) last = store.handleEvent(event('success', index, `dst-${index}`)).snapshot
    assert.equal(last.currentStreak, 3)
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('integration test events from the Setup Wizard never award XP', () => {
  withStore((store) => {
    const before = store.getSnapshot('default')
    const result = store.handleEvent({
      ...event('success', 1_700_000_000_000, 'agent-pets-test-codex-1'),
      originalEvent: 'AgentPetsIntegrationTest',
    } as never)
    assert.deepEqual(result.awards, [])
    assert.equal(store.getSnapshot('default').totalXp, before.totalXp)
  })
})

test('progression DB uses WAL + synchronous=NORMAL and ensurePet writes each pet only once', () => {
  withStore((store) => {
    assert.deepEqual(store.getPragmaState(), { journalMode: 'wal', synchronous: 1 })
    const db = (store as unknown as { database: { prepare(sql: string): { get(): Record<string, number> } } }).database
    const changes = () => Number(db.prepare('SELECT total_changes() AS n').get().n)
    store.getSnapshot('wolf')
    const afterFirst = changes()
    for (let i = 0; i < 20; i += 1) store.getSnapshot('wolf')
    assert.equal(changes(), afterFirst, 'cached ensurePet must not write again')
  })
})

test('heartbeat snapshot reuse is identical to a fresh read and XP stays idempotent', () => {
  withStore((store) => {
    const start = 1_700_000_000_000
    store.handleEvent(event('thinking', start, 'hb'))
    const beat = store.handleEvent(event('tool-running', start + 60_000, 'hb'))
    assert.deepEqual(beat.awards, [])
    assert.deepEqual(beat.snapshot, store.getSnapshot())
    // Crossing the 30-minute interval awards exactly once, however often it is replayed.
    let total = 0
    for (let minute = 2; minute <= 40; minute += 1) {
      const result = store.handleEvent(event('tool-running', start + minute * 60_000, 'hb'))
      total += result.awards.reduce((sum, award) => sum + award.amount, 0)
      assert.deepEqual(result.snapshot, store.getSnapshot())
    }
    const replay = store.handleEvent(event('tool-running', start + 40 * 60_000, 'hb'))
    assert.deepEqual(replay.awards, [])
    assert.ok(total > 0)
    const done = store.handleEvent(event('success', start + 41 * 60_000, 'hb'))
    assert.deepEqual(done.snapshot, store.getSnapshot())
    assert.deepEqual(store.handleEvent(event('success', start + 41 * 60_000, 'hb')).awards, [])
  })
})

test('stale session activity is pruned without changing XP or allowing double payment', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-pets-progression-prune-'))
  const path = join(directory, 'progression.sqlite')
  let clock = 1_700_000_000_000
  const store = new ProgressionStore(path, { now: () => clock })
  try {
    const start = clock
    const work = (session: string, from: number): number => {
      let total = 0
      store.handleEvent(event('thinking', from, session))
      for (let minute = 4; minute <= 40; minute += 4) {
        total = store.handleEvent(event('tool-running', from + minute * 60_000, session)).snapshot.totalXp
      }
      return total
    }
    const beforeTotal = work('old', start)
    assert.ok(beforeTotal > 0)
    store.handleEvent(event('thinking', start + 41 * 60_000, 'fresh'))
    clock = start + 100 * 24 * 60 * 60 * 1000
    store.handleEvent(event('thinking', clock - 1000, 'fresh2'))
    assert.equal(store.pruneStaleActivity(), 2, 'old and fresh were idle > 90 days')
    const db = (store as unknown as { database: { prepare(sql: string): { get(): Record<string, number> } } }).database
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM xp_session_activity').get().n), 1)
    // Replaying the old session after expiry restarts counting but the ledger keeps XP idempotent.
    assert.equal(work('old', clock), beforeTotal)
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
