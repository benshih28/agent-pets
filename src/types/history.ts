import type { AgentState } from '@/types/agent'

export type HistoryTokenQuality = 'none' | 'estimated' | 'exact'

export interface HistoryTokenUsageRecord {
  adapterId: string
  agentId: string
  sessionId?: string
  sourceEventId: string
  occurredAt: number
  /** Fresh (non-cached) input tokens. */
  input?: number
  output?: number
  /** Prompt-cache tokens read; kept apart so they never inflate fresh input. */
  cacheRead?: number
  /** Prompt-cache tokens written (cache creation). */
  cacheWrite?: number
  quality: Exclude<HistoryTokenQuality, 'none'>
  /** Canonical project fingerprint from ProjectRoutingStore; never a raw path. */
  projectId?: string
  /** Sanitized model id reported by the local log (e.g. `claude-sonnet-4-5`); absent when unknown. */
  model?: string
}

export interface HistoryDailyStat {
  localDate: string
  sessionsCompleted: number
  sessionsFailed: number
  activeMs: number
  tokenInput: number
  tokenOutput: number
  /** Cached prompt tokens read; 0 for rows imported before the split existed. */
  tokenCacheRead: number
  tokenCacheWrite: number
  tokenQuality: HistoryTokenQuality
}

export interface HistoryAgentStat {
  adapterId: string
  sessionsCompleted: number
  sessionsFailed: number
  activeMs: number
  tokenInput: number
  tokenOutput: number
  /** Cached prompt tokens read; 0 for rows imported before the split existed. */
  tokenCacheRead: number
  tokenCacheWrite: number
  tokenQuality: HistoryTokenQuality
}

/** Token totals for one model of one agent over the summary range (local logs only). */
export interface HistoryModelStat {
  adapterId: string
  /** Empty string when the log did not name a model (or predates model tracking). */
  model: string
  tokenInput: number
  tokenOutput: number
  tokenCacheRead: number
  tokenCacheWrite: number
}

/**
 * The latest 5-hour usage block of one agent, computed from local log records
 * (see src/utils/usage-blocks.ts for the rule). Times are epoch milliseconds.
 */
export interface HistoryUsageBlock {
  adapterId: string
  startAt: number
  endAt: number
  firstActivityAt: number
  lastActivityAt: number
  tokenInput: number
  tokenOutput: number
  tokenCacheRead: number
  tokenCacheWrite: number
  records: number
}

export interface HistoryQuotaWindow {
  id: string
  label: string
  remainingPercent: number
  resetsAt?: string
}

export interface HistoryQuotaProvider {
  id: string
  name: string
  plan?: string
  windows: HistoryQuotaWindow[]
}

export interface HistoryQuotaSnapshot {
  updatedAt: string
  providers: HistoryQuotaProvider[]
}

export interface HistorySummary {
  schemaVersion: 1
  generatedAt: number
  petId: string
  projectId?: string
  retentionDays: number
  /** Number of days in `days` (7, 30 or 90). */
  rangeDays: number
  /** Today's local date, so the UI never infers it from the last bar. */
  localDate: string
  days: HistoryDailyStat[]
  totals: HistoryDailyStat
  /** The equally long period right before `days`, for delta display. */
  previousTotals: HistoryDailyStat
  agents: HistoryAgentStat[]
  /** Per-model token totals for the current range; only local-log usage carries a model. */
  models: HistoryModelStat[]
  /** Latest 5-hour block per agent from local logs, independent of the project filter. */
  usageBlocks: HistoryUsageBlock[]
  tokenQuality: HistoryTokenQuality
  // The effective start of local token counting: max(last "Clear History",
  // now - retentionDays). Counts before this point were never scanned, so
  // the UI needs it to tell the user what window the totals actually cover.
  tokenTrackingSince: number
  quota: HistoryQuotaSnapshot | null
  /** Diagnostics of the last local log scan (attached by the main process). */
  scan?: HistoryScanDiagnostics
}

export const HISTORY_RANGE_OPTIONS = [7, 30, 90] as const
export type HistoryRangeDays = (typeof HISTORY_RANGE_OPTIONS)[number]

export interface HistoryScanDiagnostics {
  finishedAt: number
  durationMs: number
  filesScanned: number
  filesSkipped: number
  /** Files (or the rest of files) left for the next scan because the scan budget ran out. */
  filesDeferred?: number
}

