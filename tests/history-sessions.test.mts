import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { HistoryStore } from '../electron/history.ts'
import {
  SESSION_ACTIVE_WINDOW_MS,
  SESSION_TIMELINE_STORED_MAX,
  buildSessionListQuery,
  isHistorySessionId,
  normalizeSessionQuery,
  sanitizeProjectLabel,
  sanitizeToolName,
} from '../electron/history-sessions.ts'
import type { AgentStatusEvent } from '../src/types/agent.ts'

type RawDb = {
  exec(sql: string): void
  prepare(sql: string): { all(...p: unknown[]): Array<Record<string, unknown>>; get(...p: unknown[]): Record<string, unknown> | undefined }
}

const NOW = Date.UTC(2026, 7, 13, 12, 0, 0)
const PROJECT_A = 'a'.repeat(32)
const PROJECT_B = 'b'.repeat(32)

function open(t: { after(fn: () => void): void }, now: () => number = () => NOW) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-sessions-'))
  const filePath = path.join(directory, 'history.sqlite')
  const store = new HistoryStore(filePath, { now })
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }) })
  return { store, filePath, directory, db: (store as unknown as { database: RawDb }).database }
}

function event(overrides: Partial<AgentStatusEvent> = {}): AgentStatusEvent {
  return {
    adapterId: 'claude-code',
    source: 'claude',
    sessionId: 'raw-session-1',
    state: 'thinking',
    timestamp: NOW - 60_000,
    ...overrides,
  }
}

function plan(db: RawDb, sql: string, params: unknown[]): string {
  return db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map(row => String(row.detail)).join(' | ')
}

test('session timeline records state and tool changes, permission waits and the outcome', (t) => {
  const { store } = open(t)
  const at = (offset: number) => NOW - 100_000 + offset
  const project = '/Users/someone/secret-root/my-app'
  store.recordEvent(event({ state: 'thinking', timestamp: at(0), project }))
  store.recordEvent(event({ state: 'thinking', timestamp: at(1_000), project }))
  store.recordEvent(event({ state: 'tool-running', toolName: 'Bash', timestamp: at(2_000), project }))
  store.recordEvent(event({ state: 'tool-running', toolName: 'Bash', timestamp: at(3_000), project }))
  store.recordEvent(event({ state: 'tool-running', toolName: 'Edit', timestamp: at(4_000), project }))
  store.recordEvent(event({ state: 'waiting-permission', eventId: 'perm-1', timestamp: at(5_000), project }))
  store.recordEvent(event({ state: 'waiting-permission', eventId: 'perm-1b', timestamp: at(6_000), project }))
  store.recordEvent(event({ state: 'tool-running', toolName: 'Edit', timestamp: at(15_000), project }))
  store.recordEvent(event({ state: 'success', eventId: 'done', timestamp: at(20_000), project }))

  const page = store.listSessions('aang-airbender', {})
  assert.equal(page.items.length, 1)
  const item = page.items[0]!
  assert.equal(item.outcome, 'success')
  assert.equal(item.projectLabel, 'my-app')
  assert.equal(item.toolRuns, 3)
  assert.equal(item.permissionWaits, 1)
  assert.equal(item.permissionWaitMs, 10_000)
  assert.equal(item.durationMs, 20_000)
  assert.equal(item.tracked, true)
  assert.equal(page.nextCursor, null)

  const detail = store.getSessionDetail('aang-airbender', item.id)!
  assert.deepEqual(detail.timeline.map(entry => `${entry.state}${entry.toolName ? `(${entry.toolName})` : ''}`), [
    'thinking', 'tool-running(Bash)', 'tool-running(Edit)', 'waiting-permission', 'tool-running(Edit)', 'success',
  ])
  assert.equal(detail.truncated, false)
  // Metadata only: no raw session id or path above the last segment.
  const serialized = JSON.stringify({ page, detail })
  assert.equal(serialized.includes('raw-session-1'), false)
  assert.equal(serialized.includes('secret-root'), false)
  assert.equal(serialized.includes('/Users/'), false)
  assert.equal(store.getSessionDetail('aang-airbender', 'claude-code:claude:ffffffffffffffffffffffff'), null)
  assert.equal(store.getSessionDetail('aang-airbender', "x' OR 1=1 --"), null)
  // Another pet cannot open this session's timeline.
  assert.equal(store.getSessionDetail('other-pet', item.id), null)
})

