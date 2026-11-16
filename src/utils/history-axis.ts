// Trend-chart x-axis labels. A one-line "11/2（週一）" is wider than a day
// column at the panel's default width, so neighbouring labels ran into each
// other. The label is split into a date line and an optional weekday line;
// the full date stays in each bar's aria-label and the detail line.

import { dateTimeFormatter } from './intl-format.ts'

export interface AxisLabelParts {
  date: string
  weekday: string
}

// 圖表一次要格式化最多 90 天，formatter 由 intl-format.ts 依語系與選項快取。
const MONTH_DAY = { month: 'numeric', day: 'numeric' } as const satisfies Intl.DateTimeFormatOptions
const WEEKDAY = { weekday: 'short' } as const satisfies Intl.DateTimeFormatOptions
const FULL = { weekday: 'short', month: 'numeric', day: 'numeric' } as const satisfies Intl.DateTimeFormatOptions

function noon(localDate: string): Date | null {
  const date = new Date(`${localDate}T12:00:00`)
  return Number.isFinite(date.getTime()) ? date : null
}

export function axisLabelParts(localDate: string, withWeekday: boolean, loc?: string): AxisLabelParts {
  const date = noon(localDate)
  if (!date) return { date: localDate, weekday: '' }
  return {
    date: dateTimeFormatter(loc, MONTH_DAY).format(date),
    weekday: withWeekday ? dateTimeFormatter(loc, WEEKDAY).format(date) : '',
  }
}

/** One-line date for the aria-label and the detail line. */
export function dayLabel(localDate: string, withWeekday: boolean, loc?: string): string {
  const date = noon(localDate)
  if (!date) return localDate
  return dateTimeFormatter(loc, withWeekday ? FULL : MONTH_DAY).format(date)
}

/** Every `step`-th label counted back from the newest day, so today is always labelled. */
export function axisLabelVisible(index: number, length: number, step: number): boolean {
  return (length - 1 - index) % Math.max(1, step) === 0
}
