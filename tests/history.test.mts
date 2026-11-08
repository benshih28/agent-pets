import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'
import { HistoryStore, safeModelId, trimQueuedEvents } from '../electron/history.ts'
import type { AgentStatusEvent } from '../src/types/agent.ts'

function databasePath(): { filePath: string; directory: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-history-'))
  return { filePath: path.join(directory, 'history.sqlite'), directory }
}

function event(overrides: Partial<AgentStatusEvent> = {}): AgentStatusEvent {
  return {
    adapterId: 'codex',
    source: 'codex',
    sessionId: 'session-1',
    state: 'thinking',
    timestamp: Date.UTC(2026, 7, 13, 1, 0, 0),
    ...overrides,
  }
}

test('history writes idempotent events and serves seven-day aggregates', (t) => {
  const dayOne = Date.UTC(2026, 7, 10, 1, 0, 0)
  const now = Date.UTC(2026, 7, 13, 1, 0, 0)
  const database = databasePath()
  const store = new HistoryStore(database.filePath, {
    now: () => now,
    localDate: timestamp => timestamp < Date.UTC(2026, 7, 13) ? '2026-08-10' : '2026-08-13',
  })
  t.after(() => { store.close(); fs.rmSync(database.directory, { recursive: true, force: true }) })

  assert.equal(store.recordEvent(event({ timestamp: dayOne, eventId: 'start' })), true)
  assert.equal(store.recordEvent(event({ state: 'tool-running', timestamp: dayOne + 60_000, eventId: 'tool' })), true)
  assert.equal(store.recordEvent(event({
    state: 'success',
    timestamp: dayOne + 120_000,
    eventId: 'finish',
    tokenUsage: { input: 120, output: 40, quality: 'exact' },
  })), true)
  assert.equal(store.recordEvent(event({ state: 'success', timestamp: dayOne + 120_000, eventId: 'finish' })), false)

  const summary = store.getSummary()
  const oldDay = summary.days.find(day => day.localDate === '2026-08-10')!
  assert.equal(oldDay.sessionsCompleted, 1)
  assert.equal(oldDay.activeMs, 120_000)
  assert.equal(oldDay.tokenInput, 120)
  assert.equal(oldDay.tokenOutput, 40)
  assert.equal(oldDay.tokenQuality, 'exact')
  assert.equal(summary.totals.sessionsCompleted, 1)
  assert.equal(summary.agents[0].adapterId, 'codex')
  assert.equal(summary.agents[0].tokenInput, 120)
  assert.equal(summary.agents[0].tokenOutput, 40)
  assert.equal(summary.agents[0].tokenQuality, 'exact')
})

test('history distinguishes estimated and exact token quality and redacts event content', (t) => {
  const now = Date.UTC(2026, 7, 13, 1, 0, 0)
  const database = databasePath()
  const store = new HistoryStore(database.filePath, { now: () => now })
  t.after(() => { store.close(); fs.rmSync(database.directory, { recursive: true, force: true }) })

  assert.equal(store.recordEvent(event({
    eventId: 'estimated',
    project: 'C:\\Users\\dgh\\private-project',
    tokenUsage: { input: 10, output: 5, quality: 'estimated' },
  })), true)
  const estimated = store.getSummary()
  assert.equal(estimated.tokenQuality, 'estimated')
  assert.equal(estimated.totals.tokenInput, 10)
  assert.equal(estimated.totals.tokenOutput, 5)

  assert.equal(store.recordEvent(event({
    eventId: 'exact',
    tokenUsage: { input: 20, output: 8, quality: 'exact' },
  })), true)
  const exact = store.getSummary()
  assert.equal(exact.tokenQuality, 'exact')
  assert.equal(exact.totals.tokenInput, 30)
  assert.equal(exact.totals.tokenOutput, 13)
  const exported = JSON.stringify(store.getExport())
  assert.equal(exported.includes('private-project'), false)
  assert.equal(exported.includes('tool argument'), false)
})

test('quota snapshots are bounded and history clear is independent from XP storage', (t) => {
  const now = Date.UTC(2026, 7, 13, 1, 0, 0)
  const database = databasePath()
  const store = new HistoryStore(database.filePath, { now: () => now })
  t.after(() => { store.close(); fs.rmSync(database.directory, { recursive: true, force: true }) })

  assert.equal(store.recordQuotaSnapshot({
    updatedAt: new Date(now).toISOString(),
    providers: [{
      id: 'codex',
      name: 'Codex',
      plan: 'Plus',
      secret: 'must-not-persist',
      windows: [{ id: 'session', label: 'Session', remainingPercent: 87.5, resetsAt: new Date(now + 60_000).toISOString() }],
    }],
  }), true)
  assert.equal(store.getSummary().quota?.providers[0].windows[0].remainingPercent, 87.5)
  const quotaExport = JSON.stringify(store.getExport())
  assert.equal(quotaExport.includes('must-not-persist'), false)

  store.recordEvent(event({ eventId: 'clear-me', state: 'success' }))
  store.clear()
  const cleared = store.getSummary()
  assert.equal(cleared.totals.sessionsCompleted, 0)
  assert.equal(cleared.quota, null)
})

test('history filters by project and keeps identical session IDs isolated', (t) => {
  const now = Date.UTC(2026, 7, 13, 1, 0, 0)
  const database = databasePath()
  const store = new HistoryStore(database.filePath, { now: () => now })
  t.after(() => { store.close(); fs.rmSync(database.directory, { recursive: true, force: true }) })

  const projectA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const projectB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  assert.equal(store.recordEvent(event({
    projectId: projectA,
    eventId: 'project-a-start',
    timestamp: now,
  }), 'wolf'), true)
  assert.equal(store.recordEvent(event({
    projectId: projectA,
    eventId: 'project-a-finish',
    state: 'success',
    timestamp: now + 60_000,
    tokenUsage: { input: 100, output: 20, quality: 'exact' },
  }), 'wolf'), true)
  assert.equal(store.recordEvent(event({
    projectId: projectB,
    eventId: 'project-b-finish',
    state: 'success',
    timestamp: now + 60_000,
    tokenUsage: { input: 7, output: 3, quality: 'estimated' },
  }), 'wolf'), true)

  const projectSummary = store.getSummary('wolf', projectA)
  assert.equal(projectSummary.projectId, projectA)
  assert.equal(projectSummary.totals.sessionsCompleted, 1)
  assert.equal(projectSummary.totals.tokenInput, 100)
  assert.equal(projectSummary.totals.tokenOutput, 20)
  assert.equal(projectSummary.agents.length, 1)

  const allSummary = store.getSummary('wolf')
  assert.equal(allSummary.totals.sessionsCompleted, 2)
  assert.equal(allSummary.totals.tokenInput, 107)
  assert.equal(allSummary.totals.tokenOutput, 23)
})