test('tool names keep only the name and project labels only the last segment', () => {
  assert.equal(sanitizeToolName('Bash'), 'Bash')
  assert.equal(sanitizeToolName('mcp__server__read_file'), 'mcp__server__read_file')
  assert.equal(sanitizeToolName('Bash("rm -rf ~"; echo $HOME)'), 'Bashrm -rf  echo HOME')
  assert.equal(sanitizeToolName('x'.repeat(500)).length, 64)
  assert.equal(sanitizeToolName({ name: 'Bash' }), '')
  assert.equal(sanitizeProjectLabel('C:\\Users\\me\\repo'), 'repo')
  assert.equal(sanitizeProjectLabel('/home/me/repo/'), 'repo')
  assert.equal(sanitizeProjectLabel('repo\u0000\u2028name'), 'reponame')
  assert.equal(sanitizeProjectLabel(42), '')
})

test('the stored timeline is capped per session and reports truncation', (t) => {
  const { store, db } = open(t)
  const tools = ['Read', 'Edit']
  const total = SESSION_TIMELINE_STORED_MAX + 25
  for (let index = 0; index < total; index += 1) {
    store.recordEvent(event({ state: 'tool-running', toolName: tools[index % 2], timestamp: NOW - 1_000_000 + index * 10 }))
  }
  const [item] = store.listSessions('aang-airbender', {}).items
  const stored = db.prepare('SELECT COUNT(*) AS count, MIN(seq) AS first FROM session_timeline').get()!
  assert.equal(Number(stored.count), SESSION_TIMELINE_STORED_MAX)
  assert.equal(Number(stored.first), total - SESSION_TIMELINE_STORED_MAX)
  const detail = store.getSessionDetail('aang-airbender', item!.id)!
  assert.equal(detail.timeline.length, SESSION_TIMELINE_STORED_MAX)
  assert.equal(detail.truncated, true)
  assert.equal(detail.timeline.at(-1)!.occurredAt, NOW - 1_000_000 + (total - 1) * 10)
  assert.equal(item!.toolRuns, total)
})

test('keyset pages are stable, disjoint and bounded', (t) => {
  const { store } = open(t)
  for (let index = 0; index < 23; index += 1) {
    // Pairs share a timestamp so the session_pk tiebreak is exercised.
    store.recordEvent(event({ sessionId: `s-${index}`, state: 'success', eventId: `done-${index}`, timestamp: NOW - 1_000_000 + Math.floor(index / 2) * 1_000 }))
  }
  const seen: string[] = []
  let cursor = undefined as undefined | { lastSeenAt: number; id: string }
  let pages = 0
  for (;;) {
    const page = store.listSessions('aang-airbender', { limit: 5, cursor })
    pages += 1
    assert.ok(page.items.length <= 5)
    seen.push(...page.items.map(item => item.id))
    if (!page.nextCursor) break
    cursor = page.nextCursor
  }
  assert.equal(pages, 5)
  assert.equal(seen.length, 23)
  assert.equal(new Set(seen).size, 23)
  const all = store.listSessions('aang-airbender', { limit: 50 }).items
  assert.deepEqual(all.map(item => item.id), seen)
  for (let index = 1; index < all.length; index += 1) {
    assert.ok(all[index - 1]!.lastSeenAt >= all[index]!.lastSeenAt)
  }
  assert.equal(store.listSessions('aang-airbender', { limit: 10_000 }).items.length, 23)
  assert.equal(store.listSessions('aang-airbender', { limit: 0 }).items.length, 1)
})

