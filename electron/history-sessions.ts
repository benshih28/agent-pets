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
import { isProjectId } from '../src/types/id-patterns.ts'

// 工作階段清單的純函式：輸入驗證、SQL 組裝與資料列轉換。與 HistoryStore 分開，
// 讓 IPC 驗證與 SQL 形狀可以單獨測試，history.ts 只負責交易與寫入。

type SqliteRow = Record<string, unknown>

/** `sessions.final_state` 的儲存值；`open` 在讀取時才分成進行中／未完成。 */
export type StoredSessionFinalState = 'success' | 'error' | 'cancelled' | 'open'

/** open 的 session 超過這麼久沒有事件，就顯示為未完成而不是進行中。 */
export const SESSION_ACTIVE_WINDOW_MS = 15 * 60 * 1000
/** 每個 session 保留的列數；新的轉換進來時逐筆丟掉最舊的。 */
export const SESSION_TIMELINE_STORED_MAX = 500
/** 單次權限等待超過這個長度就截斷（電腦睡眠、App 關閉等）。 */
export const MAX_PERMISSION_WAIT_MS = 6 * 60 * 60 * 1000

// session_pk = `${adapterId}:${agentId}:${hash24}`；agent 部分是自由文字，
// 所以只檢查長度、不含控制字元且以雜湊結尾（它一律以參數綁定）。
const SESSION_ID = /^[^\u0000-\u001f\u007f]{1,400}:[a-f0-9]{24}$/
const ADAPTER_ID = /^[A-Za-z0-9._:-]{1,64}$/
const TOOL_NAME_UNSAFE = /[^A-Za-z0-9._:/@+ -]/g
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g
const MAX_TOOL_NAME_LENGTH = 64
const MAX_PROJECT_LABEL_LENGTH = 128
// `to` 的未來上限：session 不可能在「現在」之後被看到，但時鐘會有誤差。
const MAX_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000
const OUTCOMES = new Set<string>(HISTORY_SESSION_OUTCOMES)

/**
 * 本機紀錄的用量列在 events.session_id 存 `digest(adapter:agent:rawSessionId)`，其中 agent 是
 * 紀錄讀取器記帳用的來源，而不是 hook 實際的來源。對照表來自 AGENT_FAMILY_REGISTRY.localUsageSource，
 * 讓 hook session 不必保留原始 session id 也能對上本機紀錄的 token。
 */
export function localUsageKeySource(adapterId: string, rawSessionId: string): string | null {
  const agent = Object.hasOwn(LOCAL_USAGE_SOURCE_BY_ADAPTER, adapterId)
    ? LOCAL_USAGE_SOURCE_BY_ADAPTER[adapterId as keyof typeof LOCAL_USAGE_SOURCE_BY_ADAPTER]
    : undefined
  return agent ? `${adapterId}:${agent}:${rawSessionId}` : null
}

export function isHistorySessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID.test(value)
}

/** 只有工具名稱：參數絕不進歷史紀錄。不安全的字元會被丟掉。 */
export function sanitizeToolName(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(TOOL_NAME_UNSAFE, '').trim().slice(0, MAX_TOOL_NAME_LENGTH)
}

/** 工作區路徑的最後一段，絕不是完整路徑。 */
export function sanitizeProjectLabel(value: unknown): string {
  if (typeof value !== 'string') return ''
  const segment = value.split(/[/\\]/).filter(Boolean).pop() ?? ''
  return segment.replace(CONTROL_CHARS, '').trim().slice(0, MAX_PROJECT_LABEL_LENGTH)
}

/**
 * 結局描述的是最近一輪而不是第一輪：Claude Code 與 Codex 每一輪結束都會送 success（Stop）
 * 或 error（StopFailure），新的提示又會讓同一個 session 再度進行。所以任何工作中或等待中的狀態
 * 都會重新開啟 session，idle 則保留這一輪的結局。
 */
// 每個事件都會呼叫 nextFinalState，所以模組載入時把狀態表攤平成一次 Map 查找。
const HISTORY_OUTCOME_BY_STATE: ReadonlyMap<string, AgentStateHistoryOutcome> = new Map(
  AGENT_STATES.map(state => [state, AGENT_STATE_POLICY[state].historyOutcome]),
)

export function nextFinalState(
  previous: StoredSessionFinalState | null,
  state: AgentState,
): StoredSessionFinalState {
  // 不認得的狀態跟 idle 一樣沿用上一輪結果。
  const outcome = HISTORY_OUTCOME_BY_STATE.get(state) ?? 'keep'
  return outcome === 'keep' ? previous ?? 'open' : outcome
}

function finiteTimestamp(value: unknown, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(max, Math.max(0, Math.floor(value)))
}

/**
 * renderer 傳來的查詢的執行期驗證。不認得的 key 一律忽略；
 * 認得的欄位要嘛有效、要嘛丟掉，絕不原樣傳下去。
 */
export function normalizeSessionQuery(input: unknown, now: number): HistorySessionQuery & { limit: number } {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {}
  const maxTime = now + MAX_FUTURE_SKEW_MS
  const query: HistorySessionQuery & { limit: number } = { limit: HISTORY_SESSION_PAGE_DEFAULT }
  if (isProjectId(raw.projectId)) query.projectId = raw.projectId
  if (typeof raw.adapterId === 'string' && ADAPTER_ID.test(raw.adapterId)) query.adapterId = raw.adapterId
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
 * 選等值前綴涵蓋最有鑑別度條件的索引，讓分頁是照 ORDER BY 順序的範圍掃描（不建暫存 B-tree 排序）：
 * 有 project 用 (pet, project, seen)，否則 (pet, seen)。結局只有四種值，所以留作剩餘條件，
 * 不另建第三個索引，否則每次心跳（會更新 last_seen_at）都要多改寫一個索引。
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
 * 組出 keyset 分頁查詢。所有值都是綁定參數，唯一內插的片段是依已驗證欄位選出的固定子句。
 * 開頭的 (pet_id[, project_id]) 等值加上 ORDER BY last_seen_at DESC, session_pk DESC 剛好對上索引，
 * 所以一頁最多只讀游標之後一頁的列，而且不排序。
 */
export function buildSessionListQuery(
  petId: string,
  query: HistorySessionQuery & { limit: number },
  now: number,
  limit = query.limit,
  /** trigram 索引的搜尋結果；取代 LIKE 掃描，改由主鍵帶動查詢。 */
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

/** 把 session_model_usage 的列（每個用量 key 與模型一列）彙總成每個 key 的總數。 */
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
