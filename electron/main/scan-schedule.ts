export const LOCAL_USAGE_TICK_MS = 60_000
/** On battery the scan runs every Nth tick (about five minutes) to avoid waking the disk. */
export const LOCAL_USAGE_BATTERY_TICK_DIVISOR = 5

/** Returns whether the scan should run on this 1-based tick of the base interval. */
export function shouldRunLocalUsageTick(tick: number, onBattery: boolean): boolean {
  if (!onBattery) return true
  return tick % LOCAL_USAGE_BATTERY_TICK_DIVISOR === 0
}

/** Delay before a follow-up scan when the last one ran out of budget mid-way. */
export const LOCAL_USAGE_CATCH_UP_DELAY_MS = 3_000
/** Consecutive catch-up scans that read nothing before catch-up stops until the next regular tick. */
export const LOCAL_USAGE_MAX_STALLED_CATCH_UPS = 2

/**
 * A scan that stopped on its byte or time budget leaves work for the next one.
 * On AC it continues after a short pause (each scan yields to the event loop
 * and is itself bounded); on battery it waits for the regular tick instead so
 * a large first import never keeps the disk awake.
 */
export function localUsageCatchUpDelayMs(pending: boolean, onBattery: boolean, stalledScans = 0): number | null {
  if (!pending || onBattery) return null
  // A pending scan that read no bytes made no progress; never spin on it.
  if (stalledScans >= LOCAL_USAGE_MAX_STALLED_CATCH_UPS) return null
  return LOCAL_USAGE_CATCH_UP_DELAY_MS
}