test('filters: project, agent, outcome, date range and escaped search', (t) => {
  let now = NOW
  const { store } = open(t, () => now)
  store.recordEvent(event({ sessionId: 'p-a', projectId: PROJECT_A, project: 'alpha_app', state: 'success', eventId: 'a1', timestamp: NOW - 50 * 60_000 }))
  store.recordEvent(event({ sessionId: 'p-b', projectId: PROJECT_B, project: 'beta%app', state: 'error', eventId: 'b1', timestamp: NOW - 40 * 60_000 }))
  store.recordEvent(event({ adapterId: 'codex', source: 'codex', sessionId: 'c-1', project: 'gamma', state: 'offline', eventId: 'c1', timestamp: NOW - 30 * 60_000 }))
  store.recordEvent(event({ sessionId: 'open-old', project: 'delta', state: 'thinking', timestamp: NOW - 20 * 60_000 }))
  store.recordEvent(event({ sessionId: 'open-new', project: 'delta', state: 'tool-running', toolName: 'Bash', timestamp: NOW - 60_000 }))
  const labels = (query: object) => store.listSessions('aang-airbender', query).items.map(item => item.projectLabel)

  assert.deepEqual(labels({ projectId: PROJECT_A }), ['alpha_app'])
  assert.deepEqual(labels({ adapterId: 'codex' }), ['gamma'])
  assert.deepEqual(labels({ outcome: 'success' }), ['alpha_app'])
  assert.deepEqual(labels({ outcome: 'error' }), ['beta%app'])
  assert.deepEqual(labels({ outcome: 'cancelled' }), ['gamma'])
  assert.deepEqual(labels({ outcome: 'active' }), ['delta'])
  assert.deepEqual(labels({ outcome: 'incomplete' }), ['delta'])
  assert.equal(store.listSessions('aang-airbender', { outcome: 'active' }).items[0]!.lastSeenAt, NOW - 60_000)
  assert.deepEqual(labels({ from: NOW - 45 * 60_000, to: NOW - 25 * 60_000 }), ['gamma', 'beta%app'])
  // LIKE wildcards in the search text are literals, not patterns.
  assert.deepEqual(labels({ search: '%' }), ['beta%app'])
  assert.deepEqual(labels({ search: '_app' }), ['alpha_app'])
  assert.deepEqual(labels({ search: 'ALPHA' }), ['alpha_app'])
  assert.deepEqual(labels({ search: 'codex' }), ['gamma'])
  assert.equal(labels({ search: "' OR 1=1 --" }).length, 0)
  // Sessions of another pet are not listed.
  assert.equal(store.listSessions('other-pet', {}).items.length, 0)
  // An open session goes quiet → incomplete once the active window passes.
  now = NOW + SESSION_ACTIVE_WINDOW_MS
  assert.deepEqual(labels({ outcome: 'active' }), [])
})

test('query normalisation drops anything invalid and bounds the rest', () => {
  assert.deepEqual(normalizeSessionQuery(null, NOW), { limit: 30 })
  assert.deepEqual(normalizeSessionQuery([1, 2], NOW), { limit: 30 })
  const query = normalizeSessionQuery({
    projectId: PROJECT_A,
    adapterId: 'claude-code',
    from: NOW - 1000,
    to: NOW + 10 * 24 * 60 * 60 * 1000,
    outcome: 'active',
    search: '  term  ',
    limit: 7,
    cursor: { lastSeenAt: NOW, id: `codex:codex:${'c'.repeat(24)}` },
  }, NOW)
  assert.equal(query.to, NOW + 24 * 60 * 60 * 1000)
  assert.equal(query.search, 'term')
  assert.equal(query.limit, 7)
  assert.ok(query.cursor)
  // A reversed range is the same span, never "all time".
  const swapped = normalizeSessionQuery({ from: NOW, to: NOW - 1000 }, NOW)
  assert.equal(swapped.from, NOW - 1000)
  assert.equal(swapped.to, NOW)
  assert.equal(normalizeSessionQuery({ limit: 2.5 }, NOW).limit, 30)
  assert.equal(normalizeSessionQuery({ cursor: { lastSeenAt: 'x', id: 'y' } }, NOW).cursor, undefined)
  assert.equal(isHistorySessionId(`a:b:${'0'.repeat(24)}`), true)
  assert.equal(isHistorySessionId(`a:b:${'0'.repeat(23)}`), false)
  assert.equal(isHistorySessionId(`${'a'.repeat(500)}:${'0'.repeat(24)}`), false)
})

test('list and timeline queries are index-backed and never sort in a temp B-tree', (t) => {
  const { store, db } = open(t)
  store.recordEvent(event())
  const cursor = { lastSeenAt: NOW, id: `claude-code:claude:${'0'.repeat(24)}` }
  const cases: Array<[object, RegExp]> = [
    [{}, /idx_history_sessions_pet_seen/],
    [{ cursor, search: 'x', adapterId: 'codex', from: 1, to: NOW }, /idx_history_sessions_pet_seen/],
    [{ projectId: PROJECT_A, cursor }, /idx_history_sessions_pet_project_seen/],
    [{ outcome: 'success', cursor }, /idx_history_sessions_pet_seen/],
    [{ outcome: 'incomplete' }, /idx_history_sessions_pet_seen/],
  ]
  for (const [input, index] of cases) {
    const { sql, params } = buildSessionListQuery('aang-airbender', normalizeSessionQuery(input, NOW), NOW)
    const detail = plan(db, sql, params)
    assert.match(detail, index)
    assert.doesNotMatch(detail, /TEMP B-TREE|SCAN sessions(?! USING)/)
  }
  const timeline = plan(db, 'SELECT seq FROM session_timeline WHERE session_pk = ? ORDER BY seq DESC LIMIT ?', ['x', 500])
  assert.match(timeline, /SEARCH session_timeline USING PRIMARY KEY/)
  assert.doesNotMatch(timeline, /TEMP B-TREE/)
  const usage = plan(db, 'SELECT model FROM session_model_usage WHERE usage_key IN (SELECT value FROM json_each(?))', ['["a","b"]'])
  assert.match(usage, /SEARCH session_model_usage USING (COVERING )?INDEX/)
  // The page reads only limit + 1 rows for an unfiltered list.
  const page = store.listSessions('aang-airbender', { limit: 1 })
  assert.equal(page.items.length, 1)
})

