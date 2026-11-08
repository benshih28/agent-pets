// Pure quota helpers shared by the Usage tab and the Sessions quota strip.
// Kept free of i18n so they can be unit-tested directly under node.

export type QuotaTone = 'healthy' | 'warn' | 'critical'

export type ResetCountdown =
  | { kind: 'unavailable' }
  | { kind: 'soon' }
  | { kind: 'minutes'; minutes: number }
  | { kind: 'hours'; hours: number; minutes: number }
  | { kind: 'days'; days: number; hours: number }

// Healthy above 30% remaining, warning from 10-30%, critical below 10%.
export function quotaTone(remainingPercent: number): QuotaTone {
  if (!Number.isFinite(remainingPercent)) return 'healthy'
  if (remainingPercent < 10) return 'critical'
  if (remainingPercent <= 30) return 'warn'
  return 'healthy'
}

// Rounds the remaining time UP so "59.6 minutes" never reads as "1 hour 0
// minutes" a minute early and a live reading never shows "now" while seconds
// remain; anything under a minute is "soon".
export function resetCountdown(resetIso: string | undefined, nowMs: number): ResetCountdown {
  if (!resetIso) return { kind: 'unavailable' }
  const reset = Date.parse(resetIso)
  if (!Number.isFinite(reset)) return { kind: 'unavailable' }
  const remainingMs = reset - nowMs
  if (remainingMs < 60_000) return { kind: 'soon' }
  const totalMinutes = Math.ceil(remainingMs / 60_000)
  if (totalMinutes < 60) return { kind: 'minutes', minutes: totalMinutes }
  const hours = Math.floor(totalMinutes / 60)
  if (hours < 24) return { kind: 'hours', hours, minutes: totalMinutes % 60 }
  return { kind: 'days', days: Math.floor(hours / 24), hours: hours % 24 }
}

export type QuotaFreshness = 'fresh' | 'stale'

export const QUOTA_STALE_AFTER_MS = 5 * 60_000

export function quotaFreshness(fetchedAtMs: number | null | undefined, nowMs: number): QuotaFreshness {
  if (!fetchedAtMs || !Number.isFinite(fetchedAtMs)) return 'stale'
  return nowMs - fetchedAtMs > QUOTA_STALE_AFTER_MS ? 'stale' : 'fresh'
}

// "3 minutes ago" style bucket for a past instant.
export type RelativeAge =
  | { kind: 'now' }
  | { kind: 'minutes'; minutes: number }
  | { kind: 'hours'; hours: number }
  | { kind: 'days'; days: number }

export function relativeAge(pastMs: number, nowMs: number): RelativeAge {
  const diff = Math.max(0, nowMs - pastMs)
  if (diff < 60_000) return { kind: 'now' }
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return { kind: 'minutes', minutes }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return { kind: 'hours', hours }
  return { kind: 'days', days: Math.floor(hours / 24) }
}
