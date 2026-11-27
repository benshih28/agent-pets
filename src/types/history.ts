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

export interface HistoryModelStat {
  adapterId: string
  /** Empty string when the log did not name a model (or predates model tracking). */
  model: string
  tokenInput: number
  tokenOutput: number
  tokenCacheRead: number
  tokenCacheWrite: number
}

/** Rule in src/utils/usage-blocks.ts; times are epoch milliseconds. */
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
  rangeDays: number
  /** Today's local date, so the UI never infers it from the last bar. */
  localDate: string
  days: HistoryDailyStat[]
  totals: HistoryDailyStat
  previousTotals: HistoryDailyStat
  agents: HistoryAgentStat[]
  /** Only local-log usage carries a model. */
  models: HistoryModelStat[]
  /** Latest 5-hour block per agent from local logs, independent of the project filter. */
  usageBlocks: HistoryUsageBlock[]
  tokenQuality: HistoryTokenQuality
  // max(last "Clear History", now - retentionDays); earlier usage was never scanned.
  tokenTrackingSince: number
  quota: HistoryQuotaSnapshot | null
  /** Attached by the main process. */
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
  meta?: {
    timezone: string
    generatedAtLocal: string
    tokenBasis: string
    dayDefinition: string
  }
  growth?: unknown
  /** Past sessions of the export range (metadata only, project labels blanked), newest first and bounded. */
  sessions?: HistorySessionListItem[]
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

/** `active` / `incomplete` are derived at read time from a still-open session. */
export const HISTORY_SESSION_OUTCOMES = ['success', 'error', 'cancelled', 'active', 'incomplete'] as const
export type HistorySessionOutcome = (typeof HISTORY_SESSION_OUTCOMES)[number]

/** Page size bounds for the session list; the main process clamps to these. */
export const HISTORY_SESSION_PAGE_DEFAULT = 30
export const HISTORY_SESSION_PAGE_MAX = 50
export const HISTORY_SESSION_TIMELINE_MAX = 500
export const HISTORY_SESSION_SEARCH_MAX = 64

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

/** Metadata only: no prompts, transcript text, tool arguments or absolute paths. */
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
  truncated: boolean
}