test('local-log tokens join the hook session incrementally, with the top model', (t) => {
  const { store, db } = open(t)
  store.recordEvent(event({ state: 'thinking', timestamp: NOW - 90_000, tokenUsage: { input: 1, output: 1, quality: 'estimated' } }))
  const usage = (sourceEventId: string, model: string, input: number, output: number, cacheRead = 0) => ({
    adapterId: 'claude-code', agentId: 'claude', sessionId: 'raw-session-1', sourceEventId,
    occurredAt: NOW - 80_000, input, output, cacheRead, quality: 'exact' as const, model,
  })
  assert.equal(store.recordTokenUsageBatch([
    usage('m1', 'claude-sonnet', 100, 50, 1000),
    usage('m2', 'claude-opus', 300, 20),
    usage('m3', 'claude-sonnet', 10, 10),
  ]), 3)
  let item = store.listSessions('aang-airbender', {}).items[0]!
  assert.equal(item.tokenSource, 'local')
  assert.equal(item.tokenInput, 410)
  assert.equal(item.tokenOutput, 80)
  assert.equal(item.tokenCacheRead, 1000)
  assert.equal(item.topModel, 'claude-opus')
  // A rescan that corrects a record moves only its delta.
  assert.equal(store.recordTokenUsage(usage('m2', 'claude-opus', 30, 20)), true)
  item = store.listSessions('aang-airbender', {}).items[0]!
  assert.equal(item.tokenInput, 140)
  assert.equal(item.topModel, 'claude-sonnet')
  assert.equal(Number(db.prepare('SELECT COUNT(*) AS count FROM session_model_usage').get()!.count), 2)
  // A session without local-log usage falls back to hook-reported tokens.
  store.recordEvent(event({ adapterId: 'opencode', source: 'opencode-cli', sessionId: 'oc', timestamp: NOW - 10_000, tokenUsage: { input: 7, output: 3, quality: 'estimated' } }))
  const hookOnly = store.listSessions('aang-airbender', { adapterId: 'opencode' }).items[0]!
  assert.equal(hookOnly.tokenSource, 'hook')
  assert.equal(hookOnly.tokenInput, 7)
  assert.equal(hookOnly.topModel, '')
})