export interface HistoryExport {
  schemaVersion: 1
  exportedAt: number
  summary: HistorySummary
  /** Reading guide for whoever opens the file later. */
  meta?: {
    timezone: string
    generatedAtLocal: string
    tokenBasis: string
    dayDefinition: string
  }
  /** Growth snapshot (XP/level/streak and unlocked achievements), when available. */
  growth?: unknown
  /** Past sessions of the export range (metadata only, project labels blanked), newest first and bounded. */
  sessions?: HistorySessionListItem[]
  /** True when more sessions matched than the export carries. */
  sessionsTruncated?: boolean
}

export type HistoryExportFormat = 'json' | 'csv'

export interface HistoryExportRequest {
  format: HistoryExportFormat
  rangeDays: number
  projectId?: string
}

export type HistoryCommandResult =
  | { ok: true; path?: string }
  | { ok: false; error: 'unavailable' | 'cancelled' | 'write_failed' }

export type HistoryClearResult =
  | { ok: true }
  | { ok: false; error: 'unavailable' }

export const HISTORY_TERMINAL_STATES = new Set<AgentState>(['success', 'error', 'offline'])

/**
 * How a past session ended. `active` / `incomplete` are derived at read time
 * from a still-open session: recent activity versus none for a while.
 */
export const HISTORY_SESSION_OUTCOMES = ['success', 'error', 'cancelled', 'active', 'incomplete'] as const
export type HistorySessionOutcome = (typeof HISTORY_SESSION_OUTCOMES)[number]

/** Page size bounds for the session list; the main process clamps to these. */
export const HISTORY_SESSION_PAGE_DEFAULT = 30
export const HISTORY_SESSION_PAGE_MAX = 50
/** Most recent timeline entries returned for one session. */
export const HISTORY_SESSION_TIMELINE_MAX = 500
export const HISTORY_SESSION_SEARCH_MAX = 64

/** Keyset cursor: the (lastSeenAt, id) of the last row of the previous page. */
export interface HistorySessionCursor {
  lastSeenAt: number
  id: string
}

export interface HistorySessionQuery {
  projectId?: string
  adapterId?: string
  /** Inclusive epoch-ms bounds on the session's last activity. */
  from?: number
  to?: number
  outcome?: HistorySessionOutcome
  /** Case-insensitive substring over the project name and the agent only. */
  search?: string
  limit?: number
  cursor?: HistorySessionCursor
}

/**
 * One past session, metadata only: no prompts, transcript text, tool
 * arguments or absolute paths ever reach this shape.
 */
export interface HistorySessionListItem {
  /** Opaque, stable id (adapter, agent and a hash); never the raw session id. */
  id: string
  adapterId: string
  agentId: string
  /** Canonical project fingerprint; '' when the session had no project. */
  projectId: string
  /** Last path segment the agent reported for its workspace; '' when unknown. */
  projectLabel: string
  startedAt: number
  /** When the session first reached its terminal state; null while open. */
  endedAt: number | null
  lastSeenAt: number
  /** lastSeenAt - startedAt. */
  durationMs: number
  activeMs: number
  outcome: HistorySessionOutcome
  /** False for sessions recorded before timelines existed: counts below are unknown. */
  tracked: boolean
  toolRuns: number
  permissionWaits: number
  permissionWaitMs: number
  tokenInput: number
  tokenOutput: number
  tokenCacheRead: number
  tokenCacheWrite: number
  /** 'local' = matched local-log usage, 'hook' = totals the hook reported, 'none' = no tokens. */
  tokenSource: 'local' | 'hook' | 'none'
  /** Model with the most fresh input + output tokens; '' when unknown. */
  topModel: string
}

export interface HistorySessionPage {
  items: HistorySessionListItem[]
  /** Pass back as `cursor` for the next page; null on the last page. */
  nextCursor: HistorySessionCursor | null
}

export interface HistorySessionTimelineEntry {
  occurredAt: number
  state: AgentState
  /** Tool name only (for tool-running); never its arguments. */
  toolName?: string
}

export interface HistorySessionDetail {
  session: HistorySessionListItem
  /** Oldest first; at most HISTORY_SESSION_TIMELINE_MAX entries. */
  timeline: HistorySessionTimelineEntry[]
  /** True when older entries exist than the ones returned. */
  truncated: boolean
}
