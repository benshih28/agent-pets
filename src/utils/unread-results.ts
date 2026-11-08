// 你不在時完成／失敗的結果計數（寵物旁的「✓ N」/「⚠ N」標記）。
export interface UnreadResults {
  count: number
  hasError: boolean
}

export const UNREAD_RESULTS_MAX = 99

/**
 * The next count after a result. Markers that are switched off do not count,
 * so turning them back on never shows a stale number or error flag; nor does
 * a result the user was there to see.
 */
export function noteUnread(current: UnreadResults, tone: 'success' | 'error', markersEnabled: boolean, userAway: boolean): UnreadResults {
  if (!markersEnabled || !userAway) return current
  return {
    count: Math.min(UNREAD_RESULTS_MAX, current.count + 1),
    hasError: current.hasError || tone === 'error',
  }
}
