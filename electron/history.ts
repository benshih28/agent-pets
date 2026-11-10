import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { isAgentState, type AgentStatusEvent, type AgentState } from '../src/types/agent.ts'
import type { AchievementCompletedSessionFact } from './achievements.ts'
import {
  HISTORY_TERMINAL_STATES,
  type HistoryAgentStat,
  type HistoryDailyStat,
  type HistoryExport,
  type HistoryModelStat,
  type HistoryQuotaSnapshot,
  type HistoryQuotaProvider,
  type HistoryQuotaWindow,
  type HistorySessionDetail,
  type HistorySessionListItem,
  type HistorySessionPage,
  type HistorySessionQuery,
  type HistorySessionTimelineEntry,
  HISTORY_SESSION_TIMELINE_MAX,
  type HistorySummary,
  type HistoryTokenUsageRecord,
  type HistoryTokenQuality,
  type HistoryUsageBlock,
} from '../src/types/history.ts'
import { latestUsageBlocks, USAGE_BLOCK_MS, type UsageBlockEntry } from '../src/utils/usage-blocks.ts'
import { dateOffset, localDateKey } from '../src/utils/local-date.ts'
import { applyWalPragmas, type SqlitePragmaState } from './sqlite-pragmas.ts'
import { StatementCache } from './sqlite-statements.ts'
import { eventPipelineStats } from './event-stats.ts'
import { isValidPetId } from '../src/utils/pet-id.ts'
import {
  MAX_PERMISSION_WAIT_MS,
  SESSION_LIST_COLUMNS,
  SESSION_TIMELINE_STORED_MAX,
  buildSessionListQuery,
  foldSessionUsage,
  isHistorySessionId,
  localUsageKeySource,
  mapSessionRow,
  nextFinalState,
  normalizeSessionQuery,
  sanitizeProjectLabel,
  sanitizeToolName,
  type StoredSessionFinalState,
} from './history-sessions.ts'
import { isProjectId } from '../src/types/id-patterns.ts'

type SqliteRow = Record<string, unknown>

interface SqliteStatement {
  run(...params: unknown[]): { changes: number | bigint, lastInsertRowid?: number | bigint }
  get(...params: unknown[]): SqliteRow | undefined
  all(...params: unknown[]): SqliteRow[]
}

interface SqliteDatabase {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
  close(): void
}

type DatabaseSyncConstructor = new (filePath: string) => SqliteDatabase

export interface HistoryStoreOptions {
  now?: () => number
  localDate?: (timestamp: number) => string
  /** Local UTC offset in minutes at a time (+330 for India); 5-hour blocks floor to the local hour. */
  timezoneOffsetMinutes?: (timestamp: number) => number
  retentionDays?: number
}

const DEFAULT_PET_ID = 'aang-airbender'
const LOCAL_USAGE_PET_ID = 'local-usage'
const DEFAULT_RETENTION_DAYS = 90
const MAX_RETENTION_DAYS = 3650
const MAX_TEXT_LENGTH = 128
const MAX_SESSION_ID_LENGTH = 256
const MAX_TOKEN_COUNT = 1_000_000_000_000
const MAX_QUOTA_SNAPSHOTS = 500
const QUOTA_SNAPSHOT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const ACHIEVEMENT_RECONCILED_KEY = 'achievement_reconciled_at'
const MAX_QUOTA_PROVIDERS = 8
const MAX_QUOTA_WINDOWS = 32
const MAX_QUEUED_EVENTS = 500
const FLUSH_RETRY_BASE_MS = 250
const FLUSH_RETRY_MAX_MS = 5000
const PRUNE_BATCH_ROWS = 5000
const ACTIVE_ROLLUP_STATE = 'active-rollup'
const MAX_ACTIVE_GAP_MS = 5 * 60 * 1000
const COMPLETED_SESSION_PAGE_ROWS = 5000
const LOCAL_USAGE_CUTOFF_KEY = 'local_usage_cutoff_at'
const HISTORY_RANGES: readonly number[] = [7, 30, 90]
const ACTIVE_STATES = new Set<AgentState>(['thinking', 'tool-running'])
const SAFE_ID = /^[A-Za-z0-9._:-]{1,256}$/
// 模型 id 只允許常見識別字元，最多一個 `provider/model` 斜線段；`<synthetic>` 之類的佔位值、
// 含空白、`..`、磁碟代號或看起來像本機路徑（Users/、home/…）的字串一律視為未知，避免路徑外洩到 UI 或匯出。
const MODEL_SEGMENT = '[A-Za-z0-9][A-Za-z0-9._:@+-]{0,63}'
const MODEL_ID = new RegExp(`^${MODEL_SEGMENT}(?:/${MODEL_SEGMENT})?$`)
const MAX_MODEL_ID_LENGTH = 96
const PATH_ROOT_SEGMENTS = new Set([
  'users', 'home', 'root', 'var', 'tmp', 'private', 'mnt', 'media', 'opt', 'usr', 'etc', 'volumes', 'library', 'srv',
])
// 5 小時區塊要往回找到「≥5 小時空檔」才能定出起點；只回看 24 小時，
// 連續 24 小時沒有空檔的極端情況下，區塊起點會從回看窗口內第一筆重新對齊。
const USAGE_BLOCK_LOOKBACK_MS = 24 * 60 * 60 * 1000
const MAX_EXPORT_SESSIONS = 1000
const MAX_SEARCH_MATCHES = 2000
const SESSION_COLUMNS = `
  rowid AS session_rowid, session_pk, adapter_id, agent_id, external_session_id, project_id, pet_id,
  started_at, ended_at, terminal_state, active_ms, token_input, token_output,
  token_quality, last_state, last_seen_at, project_label, usage_key, final_state,
  last_tool, tool_runs, permission_waits, permission_wait_ms, state_since,
  timeline_tracked, timeline_count
`
const MAX_USAGE_BLOCK_ROWS = 50_000

export function safeModelId(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_MODEL_ID_LENGTH || !MODEL_ID.test(value)) return ''
  if (value.includes('..') || /^[A-Za-z]:/.test(value)) return ''
  const slash = value.indexOf('/')
  if (slash >= 0 && PATH_ROOT_SEGMENTS.has(value.slice(0, slash).toLowerCase())) return ''
  return value
}

function databaseConstructor(): DatabaseSyncConstructor {
  const moduleRequire = createRequire(import.meta.url)
  const loaded = moduleRequire('node:sqlite') as { DatabaseSync?: DatabaseSyncConstructor }
  if (!loaded.DatabaseSync) throw new Error('SQLite is unavailable in this runtime')
  return loaded.DatabaseSync
}

function asInteger(value: unknown, fallback = 0): number {
  const number = typeof value === 'bigint' ? Number(value) : Number(value)
  return Number.isSafeInteger(number) ? number : fallback
}

function safeCount(value: unknown): number | null {
  const number = asInteger(value, -1)
  return number >= 0 && number <= MAX_TOKEN_COUNT ? number : null
}

function safeText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_TEXT_LENGTH) : fallback
}

function safePetId(value: string | undefined): string {
  return isValidPetId(value, 128) ? value : DEFAULT_PET_ID
}

function digest(value: string, length = 24): string {
  return createHash('sha256').update(value).digest('hex').slice(0, length)
}

function historySessionHash(adapterId: string, agentId: string, sessionId: string, projectId: string): string {
  return digest(`${adapterId}:${agentId}:${sessionId}:${projectId}`)
}

function historySessionPk(adapterId: string, agentId: string, sessionId: string, projectId: string): string {
  return `${adapterId}:${agentId}:${historySessionHash(adapterId, agentId, sessionId, projectId)}`
}

function changedCount(result: { changes: number | bigint }): number {
  return asInteger(result.changes)
}

function isActiveState(value: unknown): value is AgentState {
  return typeof value === 'string' && ACTIVE_STATES.has(value as AgentState)
}

function isTokenQuality(value: unknown): value is HistoryTokenQuality {
  return value === 'none' || value === 'estimated' || value === 'exact'
}

function mergeTokenQuality(left: HistoryTokenQuality, right: HistoryTokenQuality): HistoryTokenQuality {
  if (left === 'exact' || right === 'exact') return 'exact'
  if (left === 'estimated' || right === 'estimated') return 'estimated'
  return 'none'
}

function eventType(state: AgentState): string {
  if (state === 'success') return 'agent.session.completed'
  if (state === 'error') return 'agent.session.failed'
  if (state === 'offline') return 'agent.session.cancelled'
  if (state === 'waiting-input') return 'agent.waiting_input'
  if (state === 'waiting-permission') return 'agent.permission.requested'
  if (state === 'tool-running') return 'agent.tool.started'
  if (state === 'thinking') return 'agent.working'
  return 'agent.session.started'
}

function tokenUsage(event: AgentStatusEvent): {
  input: number | null
  output: number | null
  quality: HistoryTokenQuality
} {
  const usage = event.tokenUsage
  if (!usage || (usage.quality !== 'estimated' && usage.quality !== 'exact')) {
    return { input: null, output: null, quality: 'none' }
  }
  return {
    input: safeCount(usage.input),
    output: safeCount(usage.output),
    quality: usage.quality,
  }
}

interface DailyBatchEntry {
  localDate: string
  petId: string
  projectId: string
  adapterId: string
  activeMs: number
  tokenInput: number
  tokenOutput: number
  tokenCacheRead: number
  tokenCacheWrite: number
  tokenQuality: HistoryTokenQuality
}

interface SessionRow {
  sessionPk: string
  adapterId: string
  agentId: string
  externalSessionId: string
  projectId: string
  petId: string
  startedAt: number
  endedAt: number | null
  terminalState: AgentState | null
  activeMs: number
  tokenInput: number
  tokenOutput: number
  tokenQuality: HistoryTokenQuality
  lastState: AgentState
  /** last_state as stored (lastState folds waiting states into idle for the active-time rules). */
  rawLastState: AgentState
  lastSeenAt: number
  rowid: number
  projectLabel: string
  usageKey: string
  finalState: StoredSessionFinalState
  lastTool: string
  toolRuns: number
  permissionWaits: number
  permissionWaitMs: number
  stateSince: number
  tracked: boolean
  timelineCount: number
}

function sessionSearchText(label: string, agentId: string, adapterId: string): string {
  return `${label}\n${agentId}\n${adapterId}`
}

const STORED_FINAL_STATES = new Set<string>(['success', 'error', 'cancelled', 'open'])

function readSession(row: SqliteRow | undefined): SessionRow | null {
  if (!row || typeof row.session_pk !== 'string' || typeof row.adapter_id !== 'string') return null
  const state = typeof row.last_state === 'string' ? row.last_state as AgentState : 'idle'
  return {
    sessionPk: row.session_pk,
    adapterId: row.adapter_id,
    agentId: safeText(row.agent_id),
    externalSessionId: safeText(row.external_session_id),
    projectId: safeText(row.project_id),
    petId: safePetId(typeof row.pet_id === 'string' ? row.pet_id : undefined),
    startedAt: asInteger(row.started_at),
    endedAt: row.ended_at === null || row.ended_at === undefined ? null : asInteger(row.ended_at),
    terminalState: HISTORY_TERMINAL_STATES.has(row.terminal_state as AgentState)
      ? row.terminal_state as AgentState
      : null,
    activeMs: Math.max(0, asInteger(row.active_ms)),
    tokenInput: Math.max(0, asInteger(row.token_input)),
    tokenOutput: Math.max(0, asInteger(row.token_output)),
    tokenQuality: isTokenQuality(row.token_quality) ? row.token_quality : 'none',
    lastState: isActiveState(state) || HISTORY_TERMINAL_STATES.has(state) || state === 'idle'
      ? state
      : 'idle',
    lastSeenAt: Math.max(0, asInteger(row.last_seen_at)),
    rawLastState: isAgentState(state) ? state : 'idle',
    rowid: asInteger(row.session_rowid),
    projectLabel: safeText(row.project_label),
    usageKey: safeText(row.usage_key),
    finalState: STORED_FINAL_STATES.has(row.final_state as string) ? row.final_state as StoredSessionFinalState : 'open',
    lastTool: safeText(row.last_tool),
    toolRuns: Math.max(0, asInteger(row.tool_runs)),
    permissionWaits: Math.max(0, asInteger(row.permission_waits)),
    permissionWaitMs: Math.max(0, asInteger(row.permission_wait_ms)),
    stateSince: Math.max(0, asInteger(row.state_since)),
    tracked: asInteger(row.timeline_tracked) === 1,
    timelineCount: Math.max(0, asInteger(row.timeline_count)),
  }
}

