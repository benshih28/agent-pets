import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AchievementStore } from '../electron/achievements.ts'
import {
  ACHIEVEMENT_DEFINITIONS,
  evaluateAchievements,
  type AchievementEvaluationContext,
} from '../src/types/achievement.ts'

const BASE_TIME = Date.UTC(2026, 0, 1, 12)

function localDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

function localHour(timestamp: number): number {
  return new Date(timestamp).getUTCHours()
}

function event(
  state: 'thinking' | 'success',
  timestamp: number,
  sessionId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    source: 'codex' as const,
    sessionId,
    state,
    timestamp,
    ...overrides,
  }
}

function withStore<T>(work: (store: AchievementStore, path: string) => T): T {
  const directory = mkdtempSync(join(tmpdir(), 'agent-pets-achievements-'))
  const path = join(directory, 'achievements.sqlite')
  let clock = BASE_TIME
  const store = new AchievementStore(path, {
    now: () => clock,
    localDate,
    localHour,
  })
  try {
    return work(store, path)
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

test('registry exposes the fourteen versioned, presentation-only rules', () => {
  assert.equal(ACHIEVEMENT_DEFINITIONS.length, 14)
  assert.equal(new Set(ACHIEVEMENT_DEFINITIONS.map(definition => definition.id)).size, 14)

  const base: AchievementEvaluationContext = {
    completedSessions: 0,
    completedSessionsToday: 0,
    tokenTotal: 0,
    tokenQuality: 'none',
    adapterCount: 0,
    activeDays: 0,
    nightOwlCompletion: false,
    currentStreak: 0,
    level: 1,
  }
  assert.deepEqual(evaluateAchievements(base), [])
  const unlocked = evaluateAchievements({
    ...base,
    completedSessions: 100,
    completedSessionsToday: 20,
    tokenTotal: 1_000_000,
    tokenQuality: 'estimated',
    adapterCount: 3,
    activeDays: 30,
    nightOwlCompletion: true,
    currentStreak: 7,
    level: 20,
  })
  // The ten originals plus the 10-session and 3-day-streak ladder steps.
  assert.equal(unlocked.length, 12)
  assert.equal(unlocked.find(item => item.id === 'one_million')?.tokenQuality, 'estimated')
})

test('unlocks are idempotent per pet and survive a store restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-pets-achievements-restart-'))
  const path = join(directory, 'achievements.sqlite')
  const first = new AchievementStore(path, { localDate, localHour })
  const firstUnlocks = first.recordEvent(event('success', BASE_TIME, 'first-session'), 'wolf')
  assert.equal(firstUnlocks.some(unlock => unlock.achievementId === 'hello_world'), true)
  assert.equal(first.recordEvent(event('success', BASE_TIME, 'first-session'), 'wolf').length, 0)
  assert.equal(first.getSnapshot('wolf').totalUnlocked, 1)
  first.close()

  const second = new AchievementStore(path, { localDate, localHour })
  assert.equal(second.getSnapshot('wolf').totalUnlocked, 1)
  assert.equal(second.recordEvent(event('success', BASE_TIME, 'second-session'), 'wolf').length, 0)
  second.close()
  rmSync(directory, { recursive: true, force: true })
})

test('Night Owl uses the injected local hour boundary', () => {
  withStore((store) => {
    const beforeBoundary = store.recordEvent(
      event('success', Date.UTC(2026, 0, 2, 4, 59), 'night-session'),
      'wolf',
    )
    assert.equal(beforeBoundary.some(unlock => unlock.achievementId === 'night_owl'), true)

    const afterBoundary = store.recordEvent(
      event('success', Date.UTC(2026, 0, 2, 5), 'day-session'),
      'aang-airbender',
    )
    assert.equal(afterBoundary.some(unlock => unlock.achievementId === 'night_owl'), false)
  })
})

