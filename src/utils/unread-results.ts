export interface UnreadResults {
  count: number
  hasError: boolean
}

export const UNREAD_RESULTS_MAX = 99

/** Results ignored while markers are off, so turning them back on never shows a stale number or error flag. */
export function noteUnread(current: UnreadResults, tone: 'success' | 'error', markersEnabled: boolean, userAway: boolean): UnreadResults {
  if (!markersEnabled || !userAway) return current
  return {
    count: Math.min(UNREAD_RESULTS_MAX, current.count + 1),
    hasError: current.hasError || tone === 'error',
  }
}
