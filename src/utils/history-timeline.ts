import { isAgentState } from '../types/agent.ts'
import { HISTORY_TERMINAL_STATES, type HistorySessionTimelineEntry } from '../types/history.ts'

export type TimelineOrder = 'asc' | 'desc'

export interface TimelineRow extends HistorySessionTimelineEntry {
  key: string
  /** 持續到下一筆（依時間順序）；最後一筆若是結束狀態則為 null。 */
  spanMs: number | null
}

/**
 * 持續時間一律依時間順序算（每筆到下一筆，最後一筆到 endAt），再決定顯示順序。
 * entries 本來就是由舊到新，所以倒序只要反轉一次，不需要排序；key 取自時間順序的索引，翻轉順序時保持穩定。
 */
export function buildTimelineRows(
  entries: readonly HistorySessionTimelineEntry[],
  endAt: number,
  order: TimelineOrder,
): TimelineRow[] {
  const last = entries.length - 1
  const rows = entries.map((entry, index): TimelineRow => ({
    ...entry,
    key: `${index}-${entry.occurredAt}`,
    spanMs: index === last && isAgentState(entry.state) && HISTORY_TERMINAL_STATES.has(entry.state)
      ? null
      : Math.max(0, (entries[index + 1]?.occurredAt ?? endAt) - entry.occurredAt),
  }))
  return order === 'desc' ? rows.reverse() : rows
}