interface ModelBatchEntry {
  localDate: string
  projectId: string
  adapterId: string
  model: string
  tokenInput: number
  tokenOutput: number
  tokenCacheRead: number
  tokenCacheWrite: number
}

interface SessionUsageBatchEntry {
  usageKey: string
  model: string
  lastAt: number
  tokenInput: number
  tokenOutput: number
  tokenCacheRead: number
  tokenCacheWrite: number
}

interface HistoryQueuedEvent { event: AgentStatusEvent, petId: string, receivedAt: number, onRecorded?: () => void }

/** A pure "still active" heartbeat: no token usage and no adapter-supplied identity. */
function isQueuedHeartbeat(item: HistoryQueuedEvent): boolean {
  const { event } = item
  return isActiveState(event.state)
    && tokenUsage(event).quality === 'none'
    && !SAFE_ID.test(event.eventId ?? '')
    && !event.sourceEventId
}

/** Bounds a queue to `limit`, shedding oldest heartbeats first, then oldest others as a last resort. */
export function trimQueuedEvents(items: HistoryQueuedEvent[], limit: number): HistoryQueuedEvent[] {
  let excess = items.length - limit
  if (excess <= 0) return items
  const drop = new Set<number>()
  for (let i = 0; i < items.length && excess > 0; i += 1) {
    if (isQueuedHeartbeat(items[i]!)) { drop.add(i); excess -= 1 }
  }
  eventPipelineStats.historyDroppedHeartbeats += drop.size
  if (excess > 0) {
    // Only reachable when more than `limit` terminal/token events are pending.
    for (let i = 0; i < items.length && excess > 0; i += 1) {
      if (!drop.has(i)) { drop.add(i); excess -= 1; eventPipelineStats.historyDroppedEvents += 1 }
    }
  }
  return items.filter((_, i) => !drop.has(i))
}

export class HistoryStore {
  private readonly database: SqliteDatabase
  private readonly now: () => number
  private readonly localDate: (timestamp: number) => string
  private readonly timezoneOffsetMinutes: (timestamp: number) => number
  private readonly retentionDays: number
  private readonly statements: StatementCache<SqliteStatement>
  private pragmas: SqlitePragmaState = { journalMode: '', synchronous: -1 }
  private transactionDepth = 0
  private dailyBatch: Map<string, DailyBatchEntry> | null = null
  private modelBatch: Map<string, ModelBatchEntry> | null = null
  private sessionUsageBatch: Map<string, SessionUsageBatchEntry> | null = null
  private queuedEvents: HistoryQueuedEvent[] = []
  private flushHandle: ReturnType<typeof setImmediate> | null = null
  private retryHandle: ReturnType<typeof setTimeout> | null = null
  private flushFailures = 0
  private closed = false
  /** FTS5 trigram index for session search; false when the SQLite build lacks FTS5. */
  private sessionSearchIndexed = false

  constructor(filePath: string, options: HistoryStoreOptions = {}) {
    mkdirSync(dirname(filePath), { recursive: true })
    const DatabaseSync = databaseConstructor()
    this.database = new DatabaseSync(filePath)
    this.statements = new StatementCache(sql => this.database.prepare(sql))
    this.now = options.now ?? Date.now
    this.localDate = options.localDate ?? localDateKey
    this.timezoneOffsetMinutes = options.timezoneOffsetMinutes ?? (timestamp => -new Date(timestamp).getTimezoneOffset())
    this.retentionDays = Math.min(MAX_RETENTION_DAYS, Math.max(1, Math.floor(options.retentionDays ?? DEFAULT_RETENTION_DAYS)))
    try {
      this.migrate()
      this.pruneEvents()
      const count = asInteger(this.statement('SELECT COUNT(*) AS count FROM daily_stats').get()?.count)
      if (count === 0) this.rebuildDailyStats()
    } catch (error) {
      this.database.close()
      throw error
    }
  }

  getPragmaState(): SqlitePragmaState {
    return this.pragmas
  }

  getRetentionDays(): number {
    return this.retentionDays
  }

  getLocalUsageCutoff(): number {
    const value = this.statement(
      'SELECT value FROM history_metadata WHERE key = ?',
    ).get(LOCAL_USAGE_CUTOFF_KEY)?.value
    const cutoff = Number(value)
    return Number.isFinite(cutoff) && cutoff >= 0 ? cutoff : 0
  }

