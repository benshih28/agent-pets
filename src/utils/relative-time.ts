const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
]

const relativeFormatters = new Map<string, Intl.RelativeTimeFormat>()
function relativeFormatter(locale: string): Intl.RelativeTimeFormat {
  let formatter = relativeFormatters.get(locale)
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    relativeFormatters.set(locale, formatter)
  }
  return formatter
}

/** 「5 分鐘前」「昨天」這類相對時間；一週以上改回日期。 */
export function formatRelativeTime(timestamp: number, now: number, locale: string): string {
  const diff = timestamp - now
  const age = Math.abs(diff)
  if (age < 60_000) return relativeFormatter(locale).format(0, 'second')
  if (age >= 7 * 86_400_000) return new Date(timestamp).toLocaleDateString(locale, { dateStyle: 'medium' })
  const formatter = relativeFormatter(locale)
  for (const [unit, size] of UNITS) {
    if (age >= size) return formatter.format(Math.round(diff / size), unit)
  }
  return formatter.format(0, 'second')
}

/** 只取連結的主機名稱供顯示；無法解析時回傳空字串。 */
export function linkHost(link: string | undefined): string {
  if (!link) return ''
  try {
    return new URL(link).hostname
  } catch {
    return ''
  }
}
