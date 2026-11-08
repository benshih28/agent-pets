// Locale-stable number and duration formatting for the History views, so
// "1.2M" means the same thing in every language and in the achievement copy.

export type TokenFormatMode = 'compact' | 'full'

const UNITS: Array<[number, string]> = [
  [1_000_000_000, 'B'],
  [1_000_000, 'M'],
  [1_000, 'K'],
]

/**
 * Below 1,000 the exact number; from 1,000 a K/M/B suffix with at most one
 * decimal ("full" always uses grouped digits, e.g. for tooltips).
 */
export function formatTokens(value: number, locale: string, mode: TokenFormatMode = 'compact'): string {
  const safe = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
  if (mode === 'full' || safe < 1_000) return safe.toLocaleString(locale)
  for (const [size, suffix] of UNITS) {
    if (safe >= size) {
      const scaled = safe / size
      const text = scaled.toLocaleString(locale, { maximumFractionDigits: scaled >= 100 ? 0 : 1 })
      return `${text}${suffix}`
    }
  }
  return safe.toLocaleString(locale)
}

export interface DurationParts {
  days: number
  hours: number
  minutes: number
}

/** Whole-minute breakdown; anything under a minute that is not zero rounds up to 1. */
export function durationParts(ms: number): DurationParts {
  const safe = Number.isFinite(ms) ? Math.max(0, ms) : 0
  const totalMinutes = safe > 0 && safe < 60_000 ? 1 : Math.round(safe / 60_000)
  return {
    days: Math.floor(totalMinutes / 1_440),
    hours: Math.floor((totalMinutes % 1_440) / 60),
    minutes: totalMinutes % 60,
  }
}

/** Chart scale tick label, e.g. 250000 -> "250K". */
export function niceCeiling(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const normalized = value / magnitude
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return step * magnitude
}
