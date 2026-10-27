export const PLUGIN_SCHEDULE_MIN_SECONDS = 30
export const PLUGIN_SCHEDULE_MAX_SECONDS = 3_600
export const PLUGIN_SCHEDULE_MAX_REQUEST_SECONDS = Math.floor(2_147_483_647 / 1_000)

export function effectivePluginScheduleMinimum(manifestMinimum: unknown, preferenceMinimum: unknown): number {
  if (!isValidInterval(manifestMinimum) || !isValidInterval(preferenceMinimum)) throw codedError('schedule_invalid')
  return Math.max(manifestMinimum, preferenceMinimum)
}

export function effectivePluginScheduleInterval(requestedSeconds: unknown, minimumSeconds: unknown): number {
  if (typeof requestedSeconds !== 'number' || !Number.isFinite(requestedSeconds) || requestedSeconds <= 0
    || requestedSeconds > PLUGIN_SCHEDULE_MAX_REQUEST_SECONDS || !isValidInterval(minimumSeconds)) {
    throw codedError('schedule_invalid')
  }
  return Math.max(minimumSeconds, Math.ceil(requestedSeconds))
}

function isValidInterval(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
    && value >= PLUGIN_SCHEDULE_MIN_SECONDS && value <= PLUGIN_SCHEDULE_MAX_SECONDS
}

function codedError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code })
}
