// Single definition of "a day": the user's local calendar date. Shared by
// progression, history, achievements and the Growth views.

export function localDateKey(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// Noon avoids DST edges where midnight may not exist or repeat.
export function dateOffset(key: string, offset: number): string {
  const date = new Date(`${key}T12:00:00`)
  date.setDate(date.getDate() + offset)
  return localDateKey(date.getTime())
}

export function previousLocalDate(key: string): string {
  return dateOffset(key, -1)
}

export function localHour(timestamp: number): number {
  return new Date(timestamp).getHours()
}
