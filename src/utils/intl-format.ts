// Node 測試會直接載入這個檔案，所以 import 用相對路徑加 `.ts`。
import { locale } from '../i18n.ts'

type Stamp = number | Date

const toDate = (value: Stamp): Date => (value instanceof Date ? value : new Date(value))
const toTime = (value: Stamp): number => toDate(value).getTime()
const currentLocale = (): string => locale.value

// `toLocale*String()` 每次呼叫都會重建 formatter，所以一律用依「語系＋選項」快取的版本。
function cachedFormatter<F>(cache: Map<string, F>, loc: string | undefined, options: object | undefined, create: () => F): F {
  // `undefined` 語系（執行環境預設）與任何字串都不會撞鍵。
  const key = JSON.stringify([loc ?? null, options ?? null])
  let formatter = cache.get(key)
  if (!formatter) {
    formatter = create()
    cache.set(key, formatter)
  }
  return formatter
}

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>()
const numberFormatters = new Map<string, Intl.NumberFormat>()
const relativeTimeFormatters = new Map<string, Intl.RelativeTimeFormat>()

export function dateTimeFormatter(loc: string | undefined, options?: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return cachedFormatter(dateTimeFormatters, loc, options, () => new Intl.DateTimeFormat(loc, options))
}

export function numberFormatter(loc: string | undefined, options?: Intl.NumberFormatOptions): Intl.NumberFormat {
  return cachedFormatter(numberFormatters, loc, options, () => new Intl.NumberFormat(loc, options))
}

function relativeTimeFormatter(loc: string): Intl.RelativeTimeFormat {
  return cachedFormatter(relativeTimeFormatters, loc, undefined, () => new Intl.RelativeTimeFormat(loc, { numeric: 'auto' }))
}

/** Same text `Date#toLocale*String()` gives for an invalid date (Intl would throw). */
const INVALID_DATE = 'Invalid Date'

const DATE_FIELDS = ['weekday', 'year', 'month', 'day'] as const
const TIME_FIELDS = ['dayPeriod', 'hour', 'minute', 'second', 'fractionalSecondDigits'] as const

const DEFAULT_DATE = { year: 'numeric', month: 'numeric', day: 'numeric' } as const satisfies Intl.DateTimeFormatOptions
const DEFAULT_TIME = { hour: 'numeric', minute: 'numeric', second: 'numeric' } as const satisfies Intl.DateTimeFormatOptions
const DEFAULT_DATE_TIME = { ...DEFAULT_DATE, ...DEFAULT_TIME } as const satisfies Intl.DateTimeFormatOptions

const SHORT_DATE_TIME = { dateStyle: 'short', timeStyle: 'short' } as const satisfies Intl.DateTimeFormatOptions
const PADDED_DATE = { year: 'numeric', month: '2-digit', day: '2-digit' } as const satisfies Intl.DateTimeFormatOptions
const PADDED_TIME = { hour: '2-digit', minute: '2-digit' } as const satisfies Intl.DateTimeFormatOptions
const MEDIUM_DATE = { dateStyle: 'medium' } as const satisfies Intl.DateTimeFormatOptions

function localeStringOptions(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions {
  const hasField = options.dateStyle !== undefined
    || options.timeStyle !== undefined
    || DATE_FIELDS.some(field => options[field] !== undefined)
    || TIME_FIELDS.some(field => options[field] !== undefined)
  return hasField ? options : { ...options, ...DEFAULT_DATE_TIME }
}

function formatStamp(value: Stamp, loc: string, options: Intl.DateTimeFormatOptions): string {
  const time = toTime(value)
  return Number.isNaN(time) ? INVALID_DATE : dateTimeFormatter(loc, options).format(time)
}

export function formatDateTime(value: Stamp, loc: string = currentLocale()): string {
  return formatStamp(value, loc, SHORT_DATE_TIME)
}

export function formatDate(value: Stamp, loc: string = currentLocale()): string {
  return formatStamp(value, loc, PADDED_DATE)
}

export function formatTime(value: Stamp, loc: string = currentLocale()): string {
  return formatStamp(value, loc, PADDED_TIME)
}

export function formatTimeFull(value: Stamp, loc: string = currentLocale()): string {
  return formatStamp(value, loc, DEFAULT_TIME)
}

export function formatDateTimeFull(value: Stamp, loc: string = currentLocale()): string {
  return formatStamp(value, loc, DEFAULT_DATE_TIME)
}

export function formatDateDefault(value: Stamp, loc: string = currentLocale()): string {
  return formatStamp(value, loc, DEFAULT_DATE)
}

export function formatDateParts(value: Stamp, options: Intl.DateTimeFormatOptions, loc: string = currentLocale()): string {
  return formatStamp(value, loc, localeStringOptions(options))
}

export function formatNumber(value: number, loc: string = currentLocale(), options?: Intl.NumberFormatOptions): string {
  return numberFormatter(loc, options).format(value)
}

const SECOND_MS = 1_000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

const RELATIVE_UNITS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * DAY_MS],
  ['month', 30 * DAY_MS],
  ['day', DAY_MS],
  ['hour', HOUR_MS],
  ['minute', MINUTE_MS],
  ['second', SECOND_MS],
]