test('v9 migration backfills existing sessions additively and is idempotent', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-sessions-migrate-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const filePath = path.join(directory, 'history.sqlite')
  const first = new HistoryStore(filePath, { now: () => NOW })
  first.recordEvent(event({ state: 'thinking', eventId: 'start', timestamp: NOW - 50_000 }))
  first.recordEvent(event({ state: 'success', eventId: 'done', timestamp: NOW - 40_000 }))
  first.recordEvent(event({ sessionId: 'gone', state: 'offline', eventId: 'off', timestamp: NOW - 30_000 }))
  first.recordTokenUsage({
    adapterId: 'claude-code', agentId: 'claude', sessionId: 'raw-session-1', sourceEventId: 'u1',
    occurredAt: NOW - 45_000, input: 40, output: 2, quality: 'exact', model: 'claude-haiku',
  })
  // Roll the database back to its v8 shape.
  const raw = (first as unknown as { database: RawDb }).database
  raw.exec(`
    DROP INDEX idx_history_sessions_pet_seen;
    DROP INDEX idx_history_sessions_pet_project_seen;
    DROP TABLE session_timeline;
    DROP TABLE session_search;
    DROP TABLE session_model_usage;
    DELETE FROM schema_migrations WHERE version = 9;
  `)
  for (const column of ['project_label', 'usage_key', 'final_state', 'last_tool', 'tool_runs', 'permission_waits', 'permission_wait_ms', 'state_since', 'timeline_tracked', 'timeline_count']) {
    raw.exec(`ALTER TABLE sessions DROP COLUMN ${column}`)
  }
  first.close()

  const second = new HistoryStore(filePath, { now: () => NOW })
  const items = second.listSessions('aang-airbender', {}).items
  assert.deepEqual(items.map(item => item.outcome), ['cancelled', 'success'])
  const migrated = items[1]!
  assert.equal(migrated.tracked, false)
  assert.equal(migrated.tokenSource, 'local')
  assert.equal(migrated.tokenInput, 40)
  assert.equal(migrated.topModel, 'claude-haiku')
  assert.deepEqual(second.getSessionDetail('aang-airbender', migrated.id)!.timeline, [])
  second.close()

  const third = new HistoryStore(filePath, { now: () => NOW })
  t.after(() => third.close())
  const db = (third as unknown as { database: RawDb }).database
  assert.equal(Number(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 9').get()!.count), 1)
  assert.equal(Number(db.prepare('SELECT COUNT(*) AS count FROM session_model_usage').get()!.count), 1)
  assert.equal(third.listSessions('aang-airbender', {}).items[1]!.tokenInput, 40)
})

test('retention prune and clear remove timelines and per-session usage with their sessions', (t) => {
  let now = NOW
  const { store, db } = open(t, () => now)
  store.recordEvent(event({ state: 'tool-running', toolName: 'Bash', timestamp: NOW - 1000 }))
  store.recordTokenUsage({
    adapterId: 'claude-code', agentId: 'claude', sessionId: 'raw-session-1', sourceEventId: 'u1',
    occurredAt: NOW - 500, input: 5, output: 5, quality: 'exact',
  })
  const count = (table: string) => Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()!.count)
  assert.equal(count('session_timeline'), 1)
  assert.equal(count('session_model_usage'), 1)
  now = NOW + 91 * 24 * 60 * 60 * 1000
  while (store.pruneBatch(1).more) { /* bounded steps */ }
  assert.equal(count('sessions'), 0)
  assert.equal(count('session_timeline'), 0)
  assert.equal(count('session_model_usage'), 0)

  now = NOW
  store.recordEvent(event({ sessionId: 'again', state: 'thinking', timestamp: NOW - 1000 }))
  assert.equal(count('session_timeline'), 1)
  store.clear()
  assert.equal(count('session_timeline'), 0)
  assert.equal(store.listSessions('aang-airbender', {}).items.length, 0)
})

test('JSON export carries bounded session metadata without project labels', (t) => {
  const { store } = open(t)
  store.recordEvent(event({ project: 'private-project', state: 'success', eventId: 'done', timestamp: NOW - 1000 }))
  const exported = store.getExport('aang-airbender', undefined, 7)
  assert.equal(exported.sessions?.length, 1)
  assert.equal(exported.sessionsTruncated, false)
  assert.equal(exported.sessions?.[0]?.projectLabel, '')
  assert.equal(JSON.stringify(exported).includes('private-project'), false)
})

test('outcome follows the latest turn of a multi-turn session', (t) => {
  let now = NOW
  const { store } = open(t, () => now)
  const at = (offset: number) => NOW - 600_000 + offset
  const outcome = () => store.listSessions('aang-airbender', {}).items[0]!.outcome
  store.recordEvent(event({ state: 'thinking', eventId: 't1', timestamp: at(0) }))
  store.recordEvent(event({ state: 'success', eventId: 'stop-1', timestamp: at(10_000) }))
  assert.equal(outcome(), 'success')
  // The next prompt makes the session active again.
  store.recordEvent(event({ state: 'thinking', eventId: 't2', timestamp: at(20_000) }))
  assert.equal(outcome(), 'active')
  assert.equal(store.listSessions('aang-airbender', { outcome: 'active' }).items.length, 1)
  assert.equal(store.listSessions('aang-airbender', { outcome: 'success' }).items.length, 0)
  store.recordEvent(event({ state: 'error', eventId: 'stop-fail', timestamp: at(30_000) }))
  assert.equal(outcome(), 'error')
  // One StopFailure does not stick once a later turn succeeds.
  store.recordEvent(event({ state: 'tool-running', toolName: 'Bash', eventId: 't3', timestamp: at(40_000) }))
  store.recordEvent(event({ state: 'success', eventId: 'stop-2', timestamp: at(50_000) }))
  assert.equal(outcome(), 'success')
  // idle keeps the last turn's outcome; a late, older event cannot rewrite it.
  store.recordEvent(event({ state: 'idle', eventId: 'idle', timestamp: at(60_000) }))
  store.recordEvent(event({ state: 'thinking', eventId: 'late', timestamp: at(45_000) }))
  assert.equal(outcome(), 'success')
  // Aggregates still count the session once.
  assert.equal(store.getSummary().totals.sessionsCompleted, 1)
  now = NOW
})

