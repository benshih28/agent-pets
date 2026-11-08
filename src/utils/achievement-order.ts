import type { AchievementView } from '../types/achievement.ts'

export type AchievementFilter = 'all' | 'progress' | 'unlocked'

export interface AchievementSections {
  inProgress: AchievementView[]
  unlocked: AchievementView[]
  hidden: AchievementView[]
}

const ratio = (item: AchievementView): number => item.progress.current / item.progress.target

/** In progress: closest to done first (small targets first on ties); unlocked: newest first; locked hidden ones last. */
export function sectionAchievements(items: readonly AchievementView[]): AchievementSections {
  const inProgress = items
    .filter(item => !item.unlocked && !item.hidden)
    .sort((a, b) => ratio(b) - ratio(a) || a.progress.target - b.progress.target)
  const unlocked = items
    .filter(item => item.unlocked)
    .sort((a, b) => (b.unlockedAt ?? 0) - (a.unlockedAt ?? 0))
  const hidden = items.filter(item => !item.unlocked && item.hidden)
  return { inProgress, unlocked, hidden }
}