test('token achievement records quality and ignores replayed source events', () => {
  withStore((store) => {
    // Event-reported usage only counts for agents without a local log reader.
    const exactEvent = event('thinking', BASE_TIME, 'token-session', {
      source: 'opencode-cli',
      adapterId: 'opencode',
      eventId: 'token-event-1',
      tokenUsage: { input: 1_000_000, output: 0, quality: 'exact' },
    })
    const first = store.recordEvent(exactEvent, 'wolf')
    assert.equal(first.find(unlock => unlock.achievementId === 'one_million')?.tokenQuality, 'exact')
    assert.equal(store.recordEvent(exactEvent, 'wolf').length, 0)
    assert.equal(store.getSnapshot('wolf').achievements.find(item => item.id === 'one_million')?.tokenQuality, 'exact')

    const estimated = event('thinking', BASE_TIME, 'estimated-session', {
      source: 'opencode-desktop',
      adapterId: 'opencode',
      eventId: 'token-event-2',
      tokenUsage: { input: 1_000_000, output: 0, quality: 'estimated' },
    })
    const estimatedUnlocks = store.recordEvent(estimated, 'aang-airbender')
    assert.equal(estimatedUnlocks.find(unlock => unlock.achievementId === 'one_million')?.tokenQuality, 'estimated')
  })
})

test('adapter, busy-day, streak, and active-day rules use pet-scoped aggregates', () => {
  withStore((store) => {
    const adapters = [
      ['codex', 'codex-session'],
      ['claude-code', 'claude-session'],
      ['opencode', 'opencode-session'],
    ] as const
    const polyglotUnlocks = adapters.flatMap(([adapterId, sessionId], index) => store.recordEvent(
      event('success', BASE_TIME + index * 1_000, sessionId, { adapterId }),
      'wolf',
    ))
    assert.equal(polyglotUnlocks.some(unlock => unlock.achievementId === 'polyglot_agents'), true)

    const day = Date.UTC(2026, 0, 3, 12)
    let busyUnlocks: ReturnType<AchievementStore['recordEvent']> = []
    for (let index = 0; index < 20; index += 1) {
      busyUnlocks = busyUnlocks.concat(store.recordEvent(
        event('success', day + index * 1_000, `busy-${index}`),
        'busy-pet',
      ))
    }
    assert.equal(busyUnlocks.some(unlock => unlock.achievementId === 'busy_day'), true)

    const streak = store.recordEvent(
      event('success', day + 21_000, 'streak-session'),
      'streak-pet',
      {
        petId: 'streak-pet',
        totalXp: 0,
        level: 1,
        xpIntoLevel: 0,
        xpToNext: 100,
        evolutionStage: 'egg',
        currentStreak: 7,
        longestStreak: 7,
        updatedAt: day,
      },
    )
    assert.equal(streak.some(unlock => unlock.achievementId === 'loyal_companion'), true)

    let activeDayUnlocks: ReturnType<AchievementStore['recordEvent']> = []
    for (let index = 0; index < 30; index += 1) {
      activeDayUnlocks = activeDayUnlocks.concat(store.recordEvent(
        event('success', Date.UTC(2026, 1, 1 + index, 12), `active-${index}`),
        'old-pet',
      ))
    }
    assert.equal(activeDayUnlocks.some(unlock => unlock.achievementId === 'old_friend'), true)
    assert.equal(store.getSnapshot('wolf').totalUnlocked >= 2, true)
    assert.equal(store.getSnapshot('busy-pet').totalUnlocked, 3) // hello_world, sessions_10, busy_day
  })
})

test('history reconciliation backfills unique sessions without duplicate unlocks', () => {
  withStore((store) => {
    const existing = event('success', BASE_TIME, 'session-0', { projectId: 'a'.repeat(32) })
    assert.equal(store.recordEvent(existing, 'wolf').some(unlock => unlock.achievementId === 'hello_world'), true)
    const facts = Array.from({ length: 100 }, (_, index) => ({
      petId: 'wolf',
      source: 'codex',
      sessionId: `session-${index}`,
      projectId: 'a'.repeat(32),
      adapterId: 'codex',
      completedAt: BASE_TIME + index * 1_000,
    }))
    const unlocks = store.reconcileCompletedSessions(facts)
    assert.equal(unlocks.some(unlock => unlock.achievementId === 'getting_serious'), true)
    assert.equal(store.getSnapshot('wolf').achievements.find(item => item.id === 'getting_serious')?.unlocked, true)
    assert.equal(store.reconcileCompletedSessions(facts).length, 0)
  })
})

