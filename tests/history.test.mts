import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'
import { HistoryStore } from '../electron/history.ts'
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

test('daily summary covering index preserves 1,000 seeded query results', (t) => {
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

  store.database.exec('DROP INDEX idx_daily_stats_summary_cover')
  const withoutIndex = runCases()
  store.database.exec(`
    CREATE INDEX idx_daily_stats_summary_cover
      ON daily_stats(
        pet_id, local_date, project_id, adapter_id,
        sessions_completed, sessions_failed, active_ms, token_input, token_output, token_quality
      )
  `)
  const withIndex = runCases()
  assert.deepEqual(withIndex, withoutIndex)
  const plan = store.database.prepare(`EXPLAIN QUERY PLAN ${querySql}`).all('aang-airbender', 'local-usage', ...dates)
  assert.ok(plan.some(row => String(row.detail).includes('idx_daily_stats_summary_cover')))
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
