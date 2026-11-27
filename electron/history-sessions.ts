import {
  AGENT_STATE_POLICY,
  AGENT_STATES,
  LOCAL_USAGE_SOURCE_BY_ADAPTER,
  type AgentState,
  type AgentStateHistoryOutcome,
} from '../src/types/agent.ts'
import {
  HISTORY_SESSION_OUTCOMES,
  HISTORY_SESSION_PAGE_DEFAULT,
  HISTORY_SESSION_PAGE_MAX,
  HISTORY_SESSION_SEARCH_MAX,
  type HistorySessionListItem,
  type HistorySessionOutcome,
  type HistorySessionQuery,
} from '../src/types/history.ts'
import { isOpaqueId64, isProjectId } from '../src/types/id-patterns.ts'
import { asRecord, recordOrEmpty } from './value-guards.ts'

type SqliteRow = Record<string, unknown>

export type StoredSessionFinalState = 'success' | 'error' | 'cancelled' | 'open'

export const SESSION_ACTIVE_WINDOW_MS = 15 * 60 * 1000
export const SESSION_TIMELINE_STORED_MAX = 500
/** 電腦睡眠、App 關閉等會讓單次等待變得極長，所以要截斷。 */
export const MAX_PERMISSION_WAIT_MS = 6 * 60 * 60 * 1000

// agent 部分是自由文字，所以只檢查長度、不含控制字元且以雜湊結尾（一律以參數綁定）。
const SESSION_ID = /^[^\u0000-\u001f\u007f]{1,400}:[a-f0-9]{24}$/
const TOOL_NAME_UNSAFE = /[^A-Za-z0-9._:/@+ -]/g
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g
const MAX_TOOL_NAME_LENGTH = 64
const MAX_PROJECT_LABEL_LENGTH = 128
// `to` 的未來上限：session 不可能在「現在」之後被看到，但時鐘會有誤差。
const MAX_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000
const OUTCOMES = new Set<string>(HISTORY_SESSION_OUTCOMES)

// events.session_id 存的 agent 是紀錄讀取器記帳用的來源，不是 hook 實際的來源；對照表來自 localUsageSource。
export function localUsageKeySource(adapterId: string, rawSessionId: string): string | null {
  const agent = Object.hasOwn(LOCAL_USAGE_SOURCE_BY_ADAPTER, adapterId)
    ? LOCAL_USAGE_SOURCE_BY_ADAPTER[adapterId as keyof typeof LOCAL_USAGE_SOURCE_BY_ADAPTER]
    : undefined
  return agent ? `${adapterId}:${agent}:${rawSessionId}` : null
}

export function isHistorySessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID.test(value)
}

// 工具參數絕不進歷史紀錄。
export function sanitizeToolName(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(TOOL_NAME_UNSAFE, '').trim().slice(0, MAX_TOOL_NAME_LENGTH)
}

// 只取工作區路徑的最後一段，絕不是完整路徑。
export function sanitizeProjectLabel(value: unknown): string {
  if (typeof value !== 'string') return ''
  const segment = value.split(/[/\\]/).filter(Boolean).pop() ?? ''
  return segment.replace(CONTROL_CHARS, '').trim().slice(0, MAX_PROJECT_LABEL_LENGTH)
}

// 結局描述最近一輪：Claude Code 與 Codex 每輪結束都送 success／error，新提示又讓同一個 session 再度進行，
// 所以工作中或等待中的狀態會重新開啟 session，idle 則保留這一輪的結局。
const HISTORY_OUTCOME_BY_STATE: ReadonlyMap<string, AgentStateHistoryOutcome> = new Map(
  AGENT_STATES.map(state => [state, AGENT_STATE_POLICY[state].historyOutcome]),
)

export function nextFinalState(
  previous: StoredSessionFinalState | null,
  state: AgentState,
): StoredSessionFinalState {
  const outcome = HISTORY_OUTCOME_BY_STATE.get(state) ?? 'keep'
  return outcome === 'keep' ? previous ?? 'open' : outcome
}

function finiteTimestamp(value: unknown, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(max, Math.max(0, Math.floor(value)))
}

export function normalizeSessionQuery(input: unknown, now: number): HistorySessionQuery & { limit: number } {
  const raw = recordOrEmpty(input)
  const maxTime = now + MAX_FUTURE_SKEW_MS
  const query: HistorySessionQuery & { limit: number } = { limit: HISTORY_SESSION_PAGE_DEFAULT }
  if (isProjectId(raw.projectId)) query.projectId = raw.projectId
  if (isOpaqueId64(raw.adapterId)) query.adapterId = raw.adapterId
  const from = finiteTimestamp(raw.from, maxTime)
  const to = finiteTimestamp(raw.to, maxTime)
  if (from !== undefined) query.from = from
  if (to !== undefined) query.to = to
  // 起訖顛倒（先選了「到」才選「從」）代表同一段區間，而不是全部時間。
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
  const cursor = asRecord(raw.cursor)
  const cursorAt = cursor ? finiteTimestamp(cursor.lastSeenAt, Number.MAX_SAFE_INTEGER) : undefined
  if (cursor && cursorAt !== undefined && isHistorySessionId(cursor.id)) {
    query.cursor = { lastSeenAt: cursorAt, id: cursor.id }
  }
  return query
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, match => `\\${match}`)
}

// 結局只有四種值，留作剩餘條件、不另建索引，否則每次心跳（更新 last_seen_at）都要多改寫一個索引。
export function sessionListIndex(query: HistorySessionQuery): string {
  return query.projectId ? 'idx_history_sessions_pet_project_seen' : 'idx_history_sessions_pet_seen'
}

export const SESSION_LIST_COLUMNS = `
  session_pk, adapter_id, agent_id, project_id, project_label, started_at, ended_at,
  last_seen_at, active_ms, final_state, timeline_tracked, tool_runs, permission_waits,
  permission_wait_ms, token_input, token_output, token_quality, usage_key
`

// 所有值都是綁定參數，唯一內插的片段是依已驗證欄位選出的固定子句。
export function buildSessionListQuery(
  petId: string,
  query: HistorySessionQuery & { limit: number },
  now: number,
  limit = query.limit,
  matchedIds?: readonly string[],
): { sql: string; params: unknown[] } {
  // 有搜尋結果時由主鍵帶動查詢（最多幾千列再排序）；一元 + 讓查詢規劃器不走 pet／時間索引。
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
