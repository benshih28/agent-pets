import { totalXpForLevel } from '../types/progression.ts'
import { previousLocalDate } from './local-date.ts'

export function xpRemaining(xpIntoLevel: number, xpToNext: number): number {
  return Math.max(0, xpToNext - xpIntoLevel)
}

/** Bar width: never a hairline once any XP exists, never full before levelling. */
export function displayPercent(xpIntoLevel: number, xpToNext: number): number {
  if (xpToNext <= 0 || xpIntoLevel <= 0) return 0
  return Math.min(100, Math.max(2, Math.round((xpIntoLevel / xpToNext) * 100)))
}

export function isAlmostLevelUp(xpIntoLevel: number, xpToNext: number): boolean {
  return xpToNext > 0 && xpIntoLevel / xpToNext >= 0.9
}

/** The streak ends tonight if the last active day was yesterday and today has no completion yet. */
export function streakAtRisk(lastActiveLocalDate: string | undefined, today: string, currentStreak: number): boolean {
  return currentStreak > 0 && lastActiveLocalDate === previousLocalDate(today)
}

/** Whole days until `targetLevel` at the recent average pace, or null without a pace. */
export function etaDaysToLevel(totalXp: number, targetLevel: number, averageDailyXp: number | null): number | null {
  if (averageDailyXp === null || averageDailyXp <= 0) return null
  const needed = Math.max(0, totalXpForLevel(targetLevel) - totalXp)
  return Math.max(1, Math.ceil(needed / averageDailyXp))
}