  recordEvent(event: AgentStatusEvent, petId = DEFAULT_PET_ID, receivedAt = this.now()): boolean {
    if (event.originalEvent === 'AgentPetsIntegrationTest') return false
    const safePet = safePetId(petId)
    const adapterId = SAFE_ID.test(event.adapterId ?? '') ? event.adapterId! : 'generic-http'
    const agentId = safeText(event.source, 'unknown')
    const externalId = safeText(event.sessionId).slice(0, MAX_SESSION_ID_LENGTH)
    if (!externalId) return false
    const projectId = isProjectId(event.projectId)
      ? event.projectId
      : event.project ? digest(event.project) : ''
    // A CLI may reuse a session ID in different workspaces. Keep their
    // active-time and completion aggregates isolated once project routing is
    // enabled, while the empty project ID preserves the legacy key shape.
    const sessionIdHash = historySessionHash(adapterId, agentId, externalId, projectId)
    const sessionPk = `${adapterId}:${agentId}:${sessionIdHash}`
    const occurredAt = Number.isFinite(event.timestamp) ? Math.min(event.timestamp, receivedAt) : receivedAt
    const safeReceivedAt = Number.isFinite(receivedAt) ? receivedAt : this.now()
    const state = event.state
    const usage = tokenUsage(event)
    const eventId = SAFE_ID.test(event.eventId ?? '')
      ? event.eventId!
      : digest(`${adapterId}:${agentId}:${externalId}:${state}:${occurredAt}:${projectId}:${event.originalEvent ?? ''}`)
    const sourceEventId = typeof event.sourceEventId === 'string' ? safeText(event.sourceEventId) : null
    const localDate = this.localDate(occurredAt)
    const completionKind = state === 'success' || state === 'error' ? state : null

    return this.transaction(() => {
      const previous = readSession(this.statement(`
        SELECT ${SESSION_COLUMNS} FROM sessions WHERE session_pk = ?
      `).get(sessionPk))
      const successAlreadyRecorded = completionKind === 'success' && Boolean(this.statement(`
        SELECT event_id FROM events
        WHERE agent_id = ? AND session_id = ? AND project_id = ? AND pet_id = ? AND state = 'success'
        LIMIT 1
      `).get(agentId, externalId, projectId, safePet))
      // A later success is the durable outcome for a session that previously
      // emitted an error. Once successful, later terminal noise cannot demote
      // or recount the session.
      const sessionTerminalTransition = completionKind === 'success'
        ? previous?.terminalState === 'success' ? null : 'success'
        : completionKind === 'error' && !previous?.terminalState ? 'error' : null
      const aggregateTerminalTransition = completionKind === 'success'
        ? successAlreadyRecorded ? null : 'success'
        : sessionTerminalTransition
      const activeDeltaMs = previous && isActiveState(previous.lastState) && occurredAt > previous.lastSeenAt
        ? Math.min(occurredAt - previous.lastSeenAt, MAX_ACTIVE_GAP_MS)
        : 0
      // Heartbeats (thinking / tool-running with no token usage and no
      // adapter-supplied identity) carry no fact beyond "the session is still
      // active". Only their accumulated active time is durable: it is folded into
      // one rollup row per session-day instead of one events row per heartbeat.
      // Nothing reads individual heartbeat rows: successAlreadyRecorded and the
      // achievement backfill only look at state = 'success', and the daily_stats
      // rebuild only sums active_delta_ms, which the rollup row preserves.
      const isHeartbeat = isActiveState(state)
        && usage.quality === 'none'
        && !SAFE_ID.test(event.eventId ?? '')
        && sourceEventId === null
      let inserted: number
      if (isHeartbeat) {
        // The old per-row dedupe ignored replays; a heartbeat that is not newer
        // than the session's last activity can add neither time nor state.
        if (previous && occurredAt <= previous.lastSeenAt) return false
        if (activeDeltaMs > 0) {
          this.statement(`
            INSERT INTO events(
              event_id, source_event_id, schema_version, type, trust, adapter_id, agent_id,
              session_id, project_id, pet_id, local_date, occurred_at, received_at, state,
              active_delta_ms, completion_kind, token_input, token_output, token_quality, payload_json
            ) VALUES (?, NULL, 2, 'agent.active_rollup', 'adapter_verified', ?, ?, ?, ?, ?, ?, ?, ?, '${ACTIVE_ROLLUP_STATE}',
                      ?, NULL, NULL, NULL, 'none', '{}')
            ON CONFLICT(event_id) DO UPDATE SET
              active_delta_ms = active_delta_ms + excluded.active_delta_ms,
              occurred_at = MAX(occurred_at, excluded.occurred_at),
              received_at = excluded.received_at
          `).run(
            digest(`rollup:${sessionPk}:${localDate}:${safePet}`),
            adapterId,
            agentId,
            externalId,
            projectId,
            safePet,
            localDate,
            occurredAt,
            safeReceivedAt,
            activeDeltaMs,
          )
        }
        inserted = 1
      } else {
        inserted = changedCount(this.statement(`
        INSERT OR IGNORE INTO events(
          event_id, source_event_id, schema_version, type, trust, adapter_id, agent_id,
          session_id, project_id, pet_id, local_date, occurred_at, received_at, state,
          active_delta_ms, completion_kind, token_input, token_output, token_quality, payload_json
        ) VALUES (?, ?, 2, ?, 'adapter_verified', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        eventId,
        sourceEventId,
        eventType(state),
        adapterId,
        agentId,
        externalId,
        projectId,
        safePet,
        localDate,
        occurredAt,
        safeReceivedAt,
        state,
        activeDeltaMs,
        aggregateTerminalTransition,
        usage.input,
        usage.output,
        usage.quality,
        JSON.stringify({ state }),
      ))
      }
      if (inserted === 0) return false

      const nextActiveMs = (previous?.activeMs ?? 0) + activeDeltaMs
      const nextInput = (previous?.tokenInput ?? 0) + (usage.input ?? 0)
      const nextOutput = (previous?.tokenOutput ?? 0) + (usage.output ?? 0)
      const nextQuality = mergeTokenQuality(previous?.tokenQuality ?? 'none', usage.quality)
      // Timeline: one row per state change (or per tool change while running a
      // tool), so heartbeats that repeat the current state cost nothing extra.
      const toolName = state === 'tool-running' ? sanitizeToolName(event.toolName) : ''
      const transition = !previous
        || previous.rawLastState !== state
        || (state === 'tool-running' && toolName !== '' && toolName !== previous.lastTool)
      const leftPermission = transition && previous?.rawLastState === 'waiting-permission' && state !== 'waiting-permission'
      const waitStartedAt = previous?.stateSince ?? 0
      const waitedMs = leftPermission && waitStartedAt > 0
        ? Math.min(MAX_PERMISSION_WAIT_MS, Math.max(0, occurredAt - waitStartedAt))
        : 0
      const nextToolRuns = (previous?.toolRuns ?? 0) + (transition && state === 'tool-running' ? 1 : 0)
      const nextPermissionWaits = (previous?.permissionWaits ?? 0)
        + (transition && state === 'waiting-permission' ? 1 : 0)
      const nextPermissionWaitMs = (previous?.permissionWaitMs ?? 0) + waitedMs
      const nextStateSince = transition ? occurredAt : previous?.stateSince ?? occurredAt
      const nextLastTool = state === 'tool-running' ? (toolName || previous?.lastTool || '') : ''
      const nextTimelineCount = (previous?.timelineCount ?? 0) + (transition ? 1 : 0)
      // A late, out-of-order event must not overwrite the latest turn's outcome.
      const nextFinal = previous && occurredAt < previous.lastSeenAt
        ? previous.finalState
        : nextFinalState(previous?.finalState ?? null, state)
      const projectLabel = sanitizeProjectLabel(event.project) || previous?.projectLabel || ''
      if (!previous) {
        const usageSource = localUsageKeySource(adapterId, externalId)
        const insertedSession = this.statement(`
          INSERT INTO sessions(
            session_pk, adapter_id, agent_id, external_session_id, project_id, pet_id,
            started_at, ended_at, terminal_state, active_ms, token_input, token_output,
            token_quality, last_state, last_seen_at, project_label, usage_key, final_state,
            last_tool, tool_runs, permission_waits, permission_wait_ms, state_since,
            timeline_tracked, timeline_count
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
        `).run(
          sessionPk,
          adapterId,
          agentId,
          sessionIdHash,
          projectId,
          safePet,
          occurredAt,
          sessionTerminalTransition ? occurredAt : null,
          sessionTerminalTransition,
          nextActiveMs,
          nextInput,
          nextOutput,
          nextQuality,
          state,
          occurredAt,
          projectLabel,
          usageSource ? digest(usageSource) : '',
          nextFinal,
          nextLastTool,
          nextToolRuns,
          nextPermissionWaits,
          nextPermissionWaitMs,
          nextStateSince,
          nextTimelineCount,
        )
        this.indexSessionSearch(asInteger(insertedSession.lastInsertRowid), sessionPk, projectLabel, agentId, adapterId, false)
      } else {
        this.statement(`
          UPDATE sessions
          SET ended_at = CASE WHEN ? IS NOT NULL THEN ? ELSE ended_at END,
              terminal_state = CASE WHEN ? IS NOT NULL THEN ? ELSE terminal_state END,
              active_ms = ?, token_input = ?, token_output = ?, token_quality = ?,
              last_state = ?, last_seen_at = MAX(last_seen_at, ?),
              final_state = ?, last_tool = ?, tool_runs = ?,
              permission_waits = ?, permission_wait_ms = ?, state_since = ?, timeline_count = ?
          WHERE session_pk = ?
        `).run(
          sessionTerminalTransition,
          occurredAt,
          sessionTerminalTransition,
          sessionTerminalTransition,
          nextActiveMs,
          nextInput,
          nextOutput,
          nextQuality,
          state,
          occurredAt,
          nextFinal,
          nextLastTool,
          nextToolRuns,
          nextPermissionWaits,
          nextPermissionWaitMs,
          nextStateSince,
          nextTimelineCount,
          sessionPk,
        )
        // The label almost never changes: only then rewrite it and its search entry.
        if (projectLabel !== previous.projectLabel) {
          this.statement('UPDATE sessions SET project_label = ? WHERE session_pk = ?').run(projectLabel, sessionPk)
          this.indexSessionSearch(previous.rowid, sessionPk, projectLabel, agentId, adapterId, true)
        }
      }
      if (transition) this.appendTimeline(sessionPk, nextTimelineCount - 1, occurredAt, state, toolName)

      if (
        previous?.terminalState === 'error'
        && sessionTerminalTransition === 'success'
        && previous.endedAt !== null
      ) {
        this.adjustDailyCompletion(
          this.localDate(previous.endedAt),
          previous.petId,
          previous.projectId,
          previous.adapterId,
          0,
          -1,
        )
      }

      this.updateDailyStat(
        localDate,
        safePet,
        projectId,
        adapterId,
        aggregateTerminalTransition,
        activeDeltaMs,
        usage.input ?? 0,
        usage.output ?? 0,
        usage.quality,
      )
      return true
    })
  }

  recordTokenUsage(record: HistoryTokenUsageRecord, petId = DEFAULT_PET_ID, receivedAt = this.now()): boolean {
    // Local logs describe the machine/account, not the currently selected pet.
    // Keep them in a global bucket so switching pets cannot make token totals
    // appear to drop to zero. The parameter remains for API compatibility.
    void petId
    return this.applyTokenUsage(record, receivedAt)
  }

  /**
   * Imports many local-log records in one transaction. Event rows keep their
   * per-record dedupe, but the daily_stats deltas are summed in memory and
   * written once per (date, pet, project, adapter) key at the end, so N records
   * cost O(N) event statements plus O(keys) aggregate statements.
   */
  recordTokenUsageBatch(records: readonly HistoryTokenUsageRecord[], receivedAt = this.now()): number {
    if (records.length === 0) return 0
    return this.transaction(() => {
      const nested = this.dailyBatch !== null
      if (!nested) {
        this.dailyBatch = new Map()
        this.modelBatch = new Map()
        this.sessionUsageBatch = new Map()
      }
      let imported = 0
      try {
        for (const record of records) {
          if (this.applyTokenUsage(record, receivedAt)) imported += 1
        }
        if (!nested) {
          this.flushDailyBatch()
          this.flushModelBatch()
          this.flushSessionUsageBatch()
        }
      } finally {
        if (!nested) {
          this.dailyBatch = null
          this.modelBatch = null
          this.sessionUsageBatch = null
        }
      }
      return imported
    })
  }

  private flushDailyBatch(): void {
    const batch = this.dailyBatch
    this.dailyBatch = null
    if (!batch) return
    for (const entry of batch.values()) {
      this.updateDailyStat(
        entry.localDate, entry.petId, entry.projectId, entry.adapterId, null, entry.activeMs,
        entry.tokenInput, entry.tokenOutput, entry.tokenQuality, entry.tokenCacheRead, entry.tokenCacheWrite,
      )
    }
  }

  private flushModelBatch(): void {
    const batch = this.modelBatch
    this.modelBatch = null
    if (!batch) return
    for (const entry of batch.values()) {
      this.updateModelStat(
        entry.localDate, entry.projectId, entry.adapterId, entry.model,
        entry.tokenInput, entry.tokenOutput, entry.tokenCacheRead, entry.tokenCacheWrite,
      )
    }
  }

  /** Additive per-model aggregate; batched in memory during recordTokenUsageBatch. */
  private updateModelStat(
    localDate: string,
    projectId: string,
    adapterId: string,
    model: string,
    tokenInput: number,
    tokenOutput: number,
    tokenCacheRead: number,
    tokenCacheWrite: number,
  ): void {
    if (tokenInput === 0 && tokenOutput === 0 && tokenCacheRead === 0 && tokenCacheWrite === 0) return
    if (this.modelBatch) {
      const key = `${localDate}\u0000${projectId}\u0000${adapterId}\u0000${model}`
      const entry = this.modelBatch.get(key) ?? {
        localDate, projectId, adapterId, model, tokenInput: 0, tokenOutput: 0, tokenCacheRead: 0, tokenCacheWrite: 0,
      }
      entry.tokenInput += tokenInput
      entry.tokenOutput += tokenOutput
      entry.tokenCacheRead += tokenCacheRead
      entry.tokenCacheWrite += tokenCacheWrite
      this.modelBatch.set(key, entry)
      return
    }
    this.statement(`
      INSERT INTO daily_model_stats(
        local_date, project_id, adapter_id, model, token_input, token_output, token_cache_read, token_cache_write
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(local_date, project_id, adapter_id, model) DO UPDATE SET
        token_input = MAX(0, token_input + ?),
        token_output = MAX(0, token_output + ?),
        token_cache_read = MAX(0, token_cache_read + ?),
        token_cache_write = MAX(0, token_cache_write + ?)
    `).run(
      localDate, projectId, adapterId, model,
      Math.max(0, tokenInput), Math.max(0, tokenOutput), Math.max(0, tokenCacheRead), Math.max(0, tokenCacheWrite),
      tokenInput, tokenOutput, tokenCacheRead, tokenCacheWrite,
    )
  }

  private applyTokenUsage(record: HistoryTokenUsageRecord, receivedAt: number): boolean {
    const safePet = LOCAL_USAGE_PET_ID
    const adapterId = SAFE_ID.test(record.adapterId) ? record.adapterId : ''
    const agentId = safeText(record.agentId, 'unknown')
    const sourceEventId = safeText(record.sourceEventId)
    if (!adapterId || !agentId || !sourceEventId) return false
    const input = safeCount(record.input) ?? 0
    const output = safeCount(record.output) ?? 0
    const cacheRead = safeCount(record.cacheRead) ?? 0
    const cacheWrite = safeCount(record.cacheWrite) ?? 0
    if (input === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0) return false
    if (record.quality !== 'exact' && record.quality !== 'estimated') return false
    const safeReceivedAt = Number.isFinite(receivedAt) ? receivedAt : this.now()
    const occurredAt = Number.isFinite(record.occurredAt)
      ? Math.min(record.occurredAt, safeReceivedAt)
      : safeReceivedAt
    const localDate = this.localDate(occurredAt)
    const projectId = isProjectId(record.projectId)
      ? record.projectId
      : ''
    const sessionId = typeof record.sessionId === 'string' && record.sessionId.length > 0
      ? digest(`${adapterId}:${agentId}:${record.sessionId}`)
      : null
    const eventId = digest(`local-usage:${adapterId}:${sourceEventId}`)
    const model = safeModelId(record.model)

    return this.transaction(() => {
      const existing = this.statement(`
        SELECT event_id, local_date, project_id, token_input, token_output,
               token_cache_read, token_cache_write, token_quality, occurred_at, token_model, session_id
        FROM events WHERE adapter_id = ? AND source_event_id = ?
      `).get(adapterId, sourceEventId)
      if (existing) {
        const previousInput = Math.max(0, asInteger(existing.token_input))
        const previousOutput = Math.max(0, asInteger(existing.token_output))
        const previousCacheRead = Math.max(0, asInteger(existing.token_cache_read))
        const previousCacheWrite = Math.max(0, asInteger(existing.token_cache_write))
        const previousDate = safeText(existing.local_date)
        const previousProjectId = safeText(existing.project_id)
        const previousOccurredAt = asInteger(existing.occurred_at)
        const previousModel = safeModelId(existing.token_model)
        const previousQuality = isTokenQuality(existing.token_quality)
          ? existing.token_quality
          : 'none'
        if (
          previousInput === input
          && previousOutput === output
          && previousCacheRead === cacheRead
          && previousCacheWrite === cacheWrite
          && previousDate === localDate
          && previousProjectId === projectId
          && previousOccurredAt === occurredAt
          && previousQuality === record.quality
          // A rescan of a row imported before model tracking backfills its model.
          && (previousModel === model || model === '')
        ) return false
        // Never erase a known model with an unknown one from a partial re-read.
        const nextModel = model || previousModel

        this.statement(`
          UPDATE events
          SET session_id = ?, local_date = ?, project_id = ?, occurred_at = ?, received_at = ?,
              token_input = ?, token_output = ?, token_cache_read = ?, token_cache_write = ?,
              token_quality = ?, token_model = ?
          WHERE event_id = ?
        `).run(
          sessionId,
          localDate,
          projectId,
          occurredAt,
          safeReceivedAt,
          input,
          output,
          cacheRead,
          cacheWrite,
          record.quality,
          nextModel,
          existing.event_id,
        )
        this.updateModelStat(
          previousDate, previousProjectId, adapterId, previousModel,
          -previousInput, -previousOutput, -previousCacheRead, -previousCacheWrite,
        )
        this.updateModelStat(localDate, projectId, adapterId, nextModel, input, output, cacheRead, cacheWrite)
        this.updateSessionUsage(
          typeof existing.session_id === 'string' ? existing.session_id : null, previousModel, previousOccurredAt,
          -previousInput, -previousOutput, -previousCacheRead, -previousCacheWrite,
        )
        this.updateSessionUsage(sessionId, nextModel, occurredAt, input, output, cacheRead, cacheWrite)
        this.updateDailyStat(
          previousDate,
          safePet,
          previousProjectId,
          adapterId,
          null,
          0,
          -previousInput,
          -previousOutput,
          'none',
          -previousCacheRead,
          -previousCacheWrite,
        )
        this.updateDailyStat(
          localDate,
          safePet,
          projectId,
          adapterId,
          null,
          0,
          input,
          output,
          record.quality,
          cacheRead,
          cacheWrite,
        )
        return true
      }

      const inserted = changedCount(this.statement(`
        INSERT OR IGNORE INTO events(
          event_id, source_event_id, schema_version, type, trust, adapter_id, agent_id,
          session_id, project_id, pet_id, local_date, occurred_at, received_at, state,
          active_delta_ms, completion_kind, token_input, token_output, token_cache_read,
          token_cache_write, token_quality, token_model, payload_json
        ) VALUES (?, ?, 2, 'agent.token_usage', 'local_log', ?, ?, ?, ?, ?, ?, ?, ?, 'idle', 0, NULL, ?, ?, ?, ?, ?, ?, '{}')
      `).run(
        eventId,
        sourceEventId,
        adapterId,
        agentId,
        sessionId,
        projectId,
        safePet,
        localDate,
        occurredAt,
        safeReceivedAt,
        input,
        output,
        cacheRead,
        cacheWrite,
        record.quality,
        model,
      ))
      if (inserted === 0) return false
      this.updateModelStat(localDate, projectId, adapterId, model, input, output, cacheRead, cacheWrite)
      this.updateSessionUsage(sessionId, model, occurredAt, input, output, cacheRead, cacheWrite)
      this.updateDailyStat(
        localDate,
        safePet,
        projectId,
        adapterId,
        null,
        0,
        input,
        output,
        record.quality,
        cacheRead,
        cacheWrite,
      )
      return true
    })
  }

  recordQuotaSnapshot(value: unknown): boolean {
    const snapshot = normalizeQuotaSnapshot(value)
    if (!snapshot) return false
    // Identity is the readings alone: polling every two minutes must not write
    // (or broadcast historyUpdated) when nothing about the quota changed.
    const providersJson = JSON.stringify(snapshot.providers)
    const latest = parseQuotaSnapshot(this.statement(
      'SELECT payload_json FROM quota_snapshots ORDER BY updated_at DESC LIMIT 1',
    ).get()?.payload_json)
    if (latest && JSON.stringify(latest.providers) === providersJson) return false
    const snapshotId = digest(`${snapshot.updatedAt}:${providersJson}`)
    this.statement(`
      INSERT OR REPLACE INTO quota_snapshots(snapshot_id, updated_at, payload_json)
      VALUES (?, ?, ?)
    `).run(snapshotId, snapshot.updatedAt, JSON.stringify(snapshot))
    const oldest = new Date(this.now() - QUOTA_SNAPSHOT_RETENTION_MS).toISOString()
    this.statement('DELETE FROM quota_snapshots WHERE updated_at < ?').run(oldest)
    this.statement(`
      DELETE FROM quota_snapshots
      WHERE snapshot_id NOT IN (
        SELECT snapshot_id FROM quota_snapshots ORDER BY updated_at DESC LIMIT ?
      )
    `).run(MAX_QUOTA_SNAPSHOTS)
    return true
  }

  getSummary(petId = DEFAULT_PET_ID, projectId?: string, rangeDays: number = 7): HistorySummary {
    this.flushQueued()
    const safePet = safePetId(petId)
    const safeProject = isProjectId(projectId) ? projectId : null
    const span = HISTORY_RANGES.includes(rangeDays) ? rangeDays : 7
    const today = this.localDate(this.now())
    const dates = Array.from({ length: span }, (_, index) => dateOffset(today, index - (span - 1)))
    const previousDates = Array.from({ length: span }, (_, index) => dateOffset(today, index - (2 * span - 1)))
    // Local token-usage rows are always recorded under the shared
    // LOCAL_USAGE_PET_ID bucket (see recordTokenUsage), never under the
    // routed pet, so a project filter must still include that bucket -
    // scoped to the same project - or token totals would silently read
    // zero every time a project is selected.
    const projectClause = safeProject ? 'AND project_id = ?' : ''
    // One range scan over the previous + current window; the covering index
    // (pet_id, local_date, ...) serves it, and everything else is folded in JS.
    const rows = this.statement(`
      SELECT local_date, adapter_id, sessions_completed, sessions_failed, active_ms,
             token_input, token_output, token_cache_read, token_cache_write, token_quality
      FROM daily_stats
      WHERE pet_id IN (?, ?) ${projectClause} AND local_date BETWEEN ? AND ?
    `).all(
      ...(safeProject ? [safePet, LOCAL_USAGE_PET_ID, safeProject] : [safePet, LOCAL_USAGE_PET_ID]),
      previousDates[0],
      today,
    )
    // A day can have multiple aggregate rows (one per project and adapter).
    // Fold them before building the projection; keeping only the last row
    // would silently drop sessions and token usage from the HUD.
    const currentDates = new Set(dates)
    const previousSet = new Set(previousDates)
    const byDate = new Map<string, HistoryDailyStat>()
    const byAgent = new Map<string, HistoryDailyStat>()
    let previousTotals = emptyDaily('previous')
    for (const row of rows) {
      const date = String(row.local_date)
      const stat = dailyStat(date, row)
      if (previousSet.has(date)) {
        previousTotals = addDaily(previousTotals, stat)
        continue
      }
      if (!currentDates.has(date)) continue
      byDate.set(date, addDaily(byDate.get(date) ?? emptyDaily(date), stat))
      const adapterId = safeText(row.adapter_id, 'unknown')
      byAgent.set(adapterId, addDaily(byAgent.get(adapterId) ?? emptyDaily(adapterId), stat))
    }
    const days = dates.map(localDate => byDate.get(localDate) ?? emptyDaily(localDate))
    const totals = days.reduce((sum, day) => addDaily(sum, day), emptyDaily('total'))
    const agents: HistoryAgentStat[] = [...byAgent.entries()]
      .map(([adapterId, { localDate: _ignored, ...agent }]) => ({ adapterId, ...agent }))
      .sort((a, b) =>
        (b.tokenInput + b.tokenOutput) - (a.tokenInput + a.tokenOutput)
        || b.activeMs - a.activeMs
        || a.adapterId.localeCompare(b.adapterId))
    const quotaRow = this.statement(
      'SELECT payload_json FROM quota_snapshots ORDER BY updated_at DESC LIMIT 1',
    ).get()
    const quota = parseQuotaSnapshot(quotaRow?.payload_json)
    const models = this.modelStats(dates[0]!, today, safeProject)
    return {
      schemaVersion: 1,
      generatedAt: this.now(),
      petId: safePet,
      ...(safeProject ? { projectId: safeProject } : {}),
      retentionDays: this.retentionDays,
      rangeDays: span,
      localDate: today,
      days,
      totals,
      previousTotals: { ...previousTotals, localDate: 'previous' },
      agents,
      models,
      usageBlocks: this.getUsageBlocks(),
      tokenQuality: totals.tokenQuality,
      // Mirrors the cutoff LocalUsageReader.scanNow() actually applies, so
      // this always describes the window the numbers above really cover.
      tokenTrackingSince: Math.max(
        this.getLocalUsageCutoff(),
        this.now() - this.retentionDays * 24 * 60 * 60 * 1000,
      ),
      quota,
    }
  }

  /** PK range scan on (local_date, ...), folded per (adapter, model). */
  private modelStats(fromDate: string, toDate: string, projectId: string | null): HistoryModelStat[] {
    const rows = this.statement(`
      SELECT adapter_id, model,
             SUM(token_input) AS token_input, SUM(token_output) AS token_output,
             SUM(token_cache_read) AS token_cache_read, SUM(token_cache_write) AS token_cache_write
      FROM daily_model_stats
      WHERE local_date BETWEEN ? AND ? ${projectId ? 'AND project_id = ?' : ''}
      GROUP BY adapter_id, model
    `).all(...(projectId ? [fromDate, toDate, projectId] : [fromDate, toDate]))
    return rows
      .map(row => ({
        adapterId: safeText(row.adapter_id, 'unknown'),
        model: safeModelId(row.model),
        tokenInput: Math.max(0, asInteger(row.token_input)),
        tokenOutput: Math.max(0, asInteger(row.token_output)),
        tokenCacheRead: Math.max(0, asInteger(row.token_cache_read)),
        tokenCacheWrite: Math.max(0, asInteger(row.token_cache_write)),
      }))
      .filter(stat => stat.tokenInput + stat.tokenOutput + stat.tokenCacheRead + stat.tokenCacheWrite > 0)
      .sort((a, b) =>
        (b.tokenInput + b.tokenOutput) - (a.tokenInput + a.tokenOutput)
        || a.adapterId.localeCompare(b.adapterId)
        || a.model.localeCompare(b.model))
  }

  /**
   * Latest 5-hour block per agent from local-log rows of the last 24 hours.
   * Served by the partial index on token-usage occurred_at, so heartbeat rows
   * are never visited. Account-level: ignores pet and project filters.
   */
  getUsageBlocks(): HistoryUsageBlock[] {
    const now = this.now()
    const rows = this.statement(`
      SELECT adapter_id, occurred_at, token_input, token_output, token_cache_read, token_cache_write
      FROM events
      WHERE type = 'agent.token_usage' AND occurred_at >= ?
      ORDER BY occurred_at DESC
      LIMIT ?
    `).all(now - USAGE_BLOCK_LOOKBACK_MS, MAX_USAGE_BLOCK_ROWS)
    const entries: UsageBlockEntry[] = rows.map(row => ({
      adapterId: safeText(row.adapter_id, 'unknown'),
      occurredAt: asInteger(row.occurred_at),
      tokenInput: Math.max(0, asInteger(row.token_input)),
      tokenOutput: Math.max(0, asInteger(row.token_output)),
      tokenCacheRead: Math.max(0, asInteger(row.token_cache_read)),
      tokenCacheWrite: Math.max(0, asInteger(row.token_cache_write)),
    }))
    // Newest-first so the row cap drops the oldest rows; latestUsageBlocks re-sorts.
    // Only blocks that can still be current are useful to the Usage panel.
    return latestUsageBlocks(entries, this.timezoneOffsetMinutes).filter(block => now - block.lastActivityAt < USAGE_BLOCK_MS)
  }

  /**
   * One keyset page of past sessions for a pet, newest activity first. The
   * query is validated here as well as in IPC, so a direct caller cannot pass
   * an unbounded limit or a raw fragment. Token totals for the page come from
   * one IN (...) lookup on session_model_usage (no per-row query).
   */
  listSessions(petId = DEFAULT_PET_ID, input: unknown = {}): HistorySessionPage {
    this.flushQueued()
    const now = this.now()
    const query = normalizeSessionQuery(input, now)
    const matchedIds = this.searchSessionIds(query.search)
    if (matchedIds && matchedIds.length === 0) return { items: [], nextCursor: null }
    const { sql, params } = buildSessionListQuery(safePetId(petId), query, now, query.limit + 1, matchedIds ?? undefined)
    // The SQL text comes from a finite set of clause combinations, so the
    // statement cache stays bounded.
    const rows = this.statement(sql).all(...params)
    const hasMore = rows.length > query.limit
    const pageRows = hasMore ? rows.slice(0, query.limit) : rows
    const items = this.mapSessionRows(pageRows, now)
    const last = items.at(-1)
    return {
      items,
      nextCursor: hasMore && last ? { lastSeenAt: last.lastSeenAt, id: last.id } : null,
    }
  }

  /**
   * Sessions whose label / agent contain `search`, from the trigram index.
   * null means "filter with the ordered LIKE scan instead": no FTS5, a term
   * shorter than one trigram, or so many matches that walking the time index
   * finds a page sooner than sorting every match.
   */
  private searchSessionIds(search: string | undefined): string[] | null {
    if (!search || !this.sessionSearchIndexed || [...search].length < 3) return null
    const rows = this.statement('SELECT session_pk FROM session_search WHERE session_search MATCH ? LIMIT ?')
      .all(`"${search.replace(/"/g, '""')}"`, MAX_SEARCH_MATCHES + 1)
    return rows.length > MAX_SEARCH_MATCHES ? null : rows.map(row => String(row.session_pk))
  }

  /** One session's metadata plus its latest timeline entries (oldest first). */
  getSessionDetail(petId: string, sessionId: unknown): HistorySessionDetail | null {
    if (!isHistorySessionId(sessionId)) return null
    this.flushQueued()
    // Scoped like the list: a session of another pet is "not found".
    const row = this.statement(`SELECT ${SESSION_LIST_COLUMNS} FROM sessions WHERE session_pk = ? AND pet_id = ?`)
      .get(sessionId, safePetId(petId))
    if (!row) return null
    const [session] = this.mapSessionRows([row], this.now())
    // Newest-first on the (session_pk, seq) primary key, then reversed, so the
    // cap keeps the latest entries.
    const rows = this.statement(`
      SELECT seq, occurred_at, state, tool_name FROM session_timeline
      WHERE session_pk = ? ORDER BY seq DESC LIMIT ?
    `).all(sessionId, HISTORY_SESSION_TIMELINE_MAX)
    // seq starts at 0, so an oldest returned row past 0 means older entries
    // were trimmed (by the stored cap) or are beyond the read cap.
    const truncated = rows.length > 0 && asInteger(rows[rows.length - 1]!.seq) > 0
    const timeline: HistorySessionTimelineEntry[] = rows
      .reverse()
      .map(entry => {
        const state = String(entry.state) as AgentState
        const toolName = sanitizeToolName(entry.tool_name)
        return {
          occurredAt: Math.max(0, asInteger(entry.occurred_at)),
          state,
          ...(toolName ? { toolName } : {}),
        }
      })
    return { session: session!, timeline, truncated }
  }

  private mapSessionRows(rows: readonly SqliteRow[], now: number): HistorySessionListItem[] {
    const keys = [...new Set(rows.map(row => safeText(row.usage_key)).filter(Boolean))]
    const usage = keys.length > 0
      // One statement for any page size: the keys travel as one JSON parameter.
      ? foldSessionUsage(this.statement(`
          SELECT usage_key, model, token_input, token_output, token_cache_read, token_cache_write
          FROM session_model_usage WHERE usage_key IN (SELECT value FROM json_each(?))
        `).all(JSON.stringify(keys)))
      : new Map()
    return rows.map(row => mapSessionRow(row, usage.get(safeText(row.usage_key)), now))
  }

  private appendTimeline(sessionPk: string, seq: number, occurredAt: number, state: AgentState, toolName: string): void {
    this.statement(`
      INSERT OR REPLACE INTO session_timeline(session_pk, seq, occurred_at, state, tool_name)
      VALUES (?, ?, ?, ?, ?)
    `).run(sessionPk, seq, occurredAt, state, toolName)
    // Keep at most SESSION_TIMELINE_STORED_MAX rows per session: each append
    // past the cap drops exactly the oldest one, a primary-key point delete.
    if (seq >= SESSION_TIMELINE_STORED_MAX) {
      this.statement('DELETE FROM session_timeline WHERE session_pk = ? AND seq <= ?')
        .run(sessionPk, seq - SESSION_TIMELINE_STORED_MAX)
    }
  }

  /** Per-session (local-log usage key) model totals; batched like daily_model_stats. */
  private updateSessionUsage(
    usageKey: string | null,
    model: string,
    occurredAt: number,
    tokenInput: number,
    tokenOutput: number,
    tokenCacheRead: number,
    tokenCacheWrite: number,
  ): void {
    if (!usageKey) return
    if (tokenInput === 0 && tokenOutput === 0 && tokenCacheRead === 0 && tokenCacheWrite === 0) return
    if (this.sessionUsageBatch) {
      const key = `${usageKey}\u0000${model}`
      const entry = this.sessionUsageBatch.get(key) ?? {
        usageKey, model, lastAt: 0, tokenInput: 0, tokenOutput: 0, tokenCacheRead: 0, tokenCacheWrite: 0,
      }
      entry.lastAt = Math.max(entry.lastAt, occurredAt)
      entry.tokenInput += tokenInput
      entry.tokenOutput += tokenOutput
      entry.tokenCacheRead += tokenCacheRead
      entry.tokenCacheWrite += tokenCacheWrite
      this.sessionUsageBatch.set(key, entry)
      return
    }
    this.statement(`
      INSERT INTO session_model_usage(
        usage_key, model, last_at, token_input, token_output, token_cache_read, token_cache_write
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(usage_key, model) DO UPDATE SET
        last_at = MAX(last_at, excluded.last_at),
        token_input = MAX(0, token_input + ?),
        token_output = MAX(0, token_output + ?),
        token_cache_read = MAX(0, token_cache_read + ?),
        token_cache_write = MAX(0, token_cache_write + ?)
    `).run(
      usageKey, model, Math.max(0, occurredAt),
      Math.max(0, tokenInput), Math.max(0, tokenOutput), Math.max(0, tokenCacheRead), Math.max(0, tokenCacheWrite),
      tokenInput, tokenOutput, tokenCacheRead, tokenCacheWrite,
    )
  }

  private flushSessionUsageBatch(): void {
    const batch = this.sessionUsageBatch
    this.sessionUsageBatch = null
    if (!batch) return
    for (const entry of batch.values()) {
      this.updateSessionUsage(
        entry.usageKey, entry.model, entry.lastAt,
        entry.tokenInput, entry.tokenOutput, entry.tokenCacheRead, entry.tokenCacheWrite,
      )
    }
  }

  getExport(petId = DEFAULT_PET_ID, projectId?: string, rangeDays: number = 7, growth?: unknown): HistoryExport {
    const exportedAt = this.now()
    const span = HISTORY_RANGES.includes(rangeDays) ? rangeDays : 7
    const sessions = this.exportSessions(petId, projectId, exportedAt - span * 24 * 60 * 60 * 1000)
    return {
      schemaVersion: 1,
      exportedAt,
      summary: this.getSummary(petId, projectId, rangeDays),
      meta: {
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown',
        generatedAtLocal: `${this.localDate(exportedAt)} ${new Date(exportedAt).toTimeString().slice(0, 8)}`,
        tokenBasis: 'tokenInput = fresh input only; tokenCacheRead/tokenCacheWrite are prompt-cache tokens counted separately; tokenOutput = output',
        dayDefinition: 'A day is the local calendar date (in the time zone above) of the event time',
      },
      ...(growth === undefined ? {} : { growth }),
      sessions: sessions.items,
      sessionsTruncated: sessions.truncated,
    }
  }

  /**
   * Bounded keyset walk for the JSON export: at most MAX_EXPORT_SESSIONS rows.
   * The export never carried project names (only fingerprints), so the
   * workspace label is blanked here to keep that contract for shared files.
   */
  private exportSessions(petId: string, projectId: string | undefined, from: number): { items: HistorySessionListItem[]; truncated: boolean } {
    const items: HistorySessionListItem[] = []
    let cursor: HistorySessionQuery['cursor']
    for (;;) {
      const page = this.listSessions(petId, { projectId, from, limit: 50, cursor })
      for (const item of page.items) items.push({ ...item, projectLabel: '' })
      if (!page.nextCursor) return { items, truncated: false }
      if (items.length >= MAX_EXPORT_SESSIONS) return { items: items.slice(0, MAX_EXPORT_SESSIONS), truncated: true }
      cursor = page.nextCursor
    }
  }

  /** When achievements were last reconciled from history (0 = never). */
  getAchievementReconciledAt(): number {
    const value = Number(this.statement('SELECT value FROM history_metadata WHERE key = ?').get(ACHIEVEMENT_RECONCILED_KEY)?.value)
    return Number.isFinite(value) && value > 0 ? value : 0
  }

  setAchievementReconciledAt(timestamp: number): void {
    this.statement(`
      INSERT INTO history_metadata(key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(ACHIEVEMENT_RECONCILED_KEY, String(Math.max(0, Math.floor(timestamp))))
  }

  /**
   * Completed-session facts, optionally only those at/after `sinceMs`. A later
   * reconcile passes the previous marker so start-up no longer re-reads and
   * re-hashes the whole history; the achievement store de-duplicates by
   * session key, so overlap with already-recorded sessions is harmless.
   */
  getAchievementCompletedSessions(sinceMs = 0): AchievementCompletedSessionFact[] {
    this.flushQueued()
    const completed: AchievementCompletedSessionFact[] = []
    this.forEachCompletedSession(sinceMs, fact => { completed.push(fact) })
    return completed
  }

  /**
   * Streams first-success facts per session identity using keyset pages over the
   * partial (occurred_at, event_id) success index: bounded memory per page and no
   * silent truncation for very large histories.
   */
  private forEachCompletedSession(sinceMs: number, visit: (fact: AchievementCompletedSessionFact) => void): void {
    const seen = new Set<string>()
    const since = Math.max(0, Math.floor(sinceMs))
    let afterAt = -1
    let afterId = ''
    for (;;) {
      const rows = afterAt < 0
        ? this.statement(`
            SELECT event_id, adapter_id, agent_id, session_id, project_id, pet_id, occurred_at
            FROM events
            WHERE state = 'success' AND session_id IS NOT NULL AND occurred_at >= ?
            ORDER BY occurred_at ASC, event_id ASC
            LIMIT ?
          `).all(since, COMPLETED_SESSION_PAGE_ROWS)
        : this.statement(`
            SELECT event_id, adapter_id, agent_id, session_id, project_id, pet_id, occurred_at
            FROM events
            WHERE state = 'success' AND session_id IS NOT NULL AND (occurred_at, event_id) > (?, ?)
            ORDER BY occurred_at ASC, event_id ASC
            LIMIT ?
          `).all(afterAt, afterId, COMPLETED_SESSION_PAGE_ROWS)
      for (const row of rows) {
        const adapterId = safeText(row.adapter_id)
        const source = safeText(row.agent_id)
        const sessionId = safeText(row.session_id)
        const projectId = safeText(row.project_id)
        if (!adapterId || !source || !sessionId) continue
        const petId = safePetId(typeof row.pet_id === 'string' ? row.pet_id : undefined)
        const achievementProjectId = isProjectId(projectId) ? projectId : 'unbound'
        const identity = digest(`${petId}:${source}:${sessionId}:${achievementProjectId}`)
        if (seen.has(identity)) continue
        seen.add(identity)
        visit({
          petId,
          source,
          sessionId,
          ...(achievementProjectId !== 'unbound' ? { projectId: achievementProjectId } : {}),
          adapterId,
          completedAt: Math.max(0, asInteger(row.occurred_at)),
        })
      }
      if (rows.length < COMPLETED_SESSION_PAGE_ROWS) return
      const last = rows[rows.length - 1]!
      afterAt = asInteger(last.occurred_at)
      afterId = String(last.event_id)
    }
  }

  clear(): void {
    this.queuedEvents = []
    if (this.retryHandle) { clearTimeout(this.retryHandle); this.retryHandle = null }
    this.transaction(() => {
      this.database.exec('DELETE FROM events; DELETE FROM sessions; DELETE FROM daily_stats; DELETE FROM daily_model_stats; DELETE FROM quota_snapshots; DELETE FROM session_timeline; DELETE FROM session_model_usage;')
      if (this.sessionSearchIndexed) this.database.exec('DELETE FROM session_search')
      this.statement(`
        INSERT INTO history_metadata(key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(LOCAL_USAGE_CUTOFF_KEY, String(this.now()))
    })
  }

  prune(): number {
    return this.pruneEvents()
  }

  rebuildDailyStats(): void {
    this.transaction(() => {
      this.database.exec('DELETE FROM daily_stats; DELETE FROM daily_model_stats;')
      this.rebuildEventDailyStats()
      this.rebuildModelStats()
      this.rebuildSessionCompletions()
    })
  }

  /** Lightweight SQLite structural check; false means the file is damaged. */
  quickCheck(): boolean {
    const row = this.database.prepare('PRAGMA quick_check(1)').get() as Record<string, unknown> | undefined
    return !row || Object.values(row)[0] === 'ok'
  }

  close(): void {
    if (this.closed) return
    this.flushQueued()
    this.closed = true
    this.statements.clear()
    this.database.close()
  }

  /**
   * One bounded retention step: deletes at most `limit` expired rows from each of
   * events and sessions. `more` tells the caller to schedule another step.
   */
  pruneBatch(limit = PRUNE_BATCH_ROWS): { events: number, sessions: number, more: boolean } {
    this.flushQueued()
    const bounded = Math.max(1, Math.floor(limit))
    const cutoff = this.now() - this.retentionDays * 24 * 60 * 60 * 1000
    return this.transaction(() => {
      const events = changedCount(this.statement(`
        DELETE FROM events WHERE rowid IN (
          SELECT rowid FROM events WHERE occurred_at < ? LIMIT ?
        )
      `).run(cutoff, bounded))
      // Pick the exact expired set once (per pet, through the pet/last-seen
      // index), then delete the sessions, their timelines and search entries by
      // that set, so no batch boundary can leave orphan rows behind.
      const expired = this.expiredSessions(cutoff, bounded)
      let sessions = 0
      if (expired.length > 0) {
        const pks = JSON.stringify(expired.map(row => row.pk))
        this.statement('DELETE FROM session_timeline WHERE session_pk IN (SELECT value FROM json_each(?))').run(pks)
        if (this.sessionSearchIndexed) {
          this.statement('DELETE FROM session_search WHERE rowid IN (SELECT value FROM json_each(?))')
            .run(JSON.stringify(expired.map(row => row.rowid)))
        }
        sessions = changedCount(this.statement('DELETE FROM sessions WHERE session_pk IN (SELECT value FROM json_each(?))').run(pks))
      }
      const sessionUsage = changedCount(this.statement(`
        DELETE FROM session_model_usage WHERE rowid IN (
          SELECT rowid FROM session_model_usage WHERE last_at < ? LIMIT ?
        )
      `).run(cutoff, bounded))
      return { events, sessions, more: events >= bounded || sessions >= bounded || sessionUsage >= bounded }
    })
  }

  /**
   * Up to `limit` sessions last seen before `cutoff`, oldest first per pet.
   * Pets are walked with MIN(pet_id) > ? seeks on the (pet_id, last_seen_at)
   * index, so retention needs no separate last_seen_at index on the hot table.
   */
  private expiredSessions(cutoff: number, limit: number): Array<{ pk: string, rowid: number }> {
    const expired: Array<{ pk: string, rowid: number }> = []
    let pet = this.statement('SELECT MIN(pet_id) AS pet FROM sessions').get()?.pet
    while (typeof pet === 'string' && expired.length < limit) {
      const rows = this.statement(`
        SELECT rowid AS session_rowid, session_pk FROM sessions INDEXED BY idx_history_sessions_pet_seen
        WHERE pet_id = ? AND last_seen_at < ? ORDER BY last_seen_at, session_pk LIMIT ?
      `).all(pet, cutoff, limit - expired.length)
      for (const row of rows) expired.push({ pk: String(row.session_pk), rowid: asInteger(row.session_rowid) })
      pet = this.statement('SELECT MIN(pet_id) AS pet FROM sessions WHERE pet_id > ?').get(pet)?.pet
    }
    return expired
  }

  /** Keeps the FTS5 search row of one session in step with its label. */
  private indexSessionSearch(rowid: number, sessionPk: string, label: string, agentId: string, adapterId: string, replace: boolean): void {
    if (!this.sessionSearchIndexed || rowid <= 0) return
    if (replace) this.statement('DELETE FROM session_search WHERE rowid = ?').run(rowid)
    this.statement('INSERT INTO session_search(rowid, session_pk, text) VALUES (?, ?, ?)')
      .run(rowid, sessionPk, sessionSearchText(label, agentId, adapterId))
  }

  /** Runtime retention: bounded batches with the event loop yielded in between. */
  async pruneInBatches(
    limit = PRUNE_BATCH_ROWS,
    yieldToEventLoop: () => Promise<void> = () => new Promise(resolve => { setImmediate(resolve) }),
  ): Promise<{ events: number, sessions: number }> {
    let events = 0
    let sessions = 0
    for (;;) {
      if (this.closed) break
      const step = this.pruneBatch(limit)
      events += step.events
      sessions += step.sessions
      if (!step.more) break
      await yieldToEventLoop()
    }
    return { events, sessions }
  }

  private pruneEvents(): number {
    const cutoff = this.now() - this.retentionDays * 24 * 60 * 60 * 1000
    return changedCount(this.statement('DELETE FROM events WHERE occurred_at < ?').run(cutoff))
  }

  private updateDailyStat(
    localDate: string,
    petId: string,
    projectId: string,
    adapterId: string,
    completionKind: 'success' | 'error' | null,
    activeMs: number,
    tokenInput: number,
    tokenOutput: number,
    tokenQuality: HistoryTokenQuality,
    tokenCacheRead = 0,
    tokenCacheWrite = 0,
  ): void {
    const completed = completionKind === 'success' ? 1 : 0
    const failed = completionKind === 'error' ? 1 : 0
    // A heartbeat that adds nothing must not rewrite the row (and its indexes).
    if (
      completed === 0 && failed === 0 && activeMs === 0 && tokenInput === 0 && tokenOutput === 0
      && tokenCacheRead === 0 && tokenCacheWrite === 0 && tokenQuality === 'none'
    ) return
    if (this.dailyBatch && completed === 0 && failed === 0) {
      const key = `${localDate}\u0000${petId}\u0000${projectId}\u0000${adapterId}`
      const entry = this.dailyBatch.get(key) ?? {
        localDate, petId, projectId, adapterId, activeMs: 0, tokenInput: 0, tokenOutput: 0,
        tokenCacheRead: 0, tokenCacheWrite: 0, tokenQuality: 'none' as HistoryTokenQuality,
      }
      entry.activeMs += activeMs
      entry.tokenInput += tokenInput
      entry.tokenOutput += tokenOutput
      entry.tokenCacheRead += tokenCacheRead
      entry.tokenCacheWrite += tokenCacheWrite
      entry.tokenQuality = mergeTokenQuality(entry.tokenQuality, tokenQuality)
      this.dailyBatch.set(key, entry)
      return
    }
    // One additive upsert instead of SELECT + UPSERT. The insert branch clamps
    // negative corrections to 0 and the update branch applies the raw delta
    // with the same MAX(0, ...) floor the read-modify-write version used.
    this.statement(`
      INSERT INTO daily_stats(
        local_date, pet_id, project_id, adapter_id, sessions_completed, sessions_failed,
        active_ms, token_input, token_output, token_cache_read, token_cache_write, token_quality
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(local_date, pet_id, project_id, adapter_id) DO UPDATE SET
        sessions_completed = MAX(0, sessions_completed + ?),
        sessions_failed = MAX(0, sessions_failed + ?),
        active_ms = MAX(0, active_ms + ?),
        token_input = MAX(0, token_input + ?),
        token_output = MAX(0, token_output + ?),
        token_cache_read = MAX(0, token_cache_read + ?),
        token_cache_write = MAX(0, token_cache_write + ?),
        token_quality = CASE
          WHEN token_quality = 'exact' OR excluded.token_quality = 'exact' THEN 'exact'
          WHEN token_quality = 'estimated' OR excluded.token_quality = 'estimated' THEN 'estimated'
          ELSE 'none' END
    `).run(
      localDate,
      petId,
      projectId,
      adapterId,
      completed,
      failed,
      Math.max(0, activeMs),
      Math.max(0, tokenInput),
      Math.max(0, tokenOutput),
      Math.max(0, tokenCacheRead),
      Math.max(0, tokenCacheWrite),
      tokenQuality,
      completed,
      failed,
      activeMs,
      tokenInput,
      tokenOutput,
      tokenCacheRead,
      tokenCacheWrite,
    )
  }

  private migrate(): void {
    this.pragmas = applyWalPragmas(this.database)
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL,
        checksum TEXT NOT NULL
      );
    `)
    const hasV1 = Boolean(this.statement('SELECT version FROM schema_migrations WHERE version = 1').get())
    if (!hasV1) this.transaction(() => {
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS events (
          event_id TEXT PRIMARY KEY,
          source_event_id TEXT,
          schema_version INTEGER NOT NULL,
          type TEXT NOT NULL,
          trust TEXT NOT NULL,
          adapter_id TEXT NOT NULL,
          agent_id TEXT NOT NULL,
          session_id TEXT,
          project_id TEXT NOT NULL DEFAULT '',
          pet_id TEXT NOT NULL,
          local_date TEXT NOT NULL,
          occurred_at INTEGER NOT NULL,
          received_at INTEGER NOT NULL,
          state TEXT NOT NULL,
          active_delta_ms INTEGER NOT NULL DEFAULT 0,
          completion_kind TEXT,
          token_input INTEGER,
          token_output INTEGER,
          token_quality TEXT NOT NULL DEFAULT 'none',
          payload_json TEXT NOT NULL,
          UNIQUE(adapter_id, source_event_id)
        );
        CREATE INDEX IF NOT EXISTS idx_history_events_occurred ON events(occurred_at);
        CREATE TABLE IF NOT EXISTS sessions (
          session_pk TEXT PRIMARY KEY,
          adapter_id TEXT NOT NULL,
          agent_id TEXT NOT NULL,
          external_session_id TEXT NOT NULL,
          project_id TEXT NOT NULL DEFAULT '',
          pet_id TEXT NOT NULL,
          started_at INTEGER NOT NULL,
          ended_at INTEGER,
          terminal_state TEXT,
          active_ms INTEGER NOT NULL DEFAULT 0,
          token_input INTEGER NOT NULL DEFAULT 0,
          token_output INTEGER NOT NULL DEFAULT 0,
          token_quality TEXT NOT NULL DEFAULT 'none',
          last_state TEXT NOT NULL,
          last_seen_at INTEGER NOT NULL,
          UNIQUE(adapter_id, external_session_id)
        );
        CREATE TABLE IF NOT EXISTS daily_stats (
          local_date TEXT NOT NULL,
          pet_id TEXT NOT NULL,
          project_id TEXT NOT NULL DEFAULT '',
          adapter_id TEXT NOT NULL,
          sessions_completed INTEGER NOT NULL DEFAULT 0,
          sessions_failed INTEGER NOT NULL DEFAULT 0,
          active_ms INTEGER NOT NULL DEFAULT 0,
          token_input INTEGER NOT NULL DEFAULT 0,
          token_output INTEGER NOT NULL DEFAULT 0,
          token_quality TEXT NOT NULL DEFAULT 'none',
          PRIMARY KEY(local_date, pet_id, project_id, adapter_id)
        );
        CREATE TABLE IF NOT EXISTS quota_snapshots (
          snapshot_id TEXT PRIMARY KEY,
          updated_at TEXT NOT NULL,
          payload_json TEXT NOT NULL
        );
      `)
      this.statement(`
        INSERT INTO schema_migrations(version, name, applied_at, checksum)
        VALUES (1, 'history-v1', ?, 'history-v1')
      `).run(this.now())
    })
    // v3/v4 rebuild aggregates through the current writer, which already knows
    // the v6 cache columns, so make sure they exist before any later step.
    this.ensureCacheColumns()
    const hasV2 = Boolean(this.statement('SELECT version FROM schema_migrations WHERE version = 2').get())
    if (!hasV2) this.transaction(() => {
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS history_metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `)
      this.statement(`
        INSERT INTO history_metadata(key, value) VALUES (?, ?)
        ON CONFLICT(key) DO NOTHING
      `).run(LOCAL_USAGE_CUTOFF_KEY, '0')
      this.statement(`
        INSERT INTO schema_migrations(version, name, applied_at, checksum)
        VALUES (2, 'history-local-usage-cutoff', ?, 'history-local-usage-cutoff')
      `).run(this.now())
    })
    const hasV3 = Boolean(this.statement('SELECT version FROM schema_migrations WHERE version = 3').get())
    if (!hasV3) this.transaction(() => {
      // v2 stored local log rows under the selected/default pet. Move only
      // local-usage events and rebuild aggregates so existing totals remain
      // visible after users switch pets.
      this.database.exec(`
        UPDATE events SET pet_id = '${LOCAL_USAGE_PET_ID}' WHERE type = 'agent.token_usage';
        DELETE FROM daily_stats;
      `)
      this.rebuildEventDailyStats()
      this.statement(`
        INSERT INTO schema_migrations(version, name, applied_at, checksum)
        VALUES (3, 'history-global-local-usage', ?, 'history-global-local-usage')
      `).run(this.now())
    })
    const hasV4 = Boolean(this.statement('SELECT version FROM schema_migrations WHERE version = 4').get())
    if (!hasV4) this.transaction(() => {
      this.database.exec(`
        CREATE INDEX IF NOT EXISTS idx_history_events_success_identity
          ON events(agent_id, session_id, project_id, pet_id) WHERE state = 'success';
        CREATE INDEX IF NOT EXISTS idx_history_events_success_time
          ON events(occurred_at, event_id) WHERE state = 'success';
      `)
      this.repairSuccessfulSessionOutcomes()
      this.database.exec(`
        UPDATE daily_stats SET sessions_completed = 0, sessions_failed = 0;
      `)
      this.rebuildSessionCompletions()
      this.statement(`
        INSERT INTO schema_migrations(version, name, applied_at, checksum)
        VALUES (4, 'history-unique-terminal-sessions', ?, 'history-unique-terminal-sessions')
      `).run(this.now())
    })
    const hasV5 = Boolean(this.statement('SELECT version FROM schema_migrations WHERE version = 5').get())
    if (!hasV5) this.transaction(() => {
      this.database.exec(`
        CREATE INDEX IF NOT EXISTS idx_daily_stats_summary_cover
          ON daily_stats(
            pet_id, local_date, project_id, adapter_id,
            sessions_completed, sessions_failed, active_ms, token_input, token_output, token_quality
          );
      `)
      this.statement(`
        INSERT INTO schema_migrations(version, name, applied_at, checksum)
        VALUES (5, 'history-daily-summary-covering-index', ?, 'history-daily-summary-covering-index')
      `).run(this.now())
    })
    const hasV6 = Boolean(this.statement('SELECT version FROM schema_migrations WHERE version = 6').get())
    if (!hasV6) this.transaction(() => {
      // Split prompt-cache tokens out of fresh input. Rows imported earlier
      // folded cache reads into input, so they are downgraded from exact to
      // estimated; the next local-log scan re-imports them with the split and
      // restores exact quality (recordTokenUsage updates in place).
      this.ensureCacheColumns()
      this.database.exec(`
        UPDATE events SET token_quality = 'estimated'
          WHERE type = 'agent.token_usage' AND token_quality = 'exact';
        DROP INDEX IF EXISTS idx_daily_stats_summary_cover;
        CREATE INDEX IF NOT EXISTS idx_history_events_success_time
          ON events(occurred_at, event_id) WHERE state = 'success';
        DELETE FROM daily_stats;
      `)
      this.rebuildEventDailyStats()
      this.rebuildSessionCompletions()
      this.statement(`
        INSERT INTO schema_migrations(version, name, applied_at, checksum)
        VALUES (6, 'history-token-cache-split', ?, 'history-token-cache-split')
      `).run(this.now())
    })
    const hasV7 = Boolean(this.statement('SELECT version FROM schema_migrations WHERE version = 7').get())
    if (!hasV7) this.transaction(() => {
      // Write-amplification fix: success lookups use partial indexes, so the
      // thousands of heartbeat rows per session never maintain them, and the
      // daily_stats covering index (rewritten on every active_ms change) is
      // replaced by a narrow (pet_id, local_date) index.
      this.database.exec(`
        DROP INDEX IF EXISTS idx_history_events_completion_identity;
        CREATE INDEX IF NOT EXISTS idx_history_events_success_identity
          ON events(agent_id, session_id, project_id, pet_id) WHERE state = 'success';
        CREATE INDEX IF NOT EXISTS idx_history_events_success_time
          ON events(occurred_at, event_id) WHERE state = 'success';
        DROP INDEX IF EXISTS idx_daily_stats_summary_cover;
        CREATE INDEX IF NOT EXISTS idx_daily_stats_pet_date ON daily_stats(pet_id, local_date);
        CREATE INDEX IF NOT EXISTS idx_history_sessions_last_seen ON sessions(last_seen_at);
      `)
      this.statement(`
        INSERT INTO schema_migrations(version, name, applied_at, checksum)
        VALUES (7, 'history-partial-success-indexes', ?, 'history-partial-success-indexes')
      `).run(this.now())
    })
    // ensureModelSchema is idempotent on its own (column/table/index checks), so
    // a database whose v8 marker was lost, or a half-applied copy, still heals.
    const modelTableExisted = Boolean(this.database.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'daily_model_stats'",
    ).get())
    this.ensureModelSchema()
    const hasV8 = Boolean(this.statement('SELECT version FROM schema_migrations WHERE version = 8').get())
    // The v8 marker alone does not prove the aggregate is populated: a table
    // that was missing (just recreated) or is empty while local-usage rows
    // exist is rebuilt here. Both probes are LIMIT 1 index lookups.
    if (hasV8 && (
      !modelTableExisted
      || (
        !this.statement('SELECT 1 FROM daily_model_stats LIMIT 1').get()
        && this.statement("SELECT 1 FROM events WHERE type = 'agent.token_usage' AND occurred_at >= 0 LIMIT 1").get()
      )
    )) this.transaction(() => {
      this.database.exec('DELETE FROM daily_model_stats')
      this.rebuildModelStats()
    })
    if (!hasV8) this.transaction(() => {
      // Additive: per-model token totals for local-log usage. Existing rows
      // keep an empty model ("unknown") until the next scan re-reads their log
      // line, at which point applyTokenUsage backfills the model in place.
      this.database.exec('DELETE FROM daily_model_stats')
      this.rebuildModelStats()
      this.statement(`
        INSERT INTO schema_migrations(version, name, applied_at, checksum)
        VALUES (8, 'history-token-model-breakdown', ?, 'history-token-model-breakdown')
      `).run(this.now())
    })
    this.ensureSessionTimelineSchema()
    const hasV9 = Boolean(this.statement('SELECT version FROM schema_migrations WHERE version = 9').get())
    if (!hasV9) this.transaction(() => {
      // Additive session browser: outcome, local-log join key and per-session
      // model totals for sessions recorded before v9. Their tool / permission
      // counters and timelines cannot be reconstructed (heartbeats were rolled
      // up), so they keep timeline_tracked = 0 and the UI shows them as unknown.
      this.database.exec(`
        UPDATE sessions SET final_state = CASE
          WHEN last_state IN ('thinking', 'tool-running', 'waiting-permission', 'waiting-input') THEN 'open'
          WHEN last_state IN ('success', 'error') THEN last_state
          WHEN last_state = 'offline' THEN 'cancelled'
          WHEN terminal_state IN ('success', 'error') THEN terminal_state
          ELSE 'open' END;
        DELETE FROM session_model_usage;
      `)
      this.backfillSessionUsageKeys()
      this.statement(`
        INSERT INTO session_model_usage(
          usage_key, model, last_at, token_input, token_output, token_cache_read, token_cache_write
        )
        SELECT session_id, token_model, MAX(occurred_at),
               SUM(MAX(0, COALESCE(token_input, 0))),
               SUM(MAX(0, COALESCE(token_output, 0))),
               SUM(MAX(0, COALESCE(token_cache_read, 0))),
               SUM(MAX(0, COALESCE(token_cache_write, 0)))
        FROM events
        WHERE type = 'agent.token_usage' AND session_id IS NOT NULL AND session_id != ''
        GROUP BY session_id, token_model
      `).run()
      this.statement(`
        INSERT INTO schema_migrations(version, name, applied_at, checksum)
        VALUES (9, 'history-session-timeline', ?, 'history-session-timeline')
      `).run(this.now())
    })
  }

  /** Idempotent: columns, tables and indexes for the session list and timelines. */
  private ensureSessionTimelineSchema(): void {
    const columns = new Set(
      this.database.prepare('PRAGMA table_info(sessions)').all().map(row => String(row.name)),
    )
    const additions: Array<[string, string]> = [
      ['project_label', "TEXT NOT NULL DEFAULT ''"],
      ['usage_key', "TEXT NOT NULL DEFAULT ''"],
      ['final_state', "TEXT NOT NULL DEFAULT 'open'"],
      ['last_tool', "TEXT NOT NULL DEFAULT ''"],
      ['tool_runs', 'INTEGER NOT NULL DEFAULT 0'],
      ['permission_waits', 'INTEGER NOT NULL DEFAULT 0'],
      ['permission_wait_ms', 'INTEGER NOT NULL DEFAULT 0'],
      ['state_since', 'INTEGER NOT NULL DEFAULT 0'],
      ['timeline_tracked', 'INTEGER NOT NULL DEFAULT 0'],
      ['timeline_count', 'INTEGER NOT NULL DEFAULT 0'],
    ]
    for (const [column, definition] of additions) {
      if (!columns.has(column)) this.database.exec(`ALTER TABLE sessions ADD COLUMN ${column} ${definition}`)
    }
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS session_timeline (
        session_pk TEXT NOT NULL,
        seq INTEGER NOT NULL,
        occurred_at INTEGER NOT NULL,
        state TEXT NOT NULL,
        tool_name TEXT NOT NULL DEFAULT '',
        PRIMARY KEY(session_pk, seq)
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS session_model_usage (
        usage_key TEXT NOT NULL,
        model TEXT NOT NULL DEFAULT '',
        last_at INTEGER NOT NULL DEFAULT 0,
        token_input INTEGER NOT NULL DEFAULT 0,
        token_output INTEGER NOT NULL DEFAULT 0,
        token_cache_read INTEGER NOT NULL DEFAULT 0,
        token_cache_write INTEGER NOT NULL DEFAULT 0,
        UNIQUE(usage_key, model)
      );
      CREATE INDEX IF NOT EXISTS idx_session_model_usage_last_at ON session_model_usage(last_at);
      CREATE INDEX IF NOT EXISTS idx_history_sessions_pet_seen
        ON sessions(pet_id, last_seen_at, session_pk);
      CREATE INDEX IF NOT EXISTS idx_history_sessions_pet_project_seen
        ON sessions(pet_id, project_id, last_seen_at, session_pk);
      DROP INDEX IF EXISTS idx_history_sessions_pet_final_seen;
      DROP INDEX IF EXISTS idx_history_sessions_last_seen;
    `)
    this.ensureSessionSearchIndex()
  }

  /**
   * FTS5 trigram index over "label, agent, adapter" so substring search reads
   * only matching sessions. Rowids mirror sessions.rowid. Built from sessions
   * whenever the table is (re)created; optional when FTS5 is missing.
   */
  private ensureSessionSearchIndex(): void {
    const existed = Boolean(this.database.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'session_search'",
    ).get())
    try {
      this.database.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS session_search USING fts5(
          session_pk UNINDEXED, text, tokenize = 'trigram'
        )
      `)
    } catch {
      this.sessionSearchIndexed = false
      return
    }
    this.sessionSearchIndexed = true
    if (!existed) {
      this.database.exec(`
        INSERT INTO session_search(rowid, session_pk, text)
        SELECT rowid, session_pk, project_label || char(10) || agent_id || char(10) || adapter_id FROM sessions
      `)
    }
  }

  /**
   * Sessions store only a hash of the external id, but their event rows keep
   * it, so one pass over the distinct hook identities derives each session's
   * local-log join key. Runs once (v9); new sessions get the key on insert.
   */
  private backfillSessionUsageKeys(): void {
    const update = this.statement("UPDATE sessions SET usage_key = ? WHERE session_pk = ? AND usage_key = ''")
    const rows = this.statement(`
      SELECT DISTINCT adapter_id, agent_id, session_id, project_id FROM events
      WHERE type != 'agent.token_usage' AND session_id IS NOT NULL AND session_id != ''
    `).all()
    for (const row of rows) {
      const adapterId = safeText(row.adapter_id)
      const externalId = typeof row.session_id === 'string' ? row.session_id : ''
      const source = localUsageKeySource(adapterId, externalId)
      if (!source) continue
      update.run(digest(source), historySessionPk(adapterId, safeText(row.agent_id), externalId, safeText(row.project_id)))
    }
  }

  private ensureModelSchema(): void {
    const columns = new Set(
      this.database.prepare('PRAGMA table_info(events)').all().map(row => String(row.name)),
    )
    if (!columns.has('token_model')) {
      this.database.exec("ALTER TABLE events ADD COLUMN token_model TEXT NOT NULL DEFAULT ''")
    }
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS daily_model_stats (
        local_date TEXT NOT NULL,
        project_id TEXT NOT NULL DEFAULT '',
        adapter_id TEXT NOT NULL,
        model TEXT NOT NULL DEFAULT '',
        token_input INTEGER NOT NULL DEFAULT 0,
        token_output INTEGER NOT NULL DEFAULT 0,
        token_cache_read INTEGER NOT NULL DEFAULT 0,
        token_cache_write INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(local_date, project_id, adapter_id, model)
      );
      CREATE INDEX IF NOT EXISTS idx_history_events_token_time
        ON events(occurred_at) WHERE type = 'agent.token_usage';
    `)
  }

  /** Set-based rebuild of daily_model_stats from local-usage event rows. */
  private rebuildModelStats(): void {
    this.statement(`
      INSERT INTO daily_model_stats(
        local_date, project_id, adapter_id, model, token_input, token_output, token_cache_read, token_cache_write
      )
      SELECT local_date, project_id, adapter_id, token_model,
             SUM(MAX(0, COALESCE(token_input, 0))),
             SUM(MAX(0, COALESCE(token_output, 0))),
             SUM(MAX(0, COALESCE(token_cache_read, 0))),
             SUM(MAX(0, COALESCE(token_cache_write, 0)))
      FROM events
      WHERE type = 'agent.token_usage' AND pet_id = '${LOCAL_USAGE_PET_ID}'
      GROUP BY local_date, project_id, adapter_id, token_model
      ON CONFLICT(local_date, project_id, adapter_id, model) DO UPDATE SET
        token_input = token_input + excluded.token_input,
        token_output = token_output + excluded.token_output,
        token_cache_read = token_cache_read + excluded.token_cache_read,
        token_cache_write = token_cache_write + excluded.token_cache_write
    `).run()
  }

  private ensureCacheColumns(): void {
    for (const table of ['events', 'daily_stats']) {
      const columns = new Set(
        this.database.prepare(`PRAGMA table_info(${table})`).all().map(row => String(row.name)),
      )
      for (const column of ['token_cache_read', 'token_cache_write']) {
        if (!columns.has(column)) {
          this.database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`)
        }
      }
    }
  }

  /**
   * Rebuilds the event-derived daily_stats columns with one set-based statement:
   * SQLite folds the events (O(E) scan, no per-row JS round trip, no E-sized
   * array in memory) and only the aggregated rows are written. Sums commute, so
   * no ORDER BY is needed. ON CONFLICT keeps it additive if two raw keys
   * normalise to the same dimension tuple.
   */
  private rebuildEventDailyStats(): void {
    this.statement(`
      INSERT INTO daily_stats(
        local_date, pet_id, project_id, adapter_id, sessions_completed, sessions_failed,
        active_ms, token_input, token_output, token_cache_read, token_cache_write, token_quality
      )
      SELECT local_date, pet_id, project_id, COALESCE(NULLIF(adapter_id, ''), 'unknown'), 0, 0,
             SUM(MAX(0, active_delta_ms)),
             SUM(MAX(0, COALESCE(token_input, 0))),
             SUM(MAX(0, COALESCE(token_output, 0))),
             SUM(MAX(0, COALESCE(token_cache_read, 0))),
             SUM(MAX(0, COALESCE(token_cache_write, 0))),
             CASE WHEN SUM(token_quality = 'exact') > 0 THEN 'exact'
                  WHEN SUM(token_quality = 'estimated') > 0 THEN 'estimated'
                  ELSE 'none' END
      FROM events
      WHERE 1
      GROUP BY local_date, pet_id, project_id, COALESCE(NULLIF(adapter_id, ''), 'unknown')
      ON CONFLICT(local_date, pet_id, project_id, adapter_id) DO UPDATE SET
        active_ms = active_ms + excluded.active_ms,
        token_input = token_input + excluded.token_input,
        token_output = token_output + excluded.token_output,
        token_cache_read = token_cache_read + excluded.token_cache_read,
        token_cache_write = token_cache_write + excluded.token_cache_write,
        token_quality = CASE
          WHEN token_quality = 'exact' OR excluded.token_quality = 'exact' THEN 'exact'
          WHEN token_quality = 'estimated' OR excluded.token_quality = 'estimated' THEN 'estimated'
          ELSE 'none' END
    `).run()
  }

  private repairSuccessfulSessionOutcomes(): void {
    for (const fact of this.getAchievementCompletedSessions()) {
      const projectId = fact.projectId ?? ''
      this.statement(`
        UPDATE sessions
        SET ended_at = ?, terminal_state = 'success', pet_id = ?
        WHERE session_pk = ?
      `).run(
        fact.completedAt,
        fact.petId,
        historySessionPk(fact.adapterId, fact.source, fact.sessionId, projectId),
      )
    }
  }

  private adjustDailyCompletion(
    localDate: string,
    petId: string,
    projectId: string,
    adapterId: string,
    completedDelta: number,
    failedDelta: number,
  ): void {
    this.statement(`
      UPDATE daily_stats
      SET sessions_completed = MAX(0, sessions_completed + ?),
          sessions_failed = MAX(0, sessions_failed + ?)
      WHERE local_date = ? AND pet_id = ? AND project_id = ? AND adapter_id = ?
    `).run(completedDelta, failedDelta, localDate, petId, projectId, adapterId)
  }

  private rebuildSessionCompletions(): void {
    // Count first, write once per (date, pet, project, adapter) key.
    const counts = new Map<string, { localDate: string, petId: string, projectId: string, adapterId: string, completed: number, failed: number }>()
    const add = (localDate: string, petId: string, projectId: string, adapterId: string, kind: 'success' | 'error'): void => {
      const key = `${localDate}\u0000${petId}\u0000${projectId}\u0000${adapterId}`
      let entry = counts.get(key)
      if (!entry) {
        entry = { localDate, petId, projectId, adapterId, completed: 0, failed: 0 }
        counts.set(key, entry)
      }
      if (kind === 'success') entry.completed += 1
      else entry.failed += 1
    }
    this.forEachCompletedSession(0, fact => {
      add(this.localDate(fact.completedAt), fact.petId, fact.projectId ?? '', fact.adapterId, 'success')
    })
    const rows = this.statement(`
      SELECT pet_id, project_id, adapter_id, ended_at
      FROM sessions
      WHERE ended_at IS NOT NULL AND terminal_state = 'error'
    `).all()
    for (const row of rows) {
      add(
        this.localDate(Math.max(0, asInteger(row.ended_at))),
        safePetId(typeof row.pet_id === 'string' ? row.pet_id : undefined),
        safeText(row.project_id),
        safeText(row.adapter_id, 'unknown'),
        'error',
      )
    }
    const upsert = this.statement(`
      INSERT INTO daily_stats(
        local_date, pet_id, project_id, adapter_id, sessions_completed, sessions_failed,
        active_ms, token_input, token_output, token_cache_read, token_cache_write, token_quality
      ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 'none')
      ON CONFLICT(local_date, pet_id, project_id, adapter_id) DO UPDATE SET
        sessions_completed = sessions_completed + excluded.sessions_completed,
        sessions_failed = sessions_failed + excluded.sessions_failed
    `)
    for (const entry of counts.values()) {
      upsert.run(entry.localDate, entry.petId, entry.projectId, entry.adapterId, entry.completed, entry.failed)
    }
  }

  // 將多筆寫入合併成單一交易（例如本機 usage 掃描一次匯入上千筆），避免每筆
  // 紀錄各自 BEGIN/COMMIT 造成的 WAL fsync 開銷。
  batch<T>(work: () => T): T {
    return this.transaction(work)
  }

  /**
   * Runs `work` inside a SAVEPOINT so one failing item cannot poison the rest of
   * an enclosing batch transaction. Outside a transaction it behaves like one.
   */
  private isolated<T>(work: () => T): T {
    if (this.transactionDepth === 0) return this.transaction(work)
    const name = `sp_${this.transactionDepth}`
    this.database.exec(`SAVEPOINT ${name}`)
    this.transactionDepth += 1
    try {
      const result = work()
      this.database.exec(`RELEASE ${name}`)
      return result
    } catch (error) {
      try { this.database.exec(`ROLLBACK TO ${name}; RELEASE ${name}`) } catch {}
      throw error
    } finally {
      this.transactionDepth -= 1
    }
  }

  /**
   * Micro-batched write path for the hook-event hot path: events that arrive in
   * the same turn of the event loop share one transaction (one commit) instead
   * of one commit each. `onRecorded` runs once per flush if anything was new.
   */
  queueEvent(event: AgentStatusEvent, petId = DEFAULT_PET_ID, onRecorded?: () => void): void {
    if (this.closed) return
    this.queuedEvents.push({ event, petId, receivedAt: this.now(), onRecorded })
    if (this.queuedEvents.length >= MAX_QUEUED_EVENTS) { this.flushQueued(); return }
    if (this.flushHandle) return
    this.flushHandle = setImmediate(() => { this.flushHandle = null; this.flushQueued() })
  }

  /** Writes every queued event in one transaction. Returns how many were new. */
  flushQueued(): number {
    if (this.flushHandle) { clearImmediate(this.flushHandle); this.flushHandle = null }
    if (this.retryHandle) { clearTimeout(this.retryHandle); this.retryHandle = null }
    if (this.queuedEvents.length === 0 || this.closed) return 0
    const queued = this.queuedEvents
    this.queuedEvents = []
    const callbacks = new Set<() => void>()
    let recorded = 0
    try {
      this.transaction(() => {
        for (const item of queued) {
          try {
            if (this.isolated(() => this.recordEvent(item.event, item.petId, item.receivedAt))) {
              recorded += 1
              if (item.onRecorded) callbacks.add(item.onRecorded)
            }
          } catch (error) {
            console.error('History event handling failed', error)
          }
        }
      })
    } catch (error) {
      console.error('History batch commit failed', error)
      this.requeueFailedBatch(queued)
      return 0
    }
    this.flushFailures = 0
    for (const callback of callbacks) {
      try { callback() } catch {}
    }
    return recorded
  }

  /**
   * A failed batch commit (busy / locked / disk full) rolled everything back, so
   * the swapped-out events go back to the FRONT of the queue and a backoff retry
   * is scheduled. The queue stays bounded: oldest heartbeats are shed first and
   * terminal / token / identified events are only dropped if nothing else is left.
   */
  private requeueFailedBatch(failed: HistoryQueuedEvent[]): void {
    eventPipelineStats.historyFlushFailures += 1
    eventPipelineStats.historyRequeuedEvents += failed.length
    this.queuedEvents = trimQueuedEvents([...failed, ...this.queuedEvents], MAX_QUEUED_EVENTS)
    this.flushFailures += 1
    if (this.closed || this.retryHandle) return
    const delay = Math.min(FLUSH_RETRY_MAX_MS, FLUSH_RETRY_BASE_MS * 2 ** Math.min(this.flushFailures - 1, 8))
    this.retryHandle = setTimeout(() => { this.retryHandle = null; this.flushQueued() }, delay)
    this.retryHandle.unref?.()
  }

  private statement(sql: string): SqliteStatement {
    return this.statements.get(sql)
  }

  // 可重入：外層已開啟交易時，內層直接併入外層，失敗由最外層統一 ROLLBACK。
  private transaction<T>(work: () => T): T {
    if (this.transactionDepth > 0) {
      this.transactionDepth += 1
      try {
        return work()
      } finally {
        this.transactionDepth -= 1
      }
    }
    this.database.exec('BEGIN IMMEDIATE')
    this.transactionDepth = 1
    try {
      const result = work()
      this.database.exec('COMMIT')
      return result
    } catch (error) {
      try { this.database.exec('ROLLBACK') } catch {}
      throw error
    } finally {
      this.transactionDepth = 0
    }
  }
}

function emptyDaily(localDate: string): HistoryDailyStat {
  return {
    localDate,
    sessionsCompleted: 0,
    sessionsFailed: 0,
    activeMs: 0,
    tokenInput: 0,
    tokenOutput: 0,
    tokenCacheRead: 0,
    tokenCacheWrite: 0,
    tokenQuality: 'none',
  }
}

function dailyStat(localDate: string, row?: SqliteRow): HistoryDailyStat {
  return {
    localDate,
    sessionsCompleted: Math.max(0, asInteger(row?.sessions_completed)),
    sessionsFailed: Math.max(0, asInteger(row?.sessions_failed)),
    activeMs: Math.max(0, asInteger(row?.active_ms)),
    tokenInput: Math.max(0, asInteger(row?.token_input)),
    tokenOutput: Math.max(0, asInteger(row?.token_output)),
    tokenCacheRead: Math.max(0, asInteger(row?.token_cache_read)),
    tokenCacheWrite: Math.max(0, asInteger(row?.token_cache_write)),
    tokenQuality: isTokenQuality(row?.token_quality) ? row!.token_quality as HistoryTokenQuality : 'none',
  }
}

function addDaily(left: HistoryDailyStat, right: HistoryDailyStat): HistoryDailyStat {
  return {
    localDate: left.localDate,
    sessionsCompleted: left.sessionsCompleted + right.sessionsCompleted,
    sessionsFailed: left.sessionsFailed + right.sessionsFailed,
    activeMs: left.activeMs + right.activeMs,
    tokenInput: left.tokenInput + right.tokenInput,
    tokenOutput: left.tokenOutput + right.tokenOutput,
    tokenCacheRead: left.tokenCacheRead + right.tokenCacheRead,
    tokenCacheWrite: left.tokenCacheWrite + right.tokenCacheWrite,
    tokenQuality: mergeTokenQuality(left.tokenQuality, right.tokenQuality),
  }
}

function normalizeQuotaSnapshot(value: unknown): HistoryQuotaSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (typeof raw.updatedAt !== 'string' || !Number.isFinite(Date.parse(raw.updatedAt))) return null
  if (!Array.isArray(raw.providers)) return null
  const providers: HistoryQuotaProvider[] = []
  for (const item of raw.providers.slice(0, MAX_QUOTA_PROVIDERS)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const provider = item as Record<string, unknown>
    const id = safeText(provider.id)
    const name = safeText(provider.name)
    if (!id || !name || !Array.isArray(provider.windows)) continue
    const windows: HistoryQuotaWindow[] = []
    // Windows kept after a failed refresh are stale readings; never persist
    // them as if they were measured at this snapshot's time.
    const retained = provider.stale === true ? [] : provider.windows
    for (const entry of retained.slice(0, MAX_QUOTA_WINDOWS)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
      const window = entry as Record<string, unknown>
      const windowId = safeText(window.id)
      const label = safeText(window.label)
      const remaining = Number(window.remainingPercent)
      if (!windowId || !label || !Number.isFinite(remaining)) continue
      // Clamp instead of dropping so one out-of-range reading cannot erase a
      // provider's whole window list from the stored snapshot.
      const remainingClamped = Math.min(100, Math.max(0, remaining))
      const resetsAt = typeof window.resetsAt === 'string' && Number.isFinite(Date.parse(window.resetsAt))
        ? new Date(window.resetsAt).toISOString()
        : undefined
      windows.push({ id: windowId, label, remainingPercent: remainingClamped, ...(resetsAt ? { resetsAt } : {}) })
    }
    providers.push({
      id,
      name,
      ...(typeof provider.plan === 'string' && provider.plan.trim() ? { plan: safeText(provider.plan) } : {}),
      windows,
    })
  }
  return { updatedAt: new Date(raw.updatedAt).toISOString(), providers }
}

function parseQuotaSnapshot(value: unknown): HistoryQuotaSnapshot | null {
  if (typeof value !== 'string') return null
  try { return normalizeQuotaSnapshot(JSON.parse(value)) } catch { return null }
}
