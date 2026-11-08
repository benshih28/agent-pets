import type { AgentState } from '../src/types/agent.ts'
import {
  HISTORY_SESSION_OUTCOMES,
  HISTORY_SESSION_PAGE_DEFAULT,
  HISTORY_SESSION_PAGE_MAX,
  HISTORY_SESSION_SEARCH_MAX,
  type HistorySessionListItem,
  type HistorySessionOutcome,
  type HistorySessionQuery,
} from '../src/types/history.ts'

// 工作階段清單的純函式：輸入驗證、SQL 組裝與資料列轉換。與 HistoryStore 分開，
// 讓 IPC 驗證與 SQL 形狀可以單獨測試，history.ts 只負責交易與寫入。

type SqliteRow = Record<string, unknown>

/** Stored `sessions.final_state` values; `open` splits into active/incomplete at read time. */
export type StoredSessionFinalState = 'success' | 'error' | 'cancelled' | 'open'

/** An open session with no event for this long is shown as incomplete, not active. */
export const SESSION_ACTIVE_WINDOW_MS = 15 * 60 * 1000
/** Rows kept per session; older transitions are dropped one by one as new ones arrive. */
export const SESSION_TIMELINE_STORED_MAX = 500
/** A single permission wait longer than this is clamped (machine slept, app closed...). */
export const MAX_PERMISSION_WAIT_MS = 6 * 60 * 60 * 1000

// session_pk = `${adapterId}:${agentId}:${hash24}`; the agent part is free text,
// so the id is only bounded, control-free and hash-suffixed (it is always bound).
const SESSION_ID = /^[^\u0000-\u001f\u007f]{1,400}:[a-f0-9]{24}$/
const ADAPTER_ID = /^[A-Za-z0-9._:-]{1,64}$/
const PROJECT_ID = /^[a-f0-9]{32}$/
const TOOL_NAME_UNSAFE = /[^A-Za-z0-9._:/@+ -]/g
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g
const MAX_TOOL_NAME_LENGTH = 64
const MAX_PROJECT_LABEL_LENGTH = 128
// Far-future bound for `to`; a session cannot be seen after "now", but clocks drift.
const MAX_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000
const OUTCOMES = new Set<string>(HISTORY_SESSION_OUTCOMES)

/**
 * Local-log usage rows store `digest(adapter:agent:rawSessionId)` in
 * events.session_id, where the agent is the log reader's id, not the hook
 * source. This maps a hook adapter to that reader id so a hook session can be
 * joined to its local-log tokens without keeping the raw session id.
 */
const LOCAL_USAGE_AGENT_BY_ADAPTER: Readonly<Record<string, string>> = {
  'claude-code': 'claude',
  codex: 'codex',
}

export function localUsageKeySource(adapterId: string, rawSessionId: string): string | null {
  const agent = LOCAL_USAGE_AGENT_BY_ADAPTER[adapterId]
  return agent ? `${adapterId}:${agent}:${rawSessionId}` : null
}

export function isHistorySessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID.test(value)
}

/** Tool name only: arguments never reach history. Unsafe characters are dropped. */
export function sanitizeToolName(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(TOOL_NAME_UNSAFE, '').trim().slice(0, MAX_TOOL_NAME_LENGTH)
}

/** The workspace's last path segment, never a full path. */
export function sanitizeProjectLabel(value: unknown): string {
  if (typeof value !== 'string') return ''
  const segment = value.split(/[/\\]/).filter(Boolean).pop() ?? ''
  return segment.replace(CONTROL_CHARS, '').trim().slice(0, MAX_PROJECT_LABEL_LENGTH)
}

/**
 * The outcome describes the latest turn, not the first one: Claude Code and
 * Codex emit success (Stop) or error (StopFailure) at the end of every turn,
 * and a new prompt makes the same session active again. So any working or
 * waiting state reopens the session; idle keeps whatever the turn ended with.
 */
export function nextFinalState(
  previous: StoredSessionFinalState | null,
  state: AgentState,
): StoredSessionFinalState {
  switch (state) {
    case 'success':
    case 'error':
      return state
    case 'offline':
      return 'cancelled'
    case 'thinking':
    case 'tool-running':
    case 'waiting-permission':
    case 'waiting-input':
      return 'open'
    default:
      return previous ?? 'open'
  }
}

function finiteTimestamp(value: unknown, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(max, Math.max(0, Math.floor(value)))
}

/**
 * Runtime validation of a renderer-supplied query. Unknown keys are ignored;
 * each known field is either valid or dropped, never passed through raw.
 */
