// Pure helpers for timed Do Not Disturb. Kept free of Electron so the maths
// (midnight rollover, DST via the local Date) can be unit tested.

export type DndPreset = '30m' | '1h' | 'tomorrow' | 'always'

export const DND_MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1000

export function isDndPreset(value: unknown): value is DndPreset {
  return value === '30m' || value === '1h' || value === 'tomorrow' || value === 'always'
}

/**
 * Returns the epoch ms at which DND should end, or null for "until I turn it
 * off". `tomorrow` is the next local 09:00 strictly after `now`.
 */
export function resolveDndUntil(preset: DndPreset, now: number, resumeHour = 9): number | null {
  switch (preset) {
    case '30m': return now + 30 * 60_000
    case '1h': return now + 60 * 60_000
    case 'tomorrow': {
      const target = new Date(now)
      target.setHours(resumeHour, 0, 0, 0)
      if (target.getTime() <= now) target.setDate(target.getDate() + 1)
      return target.getTime()
    }
    case 'always': return null
  }
}

/** Clamps a requested end time into (now, now + 7 days]; anything else is dropped. */
export function normalizeDndUntil(value: unknown, dndEnabled: boolean, now: number): number | null {
  if (!dndEnabled) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (value <= now) return null
  return Math.min(Math.floor(value), now + DND_MAX_DURATION_MS)
}

/** True while a timed DND is still running; false for indefinite or expired. */
export function dndHasExpired(dndEnabled: boolean, dndUntil: number | null | undefined, now: number): boolean {
  return dndEnabled && typeof dndUntil === 'number' && now >= dndUntil
}

export function dndRemainingMs(dndEnabled: boolean, dndUntil: number | null | undefined, now: number): number | null {
  if (!dndEnabled || typeof dndUntil !== 'number') return null
  return Math.max(0, dndUntil - now)
}