test('progress comes from the same facts as the unlock rules and never exceeds the target', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-pets-achievements-progress-'))
  const store = new AchievementStore(join(directory, 'achievements.sqlite'), { localDate, localHour })
  try {
    store.recordEvent(event('success', BASE_TIME, 'one'), 'wolf')
    store.recordEvent(event('success', BASE_TIME + 1_000, 'two'), 'wolf')
    const snapshot = store.getSnapshot('wolf', { petId: 'wolf', level: 7 } as never)
    const byId = new Map(snapshot.achievements.map(item => [item.id, item]))
    assert.deepEqual(byId.get('getting_serious')?.progress, { current: 2, target: 100 })
    assert.deepEqual(byId.get('sessions_10')?.progress, { current: 2, target: 10 })
    assert.deepEqual(byId.get('level_10')?.progress, { current: 7, target: 10 })
    assert.equal(byId.get('hello_world')?.unlocked, true)
    assert.equal(byId.get('night_owl')?.hidden, true)
    for (const item of snapshot.achievements) assert.ok(item.progress.current <= item.progress.target)
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('pet counters stay equal to a full recompute and replays return early', () => {
  withStore((store) => {
    const db = (store as unknown as { database: { prepare(sql: string): { get(...p: unknown[]): Record<string, number> } } }).database
    let seed = 11
    const rand = () => { seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0; return seed / 2 ** 32 }
    for (let i = 0; i < 300; i += 1) {
      const session = `s${Math.floor(rand() * 60)}`
      const pet = rand() < 0.5 ? 'aang-airbender' : 'wolf'
      const withTokens = rand() < 0.5
      const e = event('success', BASE_TIME + i * 1000, session, {
        ...(withTokens ? { eventId: `t${Math.floor(rand() * 80)}`, tokenUsage: { input: 10 + i, output: 5, quality: rand() < 0.5 ? 'exact' : 'estimated' } } : {}),
      })
      store.recordEvent(e as never, pet)
    }
    for (const pet of ['aang-airbender', 'wolf']) {
      const counters = db.prepare('SELECT * FROM pet_counters WHERE pet_id = ?').get(pet)
      const completed = db.prepare('SELECT COUNT(*) AS n FROM completed_sessions WHERE pet_id = ?').get(pet).n
      const tokens = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(quality = 'estimated'), 0) AS e, COALESCE(SUM(input_tokens + output_tokens), 0) AS t FROM token_usage WHERE pet_id = ?").get(pet)
      assert.equal(counters.completed_sessions, completed)
      assert.equal(counters.token_rows, tokens.n)
      assert.equal(counters.token_estimated, tokens.e)
      assert.equal(counters.token_total, tokens.t)
    }
    // A duplicate success evaluates nothing and unlocks nothing.
    assert.deepEqual(store.recordEvent(event('success', BASE_TIME, 's1') as never, 'aang-airbender'), [])
  })
})

test('v2 migration backfills counters and adds pet_id indexes to a v1 database', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-pets-achievements-v2-'))
  const path = join(directory, 'achievements.sqlite')
  try {
    const first = new AchievementStore(path, { now: () => BASE_TIME, localDate, localHour })
    for (let i = 0; i < 5; i += 1) first.recordEvent(event('success', BASE_TIME + i, `m${i}`, { source: 'opencode-cli', tokenUsage: { input: 100, output: 20, quality: 'exact' }, eventId: `e${i}` }) as never, 'aang-airbender')
    const raw = (first as unknown as { database: { exec(sql: string): void } }).database
    raw.exec('DROP TABLE pet_counters; DROP INDEX idx_token_usage_pet; DROP INDEX idx_completed_sessions_pet; DELETE FROM schema_migrations WHERE version = 2;')
    first.close()
    const second = new AchievementStore(path, { now: () => BASE_TIME, localDate, localHour })
    const db = (second as unknown as { database: { prepare(sql: string): { get(...p: unknown[]): Record<string, number>, all(...p: unknown[]): Array<Record<string, string>> } } }).database
    const row = db.prepare('SELECT * FROM pet_counters WHERE pet_id = ?').get('aang-airbender')
    assert.equal(row.completed_sessions, 5)
    assert.equal(row.token_rows, 5)
    assert.equal(row.token_total, 600)
    const plan = db.prepare('EXPLAIN QUERY PLAN SELECT COUNT(*) FROM token_usage WHERE pet_id = ?').all('aang-airbender').map(r => r.detail).join(' ')
    assert.match(plan, /idx_token_usage_pet/)
    assert.equal(second.getSnapshot('aang-airbender').totalUnlocked >= 0, true)
    assert.deepEqual(second.getPragmaState(), { journalMode: 'wal', synchronous: 1 })
    second.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('local-log tokens count once across rescans and streaming growth, and unlock one_million', () => {
  withStore((store) => {
    const compactBefore = BASE_TIME - 91 * 24 * 60 * 60 * 1000
    const records = Array.from({ length: 4 }, (_, i) => ({
      adapterId: 'claude-code', sourceEventId: `msg-${i}`, occurredAt: BASE_TIME - i * 1_000, input: 200_000, output: 40_000,
    }))
    const first = store.syncLocalTokenUsage(records, { compactBefore, evaluatePetId: 'wolf' })
    assert.equal(first.changed, true)
    assert.equal(first.unlocks.length, 0)
    const progress = () => store.getSnapshot('wolf').achievements.find(item => item.id === 'one_million')
    assert.equal(progress()?.progress?.current, 960_000)
    // A rescan presents the same ids: nothing changes, nothing unlocks.
    const rescan = store.syncLocalTokenUsage(records, { compactBefore, evaluatePetId: 'wolf' })
    assert.deepEqual(rescan, { changed: false, unlocks: [] })
    assert.equal(progress()?.progress?.current, 960_000)
    // A streamed message whose usage grew adds only the difference.
    const grown = store.syncLocalTokenUsage([{ ...records[0]!, output: 80_000 }], { compactBefore, evaluatePetId: 'wolf' })
    assert.equal(grown.unlocks.find(unlock => unlock.achievementId === 'one_million')?.tokenQuality, 'exact')
    assert.equal(progress()?.progress?.current, 1_000_000)
    // Account-level: another pet sees the same exact total.
    assert.equal(store.getSnapshot('aang-airbender').achievements.find(item => item.id === 'one_million')?.progress?.current, 1_000_000)
    // Unknown adapters and records older than the compaction horizon are ignored.
    assert.equal(store.syncLocalTokenUsage([
      { adapterId: 'opencode', sourceEventId: 'x', occurredAt: BASE_TIME, input: 5 },
      { adapterId: 'codex', sourceEventId: 'old', occurredAt: compactBefore - 1, input: 5 },
    ], { compactBefore, evaluatePetId: null }).changed, false)
  })
})

test('live Codex and Claude event tokens are ignored so local logs stay the single source', () => {
  withStore((store) => {
    for (const [source, adapterId] of [['codex', 'codex'], ['claude', 'claude-code'], ['claude-desktop', undefined]] as const) {
      store.recordEvent(event('thinking', BASE_TIME, `s-${source}`, {
        source, ...(adapterId ? { adapterId } : {}), eventId: `e-${source}`, tokenUsage: { input: 2_000_000, output: 0, quality: 'exact' },
      }) as never, 'wolf')
    }
    assert.equal(store.getSnapshot('wolf').achievements.find(item => item.id === 'one_million')?.progress?.current, 0)
  })
})

test('compaction drops old dedupe rows but keeps the running total', () => {
  withStore((store, path) => {
    const day = 24 * 60 * 60 * 1000
    store.syncLocalTokenUsage([
      { adapterId: 'codex', sourceEventId: 'old', occurredAt: BASE_TIME - 10 * day, input: 70 },
      { adapterId: 'codex', sourceEventId: 'new', occurredAt: BASE_TIME, input: 30 },
    ], { compactBefore: 0, evaluatePetId: null })
    store.syncLocalTokenUsage([], { compactBefore: BASE_TIME - 5 * day, evaluatePetId: null })
    const db = (store as unknown as { database: { prepare(sql: string): { get(): Record<string, number> } } }).database
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM local_token_usage').get().total, 1)
    assert.equal(store.getSnapshot('wolf').achievements.find(item => item.id === 'one_million')?.progress?.current, 100)
    void path
  })
})

test('ledger syncs without evaluation, then one evaluation per scan unlocks', () => {
  withStore((store) => {
    const compactBefore = 0
    for (let batch = 0; batch < 3; batch += 1) {
      const result = store.syncLocalTokenUsage(
        [{ adapterId: 'codex', sourceEventId: `b${batch}`, occurredAt: BASE_TIME, input: 400_000 }],
        { compactBefore, evaluatePetId: null },
      )
      assert.deepEqual(result.unlocks, [])
    }
    const unlocks = store.evaluateTokenAchievements('wolf')
    assert.equal(unlocks.find(unlock => unlock.achievementId === 'one_million')?.tokenQuality, 'exact')
    assert.deepEqual(store.evaluateTokenAchievements('wolf'), [])
  })
})