export function normalizeSessionQuery(input: unknown, now: number): HistorySessionQuery & { limit: number } {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {}
  const maxTime = now + MAX_FUTURE_SKEW_MS
  const query: HistorySessionQuery & { limit: number } = { limit: HISTORY_SESSION_PAGE_DEFAULT }
  if (typeof raw.projectId === 'string' && PROJECT_ID.test(raw.projectId)) query.projectId = raw.projectId
  if (typeof raw.adapterId === 'string' && ADAPTER_ID.test(raw.adapterId)) query.adapterId = raw.adapterId
  const from = finiteTimestamp(raw.from, maxTime)
  const to = finiteTimestamp(raw.to, maxTime)
  if (from !== undefined) query.from = from
  if (to !== undefined) query.to = to
  // A reversed range (picked "to" before "from") means the same span, not all time.
  if (query.from !== undefined && query.to !== undefined && query.from > query.to) {
    [query.from, query.to] = [query.to, query.from]
  }
  if (typeof raw.outcome === 'string' && OUTCOMES.has(raw.outcome)) query.outcome = raw.outcome as HistorySessionOutcome
  if (typeof raw.search === 'string') {
    const search = raw.search.replace(CONTROL_CHARS, '').trim().slice(0, HISTORY_SESSION_SEARCH_MAX)
    if (search) query.search = search
  }
  if (typeof raw.limit === 'number' && Number.isInteger(raw.limit)) {
    query.limit = Math.min(HISTORY_SESSION_PAGE_MAX, Math.max(1, raw.limit))
  }
  const cursor = raw.cursor && typeof raw.cursor === 'object' ? raw.cursor as Record<string, unknown> : null
  const cursorAt = cursor ? finiteTimestamp(cursor.lastSeenAt, Number.MAX_SAFE_INTEGER) : undefined
  if (cursor && cursorAt !== undefined && isHistorySessionId(cursor.id)) {
    query.cursor = { lastSeenAt: cursorAt, id: cursor.id }
  }
  return query
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, match => `\\${match}`)
}

/**
 * Picks the index whose equality prefix covers the most selective filter, so
 * the page is a range scan in ORDER BY order (no temp B-tree sort):
 * project → (pet, project, seen); else (pet, seen). The outcome has only four
 * values, so it stays a residual filter rather than a third index that every
 * heartbeat (which moves last_seen_at) would have to rewrite.
 */
export function sessionListIndex(query: HistorySessionQuery): string {
  return query.projectId ? 'idx_history_sessions_pet_project_seen' : 'idx_history_sessions_pet_seen'
}

export const SESSION_LIST_COLUMNS = `
  session_pk, adapter_id, agent_id, project_id, project_label, started_at, ended_at,
  last_seen_at, active_ms, final_state, timeline_tracked, tool_runs, permission_waits,
  permission_wait_ms, token_input, token_output, token_quality, usage_key
`

/**
 * Builds the keyset page query. Every value is a bound parameter; the only
 * interpolated fragments are fixed clauses chosen from validated fields. The
 * leading (pet_id[, project_id]) equality plus ORDER BY last_seen_at DESC,
 * session_pk DESC matches an index, so a page reads at most a page of rows
 * past the cursor and never sorts.
 */
export function buildSessionListQuery(
  petId: string,
  query: HistorySessionQuery & { limit: number },
  now: number,
  limit = query.limit,
  /** Search hits from the trigram index; replaces the LIKE scan and drives the lookup by primary key. */
  matchedIds?: readonly string[],
): { sql: string; params: unknown[] } {
  // With search hits the primary key drives the lookup (at most a few thousand
  // rows, then sorted); unary + keeps the planner off the pet/time indexes.
  const noIndex = matchedIds ? '+' : ''
  const where = [`${noIndex}pet_id = ?`]
  const params: unknown[] = [petId]
  if (query.projectId) { where.push(`${noIndex}project_id = ?`); params.push(query.projectId) }
  if (query.adapterId) { where.push('adapter_id = ?'); params.push(query.adapterId) }
  if (query.from !== undefined) { where.push('last_seen_at >= ?'); params.push(query.from) }
  if (query.to !== undefined) { where.push('last_seen_at <= ?'); params.push(query.to) }
  switch (query.outcome) {
    case 'success':
    case 'error':
    case 'cancelled':
      where.push('final_state = ?')
      params.push(query.outcome)
      break
    case 'active':
      where.push("final_state = 'open' AND last_seen_at >= ?")
      params.push(now - SESSION_ACTIVE_WINDOW_MS)
      break
    case 'incomplete':
      where.push("final_state = 'open' AND last_seen_at < ?")
      params.push(now - SESSION_ACTIVE_WINDOW_MS)
      break
    default:
      break
  }
  if (matchedIds) {
    where.push('session_pk IN (SELECT value FROM json_each(?))')
    params.push(JSON.stringify(matchedIds))
  } else if (query.search) {
    const pattern = `%${escapeLike(query.search)}%`
    where.push("(project_label LIKE ? ESCAPE '\\' OR agent_id LIKE ? ESCAPE '\\' OR adapter_id LIKE ? ESCAPE '\\')")
    params.push(pattern, pattern, pattern)
  }
  if (query.cursor) {
    where.push('(last_seen_at, session_pk) < (?, ?)')
    params.push(query.cursor.lastSeenAt, query.cursor.id)
  }
  params.push(limit)
  return {
    sql: `SELECT ${SESSION_LIST_COLUMNS} FROM sessions
      ${matchedIds ? '' : `INDEXED BY ${sessionListIndex(query)}`}
      WHERE ${where.join(' AND ')}
      ORDER BY last_seen_at DESC, session_pk DESC
      LIMIT ?`,
    params,
  }
}