test('history counts each terminal session once across distinct completion events', (t) => {
  const now = Date.UTC(2026, 7, 13, 1, 0, 0)
  const database = databasePath()
  const store = new HistoryStore(database.filePath, { now: () => now })
  t.after(() => { store.close(); fs.rmSync(database.directory, { recursive: true, force: true }) })

  assert.equal(store.recordEvent(event({ eventId: 'success-1', state: 'success', timestamp: now })), true)
  assert.equal(store.recordEvent(event({ eventId: 'success-2', state: 'success', timestamp: now + 1_000 })), true)
  assert.equal(store.getSummary().totals.sessionsCompleted, 1)
  assert.equal(store.getAchievementCompletedSessions().length, 1)

  assert.equal(store.recordEvent(event({
    sessionId: 'failed-session',
    eventId: 'error-1',
    state: 'error',
    timestamp: now + 2_000,
  })), true)
  assert.equal(store.recordEvent(event({
    sessionId: 'failed-session',
    eventId: 'success-after-error',
    state: 'success',
    timestamp: now + 3_000,
  })), true)
  const summary = store.getSummary()
  assert.equal(summary.totals.sessionsCompleted, 2)
  assert.equal(summary.totals.sessionsFailed, 0)
  assert.equal(store.getAchievementCompletedSessions().length, 2)

  assert.equal(store.recordEvent(event({
    adapterId: 'generic-http',
    eventId: 'same-session-other-adapter',
    state: 'success',
    timestamp: now + 4_000,
  })), true)
  assert.equal(store.getSummary().totals.sessionsCompleted, 2)
  assert.equal(store.getAchievementCompletedSessions().length, 2)
})

