// Locale-aware formatting (DS-18)
// One place for date/number/duration formatting so every view agrees. All
// helpers take an explicit locale (default: the current UI locale) so they
// are testable without the reactive i18n state.
import { locale } from '../i18n.ts'

type Stamp = number | Date

const toDate = (value: Stamp): Date => (value instanceof Date ? value : new Date(value))
const currentLocale = (): string => locale.value

export function formatDateTime(value: Stamp, loc: string = currentLocale()): string {
  return toDate(value).toLocaleString(loc, { dateStyle: 'short', timeStyle: 'short' })
}

export function formatDate(value: Stamp, loc: string = currentLocale()): string {
  return toDate(value).toLocaleDateString(loc, { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export function formatTime(value: Stamp, loc: string = currentLocale()): string {
  return toDate(value).toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' })
}

/** Default time style (e.g. "2:05:09 PM"), for per-event timestamps. */
export function formatTimeFull(value: Stamp, loc: string = currentLocale()): string {
  return toDate(value).toLocaleTimeString(loc)
}

/** Locale default date + time (hover titles). */
export function formatDateTimeFull(value: Stamp, loc: string = currentLocale()): string {
  return toDate(value).toLocaleString(loc)
}

/** Locale default date (no time). */
export function formatDateDefault(value: Stamp, loc: string = currentLocale()): string {
  return toDate(value).toLocaleDateString(loc)
}

/** Date/time with caller-chosen Intl options (month/day only, weekday, seconds, ...). */
export function formatDateParts(value: Stamp, options: Intl.DateTimeFormatOptions, loc: string = currentLocale()): string {
  return toDate(value).toLocaleString(loc, options)
}

export function formatNumber(value: number, loc: string = currentLocale(), options?: Intl.NumberFormatOptions): string {
  return value.toLocaleString(loc, options)
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1],
]

const relativeFormatCache = new Map<string, Intl.RelativeTimeFormat>()

/** "5 minutes ago" / "in 2 hours" via Intl.RelativeTimeFormat. */
export function formatRelative(value: Stamp, now: Stamp = Date.now(), loc: string = currentLocale()): string {
  const diffSeconds = Math.round((toDate(value).getTime() - toDate(now).getTime()) / 1000)
  const abs = Math.abs(diffSeconds)
  let rtf = relativeFormatCache.get(loc)
  if (!rtf) {
    rtf = new Intl.RelativeTimeFormat(loc, { numeric: 'auto' })
    relativeFormatCache.set(loc, rtf)
  }
  for (const [unit, size] of RELATIVE_UNITS) {
    if (abs >= size || unit === 'second') return rtf.format(Math.trunc(diffSeconds / size), unit)
  }
  return rtf.format(0, 'second')
}

/** Compact duration such as "1h 05m" / "4m 12s" / "8s" (locale-neutral units). */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`
  return `${s}s`
}
