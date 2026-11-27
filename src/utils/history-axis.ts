// 單行「11/2（週一）」比預設寬度的日欄還寬，所以拆成日期行與選用的星期行。

import { dateTimeFormatter } from './intl-format.ts'

export interface AxisLabelParts {
  date: string
  weekday: string
}

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

export function dayLabel(localDate: string, withWeekday: boolean, loc?: string): string {
  const date = noon(localDate)
  if (!date) return localDate
  return dateTimeFormatter(loc, withWeekday ? FULL : MONTH_DAY).format(date)
}

/** Every `step`-th label counted back from the newest day, so today is always labelled. */
export function axisLabelVisible(index: number, length: number, step: number): boolean {
  return (length - 1 - index) % Math.max(1, step) === 0
}