test('daily summary pet/date index preserves 1,000 seeded query results', (t) => {
  const now = Date.UTC(2026, 9, 26, 12)
  const database = databasePath()
  const store = new HistoryStore(database.filePath, {
    now: () => now,
    localDate: timestamp => new Date(timestamp).toISOString().slice(0, 10),
  })
  t.after(() => { store.close(); fs.rmSync(database.directory, { recursive: true, force: true }) })

  const dates = Array.from({ length: 7 }, (_, index) => `2026-10-${String(20 + index).padStart(2, '0')}`)
  const pets = ['aang-airbender', 'local-usage', 'wolf']
  const adapters = ['claude-code', 'codex', 'generic-http']
  const insert = store.database.prepare(`
    INSERT INTO daily_stats(
      local_date, pet_id, project_id, adapter_id, sessions_completed, sessions_failed,
      active_ms, token_input, token_output, token_quality
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  store.batch(() => {
    for (let index = 0; index < 1_000; index += 1) {
      const projectId = index.toString(16).padStart(32, '0')
      insert.run(
        dates[index % dates.length],
        pets[index % pets.length],
        projectId,
        adapters[index % adapters.length],
        index % 7,
        index % 5,
        index * 1_000,
        index * 10,
        index * 3,
        index % 2 === 0 ? 'exact' : 'estimated',
      )
    }
  })

  const querySql = `
    SELECT local_date, pet_id, project_id, adapter_id, sessions_completed, sessions_failed,
           active_ms, token_input, token_output, token_quality
    FROM daily_stats
    WHERE (pet_id = ? OR pet_id = ?) AND local_date IN (${dates.map(() => '?').join(', ')})
  `
  const runCases = () => {
    let seed = 0x18_03_2026
    const next = () => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
      return seed
    }
    return Array.from({ length: 1_000 }, () => {
      const petId = pets[next() % pets.length]!
      const rows = store.database.prepare(querySql).all(petId, 'local-usage', ...dates)
      return rows.map(row => [
        row.local_date, row.pet_id, row.project_id, row.adapter_id, row.sessions_completed,
        row.sessions_failed, row.active_ms, row.token_input, row.token_output, row.token_quality,
      ]).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
    })
  }

  store.database.exec('DROP INDEX idx_daily_stats_pet_date')
  const withoutIndex = runCases()
  store.database.exec(`
    CREATE INDEX idx_daily_stats_pet_date ON daily_stats(pet_id, local_date)
  `)
  const withIndex = runCases()
  assert.deepEqual(withIndex, withoutIndex)
  const plan = store.database.prepare(`EXPLAIN QUERY PLAN ${querySql}`).all('aang-airbender', 'local-usage', ...dates)
  assert.ok(plan.some(row => String(row.detail).includes('idx_daily_stats_pet_date')))
})

test('history v4 migration repairs inflated completion aggregates from unique sessions', (t) => {
  const now = Date.UTC(2026, 7, 13, 1, 0, 0)
  const database = databasePath()
  const first = new HistoryStore(database.filePath, { now: () => now })
  assert.equal(first.recordEvent(event({
    eventId: 'finish',
    state: 'success',
    timestamp: now,
    tokenUsage: { input: 10, output: 5, quality: 'exact' },
  })), true)
  first.close()

  const moduleRequire = createRequire(import.meta.url)
  const { DatabaseSync } = moduleRequire('node:sqlite') as {
    DatabaseSync: new (filePath: string) => {
      exec(sql: string): void
      close(): void
    }
  }
  const raw = new DatabaseSync(database.filePath)
  raw.exec(`
    UPDATE daily_stats SET sessions_completed = 9;
    DELETE FROM schema_migrations WHERE version = 4;
  `)
  raw.close()

  const repaired = new HistoryStore(database.filePath, { now: () => now })
  t.after(() => { repaired.close(); fs.rmSync(database.directory, { recursive: true, force: true }) })
  assert.equal(repaired.getSummary().totals.sessionsCompleted, 1)
  assert.equal(repaired.getSummary().totals.tokenInput, 10)
  assert.equal(repaired.getSummary().totals.tokenOutput, 5)
})

test('history v6 migration adds cache columns and downgrades legacy exact local-log rows to estimated', (t) => {
  const now = Date.UTC(2026, 7, 13, 1, 0, 0)
  const database = databasePath()
  const first = new HistoryStore(database.filePath, { now: () => now, localDate: () => '2026-08-13' })
  assert.equal(first.recordTokenUsage({
    adapterId: 'claude-code', agentId: 'claude', sourceEventId: 'legacy-1', occurredAt: now,
    input: 900, output: 10, quality: 'exact',
  }), true)
  first.close()

  const moduleRequire = createRequire(import.meta.url)
  const { DatabaseSync } = moduleRequire('node:sqlite') as {
    DatabaseSync: new (filePath: string) => { exec(sql: string): void; close(): void }
  }
  // Rebuild a v5-shaped database: no cache columns, no v6 record.
  const raw = new DatabaseSync(database.filePath)
  raw.exec(`
    DROP INDEX IF EXISTS idx_daily_stats_summary_cover;
    ALTER TABLE events DROP COLUMN token_cache_read;
    ALTER TABLE events DROP COLUMN token_cache_write;
    ALTER TABLE daily_stats DROP COLUMN token_cache_read;
    ALTER TABLE daily_stats DROP COLUMN token_cache_write;
    DELETE FROM schema_migrations WHERE version = 6;
  `)
  raw.close()

  const migrated = new HistoryStore(database.filePath, { now: () => now, localDate: () => '2026-08-13' })
  t.after(() => { migrated.close(); fs.rmSync(database.directory, { recursive: true, force: true }) })
  const summary = migrated.getSummary()
  assert.equal(summary.totals.tokenInput, 900)
  assert.equal(summary.totals.tokenCacheRead, 0)
  assert.equal(summary.tokenQuality, 'estimated')
  // A later scan with the cache split replaces the legacy row in place.
  assert.equal(migrated.recordTokenUsage({
    adapterId: 'claude-code', agentId: 'claude', sourceEventId: 'legacy-1', occurredAt: now,
    input: 40, output: 10, cacheRead: 860, quality: 'exact',
  }), true)
  const repaired = migrated.getSummary()
  assert.equal(repaired.totals.tokenInput, 40)
  assert.equal(repaired.totals.tokenCacheRead, 860)
  assert.equal(repaired.tokenQuality, 'exact')
})

test('quota snapshots clamp out-of-range remaining percentages instead of dropping the window', (t) => {
  const database = databasePath()
  const store = new HistoryStore(database.filePath, { now: () => Date.UTC(2026, 7, 13, 1, 0, 0) })
  t.after(() => { store.close(); fs.rmSync(database.directory, { recursive: true, force: true }) })
  assert.equal(store.recordQuotaSnapshot({
    updatedAt: '2026-08-13T01:00:00.000Z',
    providers: [{ id: 'claude', name: 'Claude', windows: [
      { id: 'session', label: 'Session', remainingPercent: -3 },
      { id: 'weekly', label: 'Weekly', remainingPercent: 105 },
      { id: 'ok', label: 'Ok', remainingPercent: 40 },
    ] }],
  }), true)
  const windows = store.getSummary().quota?.providers[0].windows ?? []
  assert.deepEqual(windows.map(w => [w.id, w.remainingPercent]), [['session', 0], ['weekly', 100], ['ok', 40]])
})

test('summary supports 30 and 90 day ranges with a previous-period comparison', (t) => {
  const day = 24 * 60 * 60 * 1000
  const now = Date.UTC(2026, 7, 13, 12, 0, 0)
  const database = databasePath()
  const store = new HistoryStore(database.filePath, { now: () => now })
  t.after(() => { store.close(); fs.rmSync(database.directory, { recursive: true, force: true }) })
  const add = (daysAgo: number, id: string) => store.recordEvent(event({
    state: 'success', sessionId: id, eventId: id, timestamp: now - daysAgo * day, tokenUsage: { input: 10, output: 5, quality: 'exact' },
  }))
  add(1, 'recent')
  add(10, 'previous-week-or-month')
  add(45, 'older')

  const week = store.getSummary('aang-airbender', undefined, 7)
  assert.equal(week.days.length, 7)
  assert.equal(week.rangeDays, 7)
  assert.equal(week.totals.sessionsCompleted, 1)
  assert.equal(week.previousTotals.sessionsCompleted, 1)

  const month = store.getSummary('aang-airbender', undefined, 30)
  assert.equal(month.days.length, 30)
  assert.equal(month.totals.sessionsCompleted, 2)
  assert.equal(month.previousTotals.sessionsCompleted, 1)
  assert.equal(month.agents[0].tokenInput, 20)

  const quarter = store.getSummary('aang-airbender', undefined, 90)
  assert.equal(quarter.days.length, 90)
  assert.equal(quarter.totals.sessionsCompleted, 3)
  // Unsupported ranges fall back to a week.
  assert.equal(store.getSummary('aang-airbender', undefined, 12).days.length, 7)
  // The range query is served by the covering index, not a table scan.
  const plan = (store as unknown as { database: { prepare(sql: string): { all(...p: unknown[]): Array<{ detail: string }> } } })
    .database.prepare('EXPLAIN QUERY PLAN SELECT local_date FROM daily_stats WHERE pet_id IN (?, ?) AND local_date BETWEEN ? AND ?')
    .all('a', 'b', '2026-01-01', '2026-02-01').map(row => row.detail).join(' ')
  assert.match(plan, /idx_daily_stats_pet_date|sqlite_autoindex_daily_stats/)
})

test('unchanged quota readings are not rewritten, changed ones are, and old snapshots expire', (t) => {
  let now = Date.UTC(2026, 7, 13, 1, 0, 0)
  const database = databasePath()
  const store = new HistoryStore(database.filePath, { now: () => now })
  t.after(() => { store.close(); fs.rmSync(database.directory, { recursive: true, force: true }) })
  const snapshot = (updatedAt: number, remaining: number) => ({
    updatedAt: new Date(updatedAt).toISOString(),
    providers: [{ id: 'codex', name: 'Codex', windows: [{ id: 's', label: 'Session', remainingPercent: remaining }] }],
  })
  assert.equal(store.recordQuotaSnapshot(snapshot(now, 80)), true)
  assert.equal(store.recordQuotaSnapshot(snapshot(now + 120_000, 80)), false)
  assert.equal(store.recordQuotaSnapshot(snapshot(now + 240_000, 79)), true)
  now += 31 * 24 * 60 * 60 * 1000
  assert.equal(store.recordQuotaSnapshot(snapshot(now, 50)), true)
  const rows = (store as unknown as { database: { prepare(s: string): { all(): unknown[] } } }).database
    .prepare('SELECT snapshot_id FROM quota_snapshots').all()
  assert.equal(rows.length, 1)
})

test('achievement completed-session facts can be read incrementally', (t) => {
  const day = 24 * 60 * 60 * 1000
  const now = Date.UTC(2026, 7, 13, 12, 0, 0)
  const database = databasePath()
  const store = new HistoryStore(database.filePath, { now: () => now })
  t.after(() => { store.close(); fs.rmSync(database.directory, { recursive: true, force: true }) })
  store.recordEvent(event({ eventId: 'old', sessionId: 'old', state: 'success', timestamp: now - 5 * day }))
  store.recordEvent(event({ eventId: 'new', sessionId: 'new', state: 'success', timestamp: now - 1000 }))
  assert.equal(store.getAchievementReconciledAt(), 0)
  assert.equal(store.getAchievementCompletedSessions().length, 2)
  store.setAchievementReconciledAt(now - day)
  assert.equal(store.getAchievementReconciledAt(), now - day)
  assert.deepEqual(store.getAchievementCompletedSessions(store.getAchievementReconciledAt()).map(f => f.sessionId), ['new'])
})

test('history database runs WAL with synchronous=NORMAL and partial success indexes (v7)', (t) => {
  const database = databasePath()
  const store = new HistoryStore(database.filePath)
  t.after(() => { store.close(); fs.rmSync(database.directory, { recursive: true, force: true }) })
  assert.deepEqual(store.getPragmaState(), { journalMode: 'wal', synchronous: 1 })
  const raw = store.database as unknown as { prepare(sql: string): { all(...p: unknown[]): Array<Record<string, unknown>> } }
  const indexes = raw.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name IN ('events', 'daily_stats')").all()
  const names = indexes.map(row => String(row.name))
  assert.ok(names.includes('idx_history_events_success_identity'))
  assert.ok(!names.includes('idx_history_events_completion_identity'))
  assert.ok(!names.includes('idx_daily_stats_summary_cover'))
  const success = indexes.find(row => row.name === 'idx_history_events_success_identity')
  assert.match(String(success?.sql), /WHERE state = 'success'/)
  const plan = raw.prepare(`EXPLAIN QUERY PLAN SELECT event_id FROM events
    WHERE agent_id = ? AND session_id = ? AND project_id = ? AND pet_id = ? AND state = 'success' LIMIT 1`)
    .all('a', 'b', '', 'p').map(row => row.detail).join(' ')
  assert.match(plan, /idx_history_events_success_identity/)
})

test('single-statement daily upsert accumulates, floors at zero and merges quality', (t) => {
  const database = databasePath()
  const store = new HistoryStore(database.filePath)
  t.after(() => { store.close(); fs.rmSync(database.directory, { recursive: true, force: true }) })
  const priv = store as unknown as { updateDailyStat(...a: unknown[]): void, database: { prepare(sql: string): { get(...p: unknown[]): Record<string, unknown> } } }
  priv.updateDailyStat('2026-01-01', 'p', '', 'codex', 'success', 1000, 10, 5, 'estimated', 2, 3)
  priv.updateDailyStat('2026-01-01', 'p', '', 'codex', 'error', 500, 1, 1, 'exact', 0, 0)
  priv.updateDailyStat('2026-01-01', 'p', '', 'codex', null, 0, -100, -1, 'none', -1, -50)
  const row = priv.database.prepare('SELECT * FROM daily_stats WHERE pet_id = ?').get('p')
  assert.equal(row.sessions_completed, 1)
  assert.equal(row.sessions_failed, 1)
  assert.equal(row.active_ms, 1500)
  assert.equal(row.token_input, 0)
  assert.equal(row.token_output, 5)
  assert.equal(row.token_cache_read, 1)
  assert.equal(row.token_cache_write, 0)
  assert.equal(row.token_quality, 'exact')
})

test('queueEvent micro-batches into one commit and isolates a failing event', (t) => {
  const database = databasePath()
  const store = new HistoryStore(database.filePath, { now: () => 2_000_000 })
  t.after(() => { store.close(); fs.rmSync(database.directory, { recursive: true, force: true }) })
  let recorded = 0
  const base = { source: 'codex', sessionId: 's1', project: 'p', projectId: 'a'.repeat(32) } as const
  const onRecorded = () => { recorded += 1 }
  for (let i = 0; i < 50; i += 1) {
    store.queueEvent({ ...base, state: 'tool-running', timestamp: 1_000_000 + i * 1000 } as never, 'aang-airbender', onRecorded)
  }
  store.queueEvent({ ...base, state: 'success', timestamp: 1_100_000, sessionId: '' } as never, 'aang-airbender')
  store.queueEvent({ ...base, state: 'success', timestamp: 1_100_000 } as never, 'aang-airbender', onRecorded)
  assert.equal(store.flushQueued(), 51)
  assert.equal(recorded, 1)
  const summary = store.getSummary('aang-airbender', undefined, 7)
  assert.equal(summary.totals.sessionsCompleted, 1)
  assert.ok(summary.totals.activeMs > 0)
})

function activeOracle(events: Array<{ state: string, timestamp: number }>): number {
  // Reference semantics: active time accrues from the previous event only when
  // that event left the session active, capped at 5 minutes per gap.
  let total = 0
  let last: { state: string, timestamp: number } | null = null
  for (const item of events) {
    if (last && (last.state === 'thinking' || last.state === 'tool-running') && item.timestamp > last.timestamp) {
      total += Math.min(item.timestamp - last.timestamp, 5 * 60 * 1000)
    }
    last = item
  }
  return total
}

test('heartbeats roll up into one row per session-day with identical active time and rebuild result', (t) => {
  const start = Date.UTC(2026, 7, 13, 1, 0, 0)
  const database = databasePath()
  const store = new HistoryStore(database.filePath, { now: () => start + 10 * 24 * 3600_000, localDate: ts => new Date(ts).toISOString().slice(0, 10) })
  t.after(() => { store.close(); fs.rmSync(database.directory, { recursive: true, force: true }) })
  let seed = 7
  const rand = () => { seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0; return seed / 2 ** 32 }
  const sent: Array<{ state: string, timestamp: number }> = []
  let ts = start
  const states = ['thinking', 'tool-running', 'thinking', 'tool-running', 'waiting-input', 'idle']
  for (let i = 0; i < 1500; i += 1) {
    ts += Math.floor(rand() * 400_000) + 1
    const state = states[Math.floor(rand() * states.length)]!
    sent.push({ state, timestamp: ts })
    assert.equal(store.recordEvent(event({ state: state as never, timestamp: ts, sessionId: 'long' })), true)
  }
  const expected = activeOracle(sent)
  const read = () => store.getSummary('aang-airbender', undefined, 30).totals.activeMs
  assert.equal(read(), expected)
  const raw = store.database as unknown as { prepare(sql: string): { get(): Record<string, number>, all(): Array<Record<string, unknown>> } }
  const heartbeatRows = Number(raw.prepare("SELECT COUNT(*) AS n FROM events WHERE state IN ('thinking','tool-running')").get().n)
  assert.equal(heartbeatRows, 0, 'no per-heartbeat rows')
  const rollupRows = Number(raw.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'agent.active_rollup'").get().n)
  assert.ok(rollupRows >= 1 && rollupRows <= 20, `rollup rows ${rollupRows}`)
  const sessionMs = Number(raw.prepare('SELECT SUM(active_ms) AS n FROM sessions').get().n)
  assert.equal(sessionMs, expected)
  store.rebuildDailyStats()
  assert.equal(read(), expected, 'daily_stats rebuilt from rollup rows keeps active time')
})

test('heartbeat replays and stale heartbeats do not change state; tokens keep a real row', (t) => {
  const start = Date.UTC(2026, 7, 13, 1, 0, 0)
  const database = databasePath()
  const store = new HistoryStore(database.filePath, { now: () => start + 3600_000 })
  t.after(() => { store.close(); fs.rmSync(database.directory, { recursive: true, force: true }) })
  assert.equal(store.recordEvent(event({ timestamp: start })), true)
  assert.equal(store.recordEvent(event({ state: 'tool-running', timestamp: start + 60_000 })), true)
  assert.equal(store.recordEvent(event({ state: 'tool-running', timestamp: start + 60_000 })), false)
  assert.equal(store.recordEvent(event({ timestamp: start + 10_000 })), false)
  assert.equal(store.recordEvent(event({ state: 'success', timestamp: start + 90_000 })), true)
  assert.equal(store.recordEvent(event({ state: 'thinking', timestamp: start + 30_000 })), false, 'stale heartbeat cannot reopen a finished session')
  assert.equal(store.getSummary().totals.activeMs, 90_000)
  assert.equal(store.recordEvent(event({ state: 'thinking', timestamp: start + 120_000, tokenUsage: { input: 5, output: 1, quality: 'estimated' } })), true)
  const raw = store.database as unknown as { prepare(sql: string): { get(): Record<string, number> } }
  assert.equal(Number(raw.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'agent.working'").get().n), 1)
})

test('runtime prune deletes expired events and sessions in bounded batches', async (t) => {
  const now = Date.UTC(2026, 7, 13, 1, 0, 0)
  const database = databasePath()
  const store = new HistoryStore(database.filePath, { now: () => now, retentionDays: 30 })
  t.after(() => { store.close(); fs.rmSync(database.directory, { recursive: true, force: true }) })
  const old = now - 60 * 24 * 3600_000
  const raw = store.database as unknown as { exec(sql: string): void, prepare(sql: string): { get(): Record<string, number>, run(...p: unknown[]): unknown } }
  store.batch(() => {
    const insertEvent = raw.prepare(`INSERT INTO events(event_id, schema_version, type, trust, adapter_id, agent_id, session_id, project_id, pet_id, local_date, occurred_at, received_at, state, payload_json)
      VALUES (?, 2, 'agent.working', 'adapter_verified', 'codex', 'codex', 's', '', 'p', '2026-06-01', ?, ?, 'success', '{}')`)
    const insertSession = raw.prepare(`INSERT INTO sessions(session_pk, adapter_id, agent_id, external_session_id, project_id, pet_id, started_at, last_state, last_seen_at)
      VALUES (?, 'codex', 'codex', ?, '', 'p', ?, 'idle', ?)`)
    for (let i = 0; i < 95; i += 1) { insertEvent.run(`old-${i}`, old + i, old + i); insertSession.run(`sold-${i}`, `x${i}`, old, old + i) }
    for (let i = 0; i < 5; i += 1) { insertEvent.run(`new-${i}`, now - i, now - i); insertSession.run(`snew-${i}`, `y${i}`, now, now - i) }
  })
  const first = store.pruneBatch(40)
  assert.deepEqual([first.events, first.sessions, first.more], [40, 40, true])
  let yields = 0
  const rest = await store.pruneInBatches(40, async () => { yields += 1 })
  assert.deepEqual(rest, { events: 55, sessions: 55 })
  assert.equal(yields, 1)
  assert.equal(Number(raw.prepare('SELECT COUNT(*) AS n FROM events').get().n), 5)
  assert.equal(Number(raw.prepare('SELECT COUNT(*) AS n FROM sessions').get().n), 5)
})

test('v6 migration is set-based: 50k events rebuild identically to the legacy row-by-row logic within a time bound', (t) => {
  const now = Date.UTC(2026, 9, 26, 12)
  const localDate = (timestamp: number): string => new Date(timestamp).toISOString().slice(0, 10)
  const database = databasePath()
  const first = new HistoryStore(database.filePath, { now: () => now, localDate })
  first.close()

  const moduleRequire = createRequire(import.meta.url)
  const { DatabaseSync } = moduleRequire('node:sqlite') as {
    DatabaseSync: new (filePath: string) => {
      exec(sql: string): void
      close(): void
      prepare(sql: string): { all(...p: unknown[]): Array<Record<string, unknown>>, run(...p: unknown[]): unknown }
    }
  }
  const raw = new DatabaseSync(database.filePath)
  const EVENTS = 50_000
  const pets = ['aang-airbender', 'wolf', 'local-usage']
  const adapters = ['claude-code', 'codex', 'generic-http']
  const projects = ['', 'a'.repeat(32), 'b'.repeat(32), 'c'.repeat(32)]
  let seed = 4242
  const rand = () => { seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0; return seed / 2 ** 32 }
  raw.exec('BEGIN')
  const insertEvent = raw.prepare(`
    INSERT INTO events(event_id, schema_version, type, trust, adapter_id, agent_id, session_id, project_id, pet_id,
      local_date, occurred_at, received_at, state, active_delta_ms, token_input, token_output, token_cache_read,
      token_cache_write, token_quality, payload_json)
    VALUES (?, 2, 'x', 'adapter_verified', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}')
  `)
  const insertSession = raw.prepare(`
    INSERT INTO sessions(session_pk, adapter_id, agent_id, external_session_id, project_id, pet_id, started_at, ended_at,
      terminal_state, last_state, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'error', ?)
  `)
  for (let i = 0; i < EVENTS; i += 1) {
    const at = now - Math.floor(rand() * 60 * 24 * 3600_000)
    const kind = rand()
    const quality = rand() < 0.3 ? 'exact' : rand() < 0.5 ? 'estimated' : 'none'
    const tokens = quality === 'none' ? [null, null, 0, 0] : [Math.floor(rand() * 5000), Math.floor(rand() * 900), Math.floor(rand() * 400), Math.floor(rand() * 90)]
    insertEvent.run(
      `ev-${i}`, adapters[i % 3], 'agent', `sess-${Math.floor(rand() * 4000)}`, projects[i % 4], pets[Math.floor(rand() * 3)],
      localDate(at), at, at, kind < 0.04 ? 'success' : 'thinking', kind < 0.5 ? Math.floor(rand() * 300_000) : 0,
      ...tokens, quality,
    )
    if (i % 25 === 0) {
      insertSession.run(`err-${i}`, adapters[i % 3], 'agent', `e${i}`, projects[i % 4], pets[i % 3], at, at, 'error', at)
    }
  }
  raw.exec('COMMIT')
  raw.exec(`
    DELETE FROM schema_migrations WHERE version IN (6, 7);
    DELETE FROM daily_stats;
  `)

  // Oracle: the legacy migration, reimplemented over the raw rows (read AFTER the
  // v6 exact->estimated downgrade is applied, exactly as the old order did).
  const expected = new Map<string, Record<string, number | string>>()
  const bump = (key: string, base: Record<string, number | string>, patch: (row: Record<string, number | string>) => void): void => {
    const row = expected.get(key) ?? { ...base, sessions_completed: 0, sessions_failed: 0, active_ms: 0, token_input: 0, token_output: 0, token_cache_read: 0, token_cache_write: 0, token_quality: 'none' }
    patch(row)
    expected.set(key, row)
  }
  const merge = (a: string, b: string): string => a === 'exact' || b === 'exact' ? 'exact' : a === 'estimated' || b === 'estimated' ? 'estimated' : 'none'

  const started = Date.now()
  const migrated = new HistoryStore(database.filePath, { now: () => now, localDate })
  const elapsedMs = Date.now() - started
  t.after(() => { migrated.close(); fs.rmSync(database.directory, { recursive: true, force: true }) })
  t.diagnostic(`v6 rebuild of ${EVENTS} events: ${elapsedMs} ms`)
  assert.ok(elapsedMs < 10_000, `v6/v7 migration of ${EVENTS} events took ${elapsedMs} ms`)

  const events = raw.prepare('SELECT * FROM events ORDER BY occurred_at ASC, event_id ASC').all()
  for (const row of events) {
    const key = [row.local_date, row.pet_id, row.project_id, row.adapter_id].join('|')
    bump(key, { local_date: row.local_date as string, pet_id: row.pet_id as string, project_id: row.project_id as string, adapter_id: row.adapter_id as string }, agg => {
      agg.active_ms = Number(agg.active_ms) + Number(row.active_delta_ms)
      agg.token_input = Number(agg.token_input) + Number(row.token_input ?? 0)
      agg.token_output = Number(agg.token_output) + Number(row.token_output ?? 0)
      agg.token_cache_read = Number(agg.token_cache_read) + Number(row.token_cache_read ?? 0)
      agg.token_cache_write = Number(agg.token_cache_write) + Number(row.token_cache_write ?? 0)
      agg.token_quality = merge(String(agg.token_quality), String(row.token_quality))
    })
  }
  const seen = new Set<string>()
  for (const row of events) {
    if (row.state !== 'success') continue
    const projectId = /^[a-f0-9]{32}$/.test(String(row.project_id)) ? String(row.project_id) : 'unbound'
    const identity = `${row.pet_id}:${row.agent_id}:${row.session_id}:${projectId}`
    if (seen.has(identity)) continue
    seen.add(identity)
    const key = [localDate(Number(row.occurred_at)), row.pet_id, projectId === 'unbound' ? '' : projectId, row.adapter_id].join('|')
    bump(key, { local_date: localDate(Number(row.occurred_at)), pet_id: row.pet_id as string, project_id: projectId === 'unbound' ? '' : projectId, adapter_id: row.adapter_id as string }, agg => { agg.sessions_completed = Number(agg.sessions_completed) + 1 })
  }
  for (const row of raw.prepare("SELECT * FROM sessions WHERE terminal_state = 'error' AND ended_at IS NOT NULL").all()) {
    const date = localDate(Number(row.ended_at))
    const key = [date, row.pet_id, row.project_id, row.adapter_id].join('|')
    bump(key, { local_date: date, pet_id: row.pet_id as string, project_id: row.project_id as string, adapter_id: row.adapter_id as string }, agg => { agg.sessions_failed = Number(agg.sessions_failed) + 1 })
  }

  const actual = new Map<string, Record<string, unknown>>()
  for (const row of raw.prepare('SELECT * FROM daily_stats').all()) {
    actual.set([row.local_date, row.pet_id, row.project_id, row.adapter_id].join('|'), row)
  }
  const shape = (row: Record<string, unknown>): unknown[] => [
    row.sessions_completed, row.sessions_failed, row.active_ms, row.token_input, row.token_output,
    row.token_cache_read, row.token_cache_write, row.token_quality,
  ]
  // Heartbeat-only zero rows are not materialised by the new writer; compare non-empty rows.
  const nonEmpty = (rows: Map<string, Record<string, unknown>>): Array<[string, unknown[]]> => [...rows.entries()]
    .map(([key, row]) => [key, shape(row)] as [string, unknown[]])
    .filter(([, values]) => values.some(value => value !== 0 && value !== 'none'))
    .sort((a, b) => a[0].localeCompare(b[0]))
  // v6 downgrades exact local-log rows; the synthetic rows are not 'agent.token_usage', so they are unchanged.
  assert.deepEqual(nonEmpty(actual), nonEmpty(expected as Map<string, Record<string, unknown>>))
  assert.ok(actual.size > 50, 'synthetic data produced a meaningful aggregate')
  raw.close()
})

test('a failed batch commit re-queues events in order, sheds heartbeats first and retries', async (t) => {
  const database = databasePath()
  const store = new HistoryStore(database.filePath, { now: () => 2_000_000 })
  t.after(() => { store.close(); fs.rmSync(database.directory, { recursive: true, force: true }) })
  const priv = store as unknown as { transaction: (work: () => unknown) => unknown, queuedEvents: unknown[] }
  const original = priv.transaction.bind(store)
  let failures = 1
  priv.transaction = (work) => {
    if (failures > 0) { failures -= 1; throw new Error('SQLITE_BUSY') }
    return original(work)
  }
  const base = { source: 'codex', sessionId: 's1', project: 'p', projectId: 'a'.repeat(32) } as const
  const originalError = console.error
  console.error = () => {}
  t.after(() => { console.error = originalError })
  store.queueEvent({ ...base, state: 'thinking', timestamp: 1_000_000 } as never)
  store.queueEvent({ ...base, state: 'success', timestamp: 1_001_000 } as never)
  assert.equal(store.flushQueued(), 0)
  assert.equal(priv.queuedEvents.length, 2, 'events survive the failed commit')
  assert.equal(store.flushQueued(), 2, 'retry persists them')
  assert.equal(store.getSummary('aang-airbender', undefined, 7).totals.sessionsCompleted, 1)
})

test('trimQueuedEvents drops oldest heartbeats and never terminal events while heartbeats remain', () => {
  const mk = (state: string, n: number) => ({ event: { source: 'codex', sessionId: 's', state, timestamp: n } as never, petId: 'p', receivedAt: n })
  const items = [mk('thinking', 1), mk('success', 2), mk('thinking', 3), mk('error', 4), mk('thinking', 5)]
  const trimmed = trimQueuedEvents(items, 3)
  assert.deepEqual(trimmed.map(item => item.receivedAt), [2, 4, 5])
  assert.equal(trimQueuedEvents(items, 10).length, 5)
})

test('v8 migration adds the model column, model aggregates and token-time index to a v7 database, idempotently', (t) => {
  const now = Date.UTC(2026, 7, 13, 1, 0, 0)
  const database = databasePath()
  t.after(() => fs.rmSync(database.directory, { recursive: true, force: true }))
  const first = new HistoryStore(database.filePath, { now: () => now, localDate: () => '2026-08-13' })
  first.recordTokenUsageBatch([
    { adapterId: 'claude-code', agentId: 'claude', sourceEventId: 'a', occurredAt: now - 1_000, input: 30, output: 5, cacheRead: 2, quality: 'exact', model: 'claude-opus-4-5' },
    { adapterId: 'codex', agentId: 'codex', sourceEventId: 'b', occurredAt: now - 500, input: 12, output: 3, quality: 'exact' },
  ])
  first.close()
  // Reduce to the v7 shape: no model column, table, index or v8 marker.
  const DatabaseSync = (createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (file: string) => { exec(sql: string): void, prepare(sql: string): { all(...p: unknown[]): Array<Record<string, unknown>> }, close(): void } }).DatabaseSync
  const raw = new DatabaseSync(database.filePath)
  raw.exec(`
    DROP TABLE daily_model_stats;
    DROP INDEX idx_history_events_token_time;
    ALTER TABLE events DROP COLUMN token_model;
    DELETE FROM schema_migrations WHERE version = 8;
  `)
  raw.close()

  for (let open = 0; open < 2; open += 1) {
    const store = new HistoryStore(database.filePath, { now: () => now, localDate: () => '2026-08-13' })
    const summary = store.getSummary()
    // Pre-v8 rows have no model yet: they are grouped as unknown with exact totals.
    assert.deepEqual(summary.models.map(stat => [stat.adapterId, stat.model, stat.tokenInput, stat.tokenOutput]), [
      ['claude-code', '', 30, 5],
      ['codex', '', 12, 3],
    ])
    assert.equal(summary.totals.tokenInput, 42)
    const db = (store as unknown as { database: typeof raw }).database
    const versions = db.prepare('SELECT version FROM schema_migrations WHERE version = 8').all()
    assert.equal(versions.length, 1)
    const plan = db.prepare(`EXPLAIN QUERY PLAN
      SELECT adapter_id, occurred_at FROM events
      WHERE type = 'agent.token_usage' AND occurred_at >= ? ORDER BY occurred_at DESC LIMIT ?`).all(0, 10)
      .map(row => String(row.detail)).join(' ')
    assert.match(plan, /idx_history_events_token_time/)
    const modelPlan = db.prepare(`EXPLAIN QUERY PLAN
      SELECT adapter_id FROM daily_model_stats WHERE local_date BETWEEN ? AND ?`).all('a', 'b')
      .map(row => String(row.detail)).join(' ')
    assert.match(modelPlan, /SEARCH daily_model_stats USING .*(PRIMARY KEY|sqlite_autoindex_daily_model_stats)/)
    store.close()
  }
})

test('model aggregates follow updates, moves, clear and rebuild, and usage blocks come from local rows', (t) => {
  let now = Date.UTC(2026, 7, 13, 10, 30, 0)
  const database = databasePath()
  const store = new HistoryStore(database.filePath, { now: () => now, localDate: timestamp => new Date(timestamp).toISOString().slice(0, 10), timezoneOffsetMinutes: () => 0 })
  t.after(() => { store.close(); fs.rmSync(database.directory, { recursive: true, force: true }) })
  const base = { adapterId: 'claude-code', agentId: 'claude', quality: 'exact' as const }
  store.recordTokenUsage({ ...base, sourceEventId: 'm1', occurredAt: now - 20 * 60_000, input: 10, output: 1, model: 'claude-sonnet-4-5' })
  // Streaming update of the same message: replaced, not added.
  store.recordTokenUsage({ ...base, sourceEventId: 'm1', occurredAt: now - 20 * 60_000, input: 25, output: 4, model: 'claude-sonnet-4-5' })
  // An unknown model never erases a known one.
  store.recordTokenUsage({ ...base, sourceEventId: 'm1', occurredAt: now - 20 * 60_000, input: 26, output: 4 })
  store.recordTokenUsageBatch([{ ...base, sourceEventId: 'm2', occurredAt: now - 10 * 60_000, input: 5, output: 1, model: 'claude-opus-4-5' }])
  const read = () => store.getSummary().models.map(stat => [stat.model, stat.tokenInput, stat.tokenOutput])
  assert.deepEqual(read(), [['claude-sonnet-4-5', 26, 4], ['claude-opus-4-5', 5, 1]])
  // A live event with token usage is not a local-log row and never enters blocks or models.
  store.recordEvent(event({ state: 'success', timestamp: now - 60_000, tokenUsage: { input: 999, output: 0, quality: 'estimated' } }))

  const [block] = store.getSummary().usageBlocks
  assert.equal(block?.adapterId, 'claude-code')
  assert.equal(block?.startAt, Date.UTC(2026, 7, 13, 10, 0, 0))
  assert.equal(block?.tokenInput, 31)
  assert.equal(store.getSummary().usageBlocks.length, 1)

  store.rebuildDailyStats()
  assert.deepEqual(read(), [['claude-sonnet-4-5', 26, 4], ['claude-opus-4-5', 5, 1]])
  now += 6 * 60 * 60 * 1000
  assert.deepEqual(store.getSummary().usageBlocks, [])
  store.clear()
  assert.deepEqual(read(), [])
})

test('a v8 database whose model aggregate is missing or empty is rebuilt on open', (t) => {
  const now = Date.UTC(2026, 7, 13, 1, 0, 0)
  const database = databasePath()
  t.after(() => fs.rmSync(database.directory, { recursive: true, force: true }))
  const options = { now: () => now, localDate: () => '2026-08-13' }
  const first = new HistoryStore(database.filePath, options)
  first.recordTokenUsage({ adapterId: 'codex', agentId: 'codex', sourceEventId: 'a', occurredAt: now - 1_000, input: 8, output: 2, quality: 'exact', model: 'gpt-5-codex' })
  first.close()
  const DatabaseSync = (createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (file: string) => { exec(sql: string): void, close(): void } }).DatabaseSync
  for (const damage of ['DROP TABLE daily_model_stats', 'DELETE FROM daily_model_stats']) {
    const raw = new DatabaseSync(database.filePath)
    raw.exec(damage)
    raw.close()
    const store = new HistoryStore(database.filePath, options)
    assert.deepEqual(store.getSummary().models.map(stat => [stat.model, stat.tokenInput]), [['gpt-5-codex', 8]], damage)
    store.close()
  }
})

test('model ids that look like paths, drives or placeholders are rejected', () => {
  for (const ok of ['claude-sonnet-4-5-20250929', 'gpt-5.1-codex', 'openai/gpt-5', 'us.anthropic.claude-opus-4-5-v1:0', 'models/gemini-2.5-pro']) {
    assert.equal(safeModelId(ok), ok)
  }
  for (const bad of [
    'Users/name/x', 'users/alice', 'home/bob', 'Users/name', 'a/b/c', '/abs', 'C:/x', 'c:model', '../x', 'a/../b',
    '<synthetic>', 'has space', '~/x', 'x'.repeat(97), '', 42, null,
  ]) {
    assert.equal(safeModelId(bad), '', String(bad))
  }
})
