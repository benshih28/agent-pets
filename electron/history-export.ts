import type { HistoryDailyStat, HistoryExportFormat } from '../src/types/history.ts'

const CSV_HEADER = [
  'date',
  'sessions_completed',
  'sessions_failed',
  'active_minutes',
  'tokens_input_fresh',
  'tokens_output',
  'tokens_cache_read',
  'tokens_cache_write',
]

/** One row per local day; numbers only, so there is nothing to escape or inject. */
export function historyDaysToCsv(days: readonly HistoryDailyStat[]): string {
  const rows = days.map(day => [
    day.localDate,
    day.sessionsCompleted,
    day.sessionsFailed,
    Math.round(day.activeMs / 60_000),
    day.tokenInput,
    day.tokenOutput,
    day.tokenCacheRead,
    day.tokenCacheWrite,
  ].join(','))
  return `${[CSV_HEADER.join(','), ...rows].join('\n')}\n`
}

/** Local-date based, safe-characters-only file name including range and project. */
export function historyExportFileName(
  format: HistoryExportFormat,
  rangeDays: number,
  localDate: string,
  projectId?: string,
): string {
  const project = projectId && /^[a-f0-9]{32}$/.test(projectId) ? `-${projectId.slice(0, 8)}` : ''
  return `agent-pets-history-${rangeDays}d${project}-${localDate}.${format}`
}