export interface SessionUsageTotals {
  tokenInput: number
  tokenOutput: number
  tokenCacheRead: number
  tokenCacheWrite: number
  topModel: string
  topModelTokens: number
}

function asInteger(value: unknown): number {
  const number = typeof value === 'bigint' ? Number(value) : Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function outcomeFor(finalState: unknown, lastSeenAt: number, now: number): HistorySessionOutcome {
  switch (finalState) {
    case 'success':
    case 'error':
    case 'cancelled':
      return finalState
    default:
      return now - lastSeenAt < SESSION_ACTIVE_WINDOW_MS ? 'active' : 'incomplete'
  }
}

/** Folds session_model_usage rows (one per usage key and model) into per-key totals. */
export function foldSessionUsage(rows: readonly SqliteRow[]): Map<string, SessionUsageTotals> {
  const totals = new Map<string, SessionUsageTotals>()
  for (const row of rows) {
    const key = asText(row.usage_key)
    if (!key) continue
    const entry = totals.get(key) ?? { tokenInput: 0, tokenOutput: 0, tokenCacheRead: 0, tokenCacheWrite: 0, topModel: '', topModelTokens: -1 }
    const input = asInteger(row.token_input)
    const output = asInteger(row.token_output)
    entry.tokenInput += input
    entry.tokenOutput += output
    entry.tokenCacheRead += asInteger(row.token_cache_read)
    entry.tokenCacheWrite += asInteger(row.token_cache_write)
    const model = asText(row.model)
    if (model && (input + output > entry.topModelTokens || (input + output === entry.topModelTokens && model < entry.topModel))) {
      entry.topModel = model
      entry.topModelTokens = input + output
    }
    totals.set(key, entry)
  }
  return totals
}

export function mapSessionRow(row: SqliteRow, usage: SessionUsageTotals | undefined, now: number): HistorySessionListItem {
  const startedAt = asInteger(row.started_at)
  const lastSeenAt = Math.max(startedAt, asInteger(row.last_seen_at))
  const tracked = asInteger(row.timeline_tracked) === 1
  const hookInput = asInteger(row.token_input)
  const hookOutput = asInteger(row.token_output)
  const hasLocal = Boolean(usage && usage.tokenInput + usage.tokenOutput + usage.tokenCacheRead + usage.tokenCacheWrite > 0)
  const tokenSource = hasLocal ? 'local' : hookInput + hookOutput > 0 ? 'hook' : 'none'
  return {
    id: asText(row.session_pk),
    adapterId: asText(row.adapter_id),
    agentId: asText(row.agent_id),
    projectId: asText(row.project_id),
    projectLabel: sanitizeProjectLabel(row.project_label),
    startedAt,
    endedAt: row.ended_at === null || row.ended_at === undefined ? null : asInteger(row.ended_at),
    lastSeenAt,
    durationMs: lastSeenAt - startedAt,
    activeMs: asInteger(row.active_ms),
    outcome: outcomeFor(row.final_state, lastSeenAt, now),
    tracked,
    toolRuns: asInteger(row.tool_runs),
    permissionWaits: asInteger(row.permission_waits),
    permissionWaitMs: asInteger(row.permission_wait_ms),
    tokenInput: hasLocal ? usage!.tokenInput : hookInput,
    tokenOutput: hasLocal ? usage!.tokenOutput : hookOutput,
    tokenCacheRead: hasLocal ? usage!.tokenCacheRead : 0,
    tokenCacheWrite: hasLocal ? usage!.tokenCacheWrite : 0,
    tokenSource,
    topModel: usage?.topModel ?? '',
  }
}
