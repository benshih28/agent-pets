// Trend-chart x-axis labels. A one-line "11/2（週一）" is wider than a day
// column at the panel's default width, so neighbouring labels ran into each
// other. The label is split into a date line and an optional weekday line;
// the full date stays in each bar's aria-label and the detail line.

export interface AxisLabelParts {
  date: string
  weekday: string
}

// 建一個 Intl.DateTimeFormat 不便宜，而圖表一次要格式化最多 90 天，所以依語系與選項快取。
const formatters = new Map<string, Intl.DateTimeFormat>()
function formatter(loc: string | undefined, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${loc ?? ''}|${JSON.stringify(options)}`
  let cached = formatters.get(key)
  if (!cached) {
    cached = new Intl.DateTimeFormat(loc, options)
    formatters.set(key, cached)
  }
  return cached
}

const MONTH_DAY: Intl.DateTimeFormatOptions = { month: 'numeric', day: 'numeric' }
const WEEKDAY: Intl.DateTimeFormatOptions = { weekday: 'short' }
const FULL: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'numeric', day: 'numeric' }

function noon(localDate: string): Date | null {
  const date = new Date(`${localDate}T12:00:00`)
  return Number.isFinite(date.getTime()) ? date : null
}

export function axisLabelParts(localDate: string, withWeekday: boolean, loc?: string): AxisLabelParts {
  const date = noon(localDate)
  if (!date) return { date: localDate, weekday: '' }
  return {
    date: formatter(loc, MONTH_DAY).format(date),
    weekday: withWeekday ? formatter(loc, WEEKDAY).format(date) : '',
  }
}

/** One-line date for the aria-label and the detail line. */
export function dayLabel(localDate: string, withWeekday: boolean, loc?: string): string {
  const date = noon(localDate)
  if (!date) return localDate
  return formatter(loc, withWeekday ? FULL : MONTH_DAY).format(date)
}

/** Every `step`-th label counted back from the newest day, so today is always labelled. */
export function axisLabelVisible(index: number, length: number, step: number): boolean {
  return (length - 1 - index) % Math.max(1, step) === 0
}
