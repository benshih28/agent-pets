import { formatNumber } from './intl-format.ts'

export type TokenFormatMode = 'compact' | 'full'

const UNITS: Array<[number, string]> = [
  [1_000_000_000, 'B'],
  [1_000_000, 'M'],
  [1_000, 'K'],
]

const WHOLE = { maximumFractionDigits: 0 } as const satisfies Intl.NumberFormatOptions
const ONE_DECIMAL = { maximumFractionDigits: 1 } as const satisfies Intl.NumberFormatOptions

export function formatTokens(value: number, locale: string, mode: TokenFormatMode = 'compact'): string {
  const safe = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
  if (mode === 'full' || safe < 1_000) return formatNumber(safe, locale)
  for (const [size, suffix] of UNITS) {
    if (safe >= size) {
      const scaled = safe / size
      const text = formatNumber(scaled, locale, scaled >= 100 ? WHOLE : ONE_DECIMAL)
      return `${text}${suffix}`
    }
  }
  return formatNumber(safe, locale)
}

export function niceCeiling(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const normalized = value / magnitude
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return step * magnitude
}
