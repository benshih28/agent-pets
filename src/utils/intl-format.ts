// Locale-aware formatting (DS-18)
// One place for date/number/relative-time/duration formatting so every view
// agrees. All helpers take an explicit locale (default: the current UI locale)
// so they are testable without the reactive i18n state.
//
// 組織：formatter 快取 → 日期 → 數字 → 相對時間 → 時長。
// Node 測試會直接載入這個檔案，所以 import 用相對路徑加 `.ts`。
import { locale } from '../i18n.ts'

type Stamp = number | Date

const toDate = (value: Stamp): Date => (value instanceof Date ? value : new Date(value))
const toTime = (value: Stamp): number => toDate(value).getTime()
const currentLocale = (): string => locale.value

// ---------------------------------------------------------------------------
// Formatter 快取
// 建一個 Intl.*Format 不便宜，而列表與圖表一次要格式化幾十到上百筆；
// `toLocale*String()` 每次呼叫都會重建，所以一律改用依「語系＋選項」快取的
// formatter。鍵只來自固定的語系與呼叫點的選項，數量有上限。
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 日期與時間
// 每個函式的選項都與改用快取前的 `toLocale*String()` 等價：
// `toLocaleString()` 在沒有任何日期／時間欄位時補上年月日時分秒，
// `toLocaleDateString()` 補年月日，`toLocaleTimeString()` 補時分秒。
// ---------------------------------------------------------------------------

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

/** The options `Date#toLocaleString(loc, options)` actually formats with. */
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

/** Default time style (e.g. "2:05:09 PM"), for per-event timestamps. */
export function formatTimeFull(value: Stamp, loc: string = currentLocale()): string {
  return formatStamp(value, loc, DEFAULT_TIME)
}

/** Locale default date + time (hover titles). */
export function formatDateTimeFull(value: Stamp, loc: string = currentLocale()): string {
  return formatStamp(value, loc, DEFAULT_DATE_TIME)
}

/** Locale default date (no time). */
export function formatDateDefault(value: Stamp, loc: string = currentLocale()): string {
  return formatStamp(value, loc, DEFAULT_DATE)
}

/** Date/time with caller-chosen Intl options (month/day only, weekday, seconds, ...). */
export function formatDateParts(value: Stamp, options: Intl.DateTimeFormatOptions, loc: string = currentLocale()): string {
  return formatStamp(value, loc, localeStringOptions(options))
}

// ---------------------------------------------------------------------------
// 數字
// ---------------------------------------------------------------------------

export function formatNumber(value: number, loc: string = currentLocale(), options?: Intl.NumberFormatOptions): string {
  return numberFormatter(loc, options).format(value)
}

// ---------------------------------------------------------------------------
// 相對時間
// ---------------------------------------------------------------------------

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
  /**
   * `trunc`（預設）：先四捨五入到整秒，再對最大適用單位捨去小數（「59.6 秒前」→「1 分鐘前」、
   * 「1.5 小時後」→「1 小時後」）。`round`：直接以毫秒差對最大適用單位四捨五入。
   */
  readonly rounding?: 'trunc' | 'round'
  /** 差距小於這個毫秒數時一律顯示「現在」。 */
  readonly nowWithinMs?: number
  /** 差距達到這個毫秒數時改顯示日期（dateStyle: medium）；不設定就一直用相對時間。 */
  readonly dateFromMs?: number
}

/** 插件通知收件匣：一分鐘內「現在」，一週以上改顯示日期。 */
export const FEED_RELATIVE_TIME = {
  rounding: 'round',
  nowWithinMs: MINUTE_MS,
  dateFromMs: 7 * DAY_MS,
} as const satisfies RelativeTimeOptions

/** "5 minutes ago" / "in 2 hours" via Intl.RelativeTimeFormat. */
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

// ---------------------------------------------------------------------------
// 時長
// ---------------------------------------------------------------------------

export interface DurationParts {
  days: number
  hours: number
  minutes: number
  seconds: number
}

export interface DurationPartsOptions {
  /** 最小單位（預設 `second`）；不足的部分依 `rounding` 取整。 */
  readonly smallest?: 'second' | 'minute'
  /** 最大單位（預設 `day`）；更大的量都累計在這個單位上（例如 `minute` 時 90 分鐘就是 90）。 */
  readonly largest?: 'day' | 'hour' | 'minute'
  /** 取整到最小單位的方式（預設 `floor`）。 */
  readonly rounding?: 'floor' | 'ceil' | 'round'
  /** 不為 0 但不足一個最小單位時算成 1。 */
  readonly atLeastOne?: boolean
}

/** 歷史統計：整分鐘四捨五入，不足一分鐘但不為 0 時算 1 分鐘。 */
export const HISTORY_DURATION = {
  smallest: 'minute',
  rounding: 'round',
  atLeastOne: true,
} as const satisfies DurationPartsOptions

/** Breaks a duration into parts; negative and non-finite values count as 0. */
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

/** Compact duration such as "1h 05m" / "4m 12s" / "8s" (locale-neutral units). */
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
