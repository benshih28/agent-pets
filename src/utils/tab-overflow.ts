export interface ScrollMetrics {
  scrollLeft: number
  clientWidth: number
  scrollWidth: number
}

export interface TabRect {
  left: number
  width: number
}

const EPSILON = 1

export function overflowState(metrics: ScrollMetrics): { overflowing: boolean; start: boolean; end: boolean } {
  const max = Math.max(0, metrics.scrollWidth - metrics.clientWidth)
  const overflowing = max > EPSILON
  return {
    overflowing,
    start: overflowing && metrics.scrollLeft > EPSILON,
    end: overflowing && metrics.scrollLeft < max - EPSILON,
  }
}

/** `tab.left` is relative to the scroll content origin. */
export function scrollLeftToReveal(
  metrics: Pick<ScrollMetrics, 'scrollLeft' | 'clientWidth' | 'scrollWidth'>,
  tab: TabRect,
  padding = 0,
): number {
  const max = Math.max(0, metrics.scrollWidth - metrics.clientWidth)
  const visibleStart = metrics.scrollLeft + padding
  const visibleEnd = metrics.scrollLeft + metrics.clientWidth - padding
  let next = metrics.scrollLeft
  if (tab.left < visibleStart) next = tab.left - padding
  else if (tab.left + tab.width > visibleEnd) next = tab.left + tab.width - metrics.clientWidth + padding
  return Math.min(max, Math.max(0, Math.round(next)))
}

export function pageScrollDelta(clientWidth: number, direction: -1 | 1): number {
  return direction * Math.max(1, Math.round(clientWidth * 0.75))
}

/** Trackpads already send deltaX (native scrolling handles it); a mouse wheel only sends deltaY, which is redirected. */
export function wheelScrollDelta(
  event: { deltaX: number; deltaY: number; shiftKey?: boolean },
  overflowing: boolean,
): number | null {
  if (!overflowing) return null
  if (event.deltaX !== 0 && Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return null
  if (event.deltaY === 0) return null
  return event.deltaY
}