export interface RelativeTimeOptions {
  /** `trunc`（預設）：先四捨五入到整秒，再對最大單位捨去小數；`round`：以毫秒差直接四捨五入。 */
  readonly rounding?: 'trunc' | 'round'
  readonly nowWithinMs?: number
  /** 不設定就一直用相對時間。 */
  readonly dateFromMs?: number
}

export const FEED_RELATIVE_TIME = {
  rounding: 'round',
  nowWithinMs: MINUTE_MS,
  dateFromMs: 7 * DAY_MS,
} as const satisfies RelativeTimeOptions

export function formatRelative(
  value: Stamp,
  now: Stamp = Date.now(),
  loc: string = currentLocale(),
  options: RelativeTimeOptions = {},
): string {
  const { rounding = 'trunc', nowWithinMs = 0, dateFromMs } = options
  const exact = toTime(value) - toTime(now)
  const diff = rounding === 'trunc' ? Math.round(exact / SECOND_MS) * SECOND_MS : exact
  const age = Math.abs(diff)
  const formatter = relativeTimeFormatter(loc)
  if (Number.isNaN(age) || age < nowWithinMs) return formatter.format(0, 'second')
  if (dateFromMs !== undefined && age >= dateFromMs) return formatStamp(value, loc, MEDIUM_DATE)
  const round = rounding === 'trunc' ? Math.trunc : Math.round
  for (const [unit, size] of RELATIVE_UNITS) {
    if (age >= size || unit === 'second') return formatter.format(round(diff / size), unit)
  }
  return formatter.format(0, 'second')
}

export interface DurationParts {
  days: number
  hours: number
  minutes: number
  seconds: number
}

export interface DurationPartsOptions {
  readonly smallest?: 'second' | 'minute'
  /** 更大的量都累計在這個單位上（例如 `minute` 時 90 分鐘就是 90）。 */
  readonly largest?: 'day' | 'hour' | 'minute'
  readonly rounding?: 'floor' | 'ceil' | 'round'
  readonly atLeastOne?: boolean
}

export const HISTORY_DURATION = {
  smallest: 'minute',
  rounding: 'round',
  atLeastOne: true,
} as const satisfies DurationPartsOptions

/** Negative and non-finite values count as 0. */
export function durationParts(ms: number, options: DurationPartsOptions = {}): DurationParts {
  const { smallest = 'second', largest = 'day', rounding = 'floor', atLeastOne = false } = options
  const safe = Number.isFinite(ms) ? Math.max(0, ms) : 0
  const unitSeconds = smallest === 'minute' ? 60 : 1
  const unitMs = unitSeconds * SECOND_MS
  const count = atLeastOne && safe > 0 && safe < unitMs ? 1 : Math[rounding](safe / unitMs)
  let rest = count * unitSeconds
  const days = largest === 'day' ? Math.floor(rest / 86_400) : 0
  rest -= days * 86_400
  const hours = largest === 'minute' ? 0 : Math.floor(rest / 3_600)
  rest -= hours * 3_600
  const minutes = Math.floor(rest / 60)
  return { days, hours, minutes, seconds: rest - minutes * 60 }
}

const pad2 = (value: number): string => String(value).padStart(2, '0')

export function formatDuration(ms: number): string {
  const { hours, minutes, seconds } = durationParts(ms, { largest: 'hour' })
  if (hours > 0) return `${hours}h ${pad2(minutes)}m`
  if (minutes > 0) return `${minutes}m ${pad2(seconds)}s`
  return `${seconds}s`
}

/** Countdown as m:ss (never 83.4s), seconds rounded up. Negative values clamp to 0:00. */
export function formatClockDuration(ms: number): string {
  const { minutes, seconds } = durationParts(ms, { largest: 'minute', rounding: 'ceil' })
  return `${minutes}:${pad2(seconds)}`
}
