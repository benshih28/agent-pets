import type { EvolutionStage } from '../types/progression.ts'

export interface CelebrationLevel {
  from: number
  to: number
  /** Set when any merged level-up crossed into a new stage. */
  evolvedTo?: EvolutionStage
}

export interface CelebrationAchievement {
  id: string
  titleKey: string
  descriptionKey: string
  visualReward: 'sparkle' | 'badge'
}

export interface CelebrationBatch {
  level: CelebrationLevel | null
  achievements: CelebrationAchievement[]
}

export const emptyBatch = (): CelebrationBatch => ({ level: null, achievements: [] })

export function batchIsEmpty(batch: CelebrationBatch): boolean {
  return batch.level === null && batch.achievements.length === 0
}

/** Merges several level-ups into one "Lv a -> Lv z" entry. */
export function addLevelUp(
  batch: CelebrationBatch,
  event: { fromLevel: number; toLevel: number; evolved: boolean; toStage: EvolutionStage },
): CelebrationBatch {
  const level: CelebrationLevel = batch.level
    ? { ...batch.level, to: Math.max(batch.level.to, event.toLevel) }
    : { from: event.fromLevel, to: event.toLevel }
  if (event.evolved) level.evolvedTo = event.toStage
  return { ...batch, level }
}

/** Collapses duplicates by id so a replayed unlock never doubles the count. */
export function addAchievement(batch: CelebrationBatch, item: CelebrationAchievement): CelebrationBatch {
  if (batch.achievements.some(existing => existing.id === item.id)) return batch
  return { ...batch, achievements: [...batch.achievements, item] }
}

export function mergeBatches(into: CelebrationBatch, from: CelebrationBatch): CelebrationBatch {
  let next = into
  if (from.level) {
    next = addLevelUp(next, {
      fromLevel: from.level.from,
      toLevel: from.level.to,
      evolved: from.level.evolvedTo !== undefined,
      toStage: from.level.evolvedTo ?? 'egg',
    })
  }
  for (const item of from.achievements) next = addAchievement(next, item)
  return next
}