test('trigram search reads only matching sessions and agrees with the scan', (t) => {
  const { store, db } = open(t)
  const labels = ['alpha-service', 'beta%app', 'gamma_tool', '專案管理工具']
  labels.forEach((project, index) => {
    store.recordEvent(event({ sessionId: `s-${index}`, project, projectId: index === 0 ? PROJECT_A : undefined, state: 'success', eventId: `d-${index}`, timestamp: NOW - 1000 * (index + 1) }))
  })
  const found = (search: string) => store.listSessions('aang-airbender', { search }).items.map(item => item.projectLabel)
  assert.deepEqual(found('SERV'), ['alpha-service'])
  assert.deepEqual(found('a%a'), ['beta%app'])
  assert.deepEqual(found('a_t'), ['gamma_tool'])
  assert.deepEqual(found('管理工'), ['專案管理工具'])
  assert.deepEqual(found('"x" OR alpha'), [])
  assert.deepEqual(found('claude-code').length, 4)
  // Short terms fall back to the escaped LIKE scan.
  assert.deepEqual(found('%'), ['beta%app'])
  // A renamed workspace label is re-indexed; the old label no longer matches.
  store.recordEvent(event({ sessionId: 's-0', projectId: PROJECT_A, project: 'omega-service', state: 'thinking', eventId: 'rename', timestamp: NOW - 100 }))
  assert.deepEqual(found('alpha'), [])
  assert.deepEqual(found('omega'), ['omega-service'])
  assert.equal(Number(db.prepare('SELECT COUNT(*) AS count FROM session_search').get()!.count), 4)
  const { sql, params } = buildSessionListQuery('aang-airbender', normalizeSessionQuery({ search: 'omega' }, NOW), NOW, 31, ['x'])
  assert.match(plan(db, sql, params), /SEARCH sessions USING INDEX sqlite_autoindex_sessions_1 \(session_pk=\?\)/)
  assert.match(plan(db, 'SELECT session_pk FROM session_search WHERE session_search MATCH ?', ['"omega"']), /VIRTUAL TABLE INDEX/)
})

test('retention removes exactly the expired set even when last-seen times tie', (t) => {
  let now = NOW
  const { store, db } = open(t, () => now)
  for (let index = 0; index < 7; index += 1) {
    store.recordEvent(event({ sessionId: `tie-${index}`, project: 'tie', state: 'tool-running', toolName: 'Bash', timestamp: NOW - 5000 }))
  }
  now = NOW + 100 * 24 * 60 * 60 * 1000
  store.recordEvent(event({ sessionId: 'fresh', state: 'thinking', timestamp: now - 1000 }))
  const count = (sql: string) => Number(db.prepare(sql).get()!.count)
  const step = store.pruneBatch(3)
  assert.equal(step.sessions, 3)
  // No timeline or search row may outlive its session.
  assert.equal(count('SELECT COUNT(*) AS count FROM session_timeline WHERE session_pk NOT IN (SELECT session_pk FROM sessions)'), 0)
  assert.equal(count('SELECT COUNT(*) AS count FROM session_search WHERE rowid NOT IN (SELECT rowid FROM sessions)'), 0)
  while (store.pruneBatch(3).more) { /* bounded steps */ }
  assert.equal(count('SELECT COUNT(*) AS count FROM sessions'), 1)
  assert.equal(count('SELECT COUNT(*) AS count FROM session_timeline'), 1)
  assert.equal(count('SELECT COUNT(*) AS count FROM session_search'), 1)
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'sessions'").all().map(row => String(row.name))
  assert.ok(!indexes.includes('idx_history_sessions_last_seen'))
  assert.ok(!indexes.includes('idx_history_sessions_pet_final_seen'))
  assert.match(plan(db, 'SELECT MIN(pet_id) AS pet FROM sessions WHERE pet_id > ?', ['a']), /COVERING INDEX idx_history_sessions_pet_seen/)
})
