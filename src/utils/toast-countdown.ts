export const APP_NOTIFICATION_DURATION_MS = 3_000

export type ToastSurfaceKind = 'success' | 'error' | 'waiting' | 'permission-notice' | 'activity'

export interface ToastCountdown {
  readonly startedAt: number
  readonly expiresAt: number
  readonly durationMs: number
}

export function createToastCountdown(
  kind: ToastSurfaceKind,
  startedAt: number,
  durationMs = APP_NOTIFICATION_DURATION_MS,
): ToastCountdown | null {
  if (kind !== 'success' && kind !== 'error' && kind !== 'waiting') return null

  const normalizedStart = Number.isFinite(startedAt) ? startedAt : 0
  const normalizedDuration = Number.isFinite(durationMs) && durationMs > 0
    ? Math.round(durationMs)
    : APP_NOTIFICATION_DURATION_MS

  return Object.freeze({
    startedAt: normalizedStart,
    expiresAt: normalizedStart + normalizedDuration,
    durationMs: normalizedDuration,
  })
}

export function getToastRemainingMs(countdown: ToastCountdown, now: number): number {
  if (!Number.isFinite(now)) return countdown.durationMs
  return Math.max(0, Math.min(countdown.durationMs, countdown.expiresAt - now))
}
