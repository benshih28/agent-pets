export const LOCAL_USAGE_TICK_MS = 60_000
/** On battery the scan runs every Nth tick (about five minutes) to avoid waking the disk. */
export const LOCAL_USAGE_BATTERY_TICK_DIVISOR = 5

export function shouldRunLocalUsageTick(tick: number, onBattery: boolean): boolean {
  if (!onBattery) return true
  return tick % LOCAL_USAGE_BATTERY_TICK_DIVISOR === 0
}

export const LOCAL_USAGE_CATCH_UP_DELAY_MS = 3_000
export const LOCAL_USAGE_MAX_STALLED_CATCH_UPS = 2

// On battery a budget-limited scan waits for the regular tick so a large first import never keeps the disk awake.
export function localUsageCatchUpDelayMs(pending: boolean, onBattery: boolean, stalledScans = 0): number | null {
  if (!pending || onBattery) return null
  // A pending scan that read no bytes made no progress; never spin on it.
  if (stalledScans >= LOCAL_USAGE_MAX_STALLED_CATCH_UPS) return null
  return LOCAL_USAGE_CATCH_UP_DELAY_MS
}
