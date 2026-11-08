export type EvolutionStage = 'egg' | 'baby' | 'teen' | 'adult' | 'master'

export interface ProgressionSnapshot {
  petId: string
  totalXp: number
  level: number
  xpIntoLevel: number
  xpToNext: number
  evolutionStage: EvolutionStage
  currentStreak: number
  longestStreak: number
  lastActiveLocalDate?: string
  updatedAt: number
}

export interface ProgressionAward {
  ruleId: string
  amount: number
}

export interface ProgressionEventResult {
  snapshot: ProgressionSnapshot
  awards: ProgressionAward[]
  /** Level and stage before this event's awards, for level-up detection. */
  levelBefore: number
  stageBefore: EvolutionStage
}

/** Main -> renderer notification that a handled event actually granted XP. */
export interface ProgressionAwardEvent {
  petId: string
  awards: ProgressionAward[]
  at: number
  levelBefore: number
  levelAfter: number
  stageBefore: EvolutionStage
  stageAfter: EvolutionStage
}

export interface ProgressionLedgerEntry {
  ruleId: string
  amount: number
  occurredAt: number
}

/** Read-only projection for the Growth view; never mutates XP. */
export interface ProgressionInsights {
  petId: string
  localDate: string
  todayXp: number
  firstCompletionClaimed: boolean
  recent: ProgressionLedgerEntry[]
  /** Average XP per day over the last 7 days, or null with too little data. */
  averageDailyXp: number | null
  generatedAt: number
}

export const EVOLUTION_STAGE_LEVELS: ReadonlyArray<{ stage: EvolutionStage; level: number }> = Object.freeze([
  { stage: 'egg', level: 1 },
  { stage: 'baby', level: 5 },
  { stage: 'teen', level: 10 },
  { stage: 'adult', level: 20 },
  { stage: 'master', level: 35 },
])

/** Next evolution stage after `level`, or null at the final stage. */
export function nextEvolution(level: number): { stage: EvolutionStage; level: number } | null {
  return EVOLUTION_STAGE_LEVELS.find(entry => entry.level > Math.max(1, Math.floor(level))) ?? null
}

export const XP_POLICY_VERSION = 'v1'

export const XP_RULES = Object.freeze({
  sessionCompleted: 20,
  firstCompletionOfDay: 10,
  activeCodingThirtyMinutes: 2,
  dailyStreak: 5,
})

export const ACTIVE_CODING_INTERVAL_MS = 30 * 60 * 1000
export const ACTIVE_CODING_MAX_POINTS_PER_SESSION = 10

export function xpToNext(level: number): number {
  const safeLevel = Math.max(1, Math.floor(level))
  return 100 + 25 * (safeLevel - 1)
}

export function totalXpForLevel(level: number): number {
  const safeLevel = Math.max(1, Math.floor(level))
  const steps = safeLevel - 1
  return (steps * (200 + 25 * (safeLevel - 2))) / 2
}

export function levelForTotalXp(totalXp: number): number {
  const safeXp = Math.max(0, Math.floor(totalXp))
  let level = 1
  while (safeXp >= totalXpForLevel(level + 1)) level += 1
  return level
}

export function evolutionStageForLevel(level: number): EvolutionStage {
  if (level >= 35) return 'master'
  if (level >= 20) return 'adult'
  if (level >= 10) return 'teen'
  if (level >= 5) return 'baby'
  return 'egg'
}

export function progressionForTotalXp(
  petId: string,
  totalXp: number,
  currentStreak: number,
  longestStreak: number,
  lastActiveLocalDate: string | undefined,
  updatedAt: number,
): ProgressionSnapshot {
  const safeXp = Math.max(0, Math.floor(totalXp))
  const level = levelForTotalXp(safeXp)
  return {
    petId,
    totalXp: safeXp,
    level,
    xpIntoLevel: safeXp - totalXpForLevel(level),
    xpToNext: xpToNext(level),
    evolutionStage: evolutionStageForLevel(level),
    currentStreak: Math.max(0, Math.floor(currentStreak)),
    longestStreak: Math.max(0, Math.floor(longestStreak)),
    ...(lastActiveLocalDate ? { lastActiveLocalDate } : {}),
    updatedAt,
  }
}
