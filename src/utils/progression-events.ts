import type { EvolutionStage, ProgressionAwardEvent } from '../types/progression.ts'

const STAGES = new Set<string>(['egg', 'baby', 'teen', 'adult', 'master'])
const RULE_ID = /^[A-Za-z0-9._-]{1,64}$/
const PET_ID = /^[A-Za-z0-9._:-]{1,128}$/
const MAX_AWARDS_PER_EVENT = 8
const MAX_AMOUNT = 1_000

export interface RecentAward {
  id: string
  petId: string
  ruleId: string
  amount: number
  at: number
}

export interface LevelUpEvent {
  id: string
  petId: string
  fromLevel: number
  toLevel: number
  fromStage: EvolutionStage
  toStage: EvolutionStage
  evolved: boolean
  at: number
}

/** Validates a main-process award notification before it reaches the store. */
export function normalizeProgressionAwardEvent(value: unknown): ProgressionAwardEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (typeof raw.petId !== 'string' || !PET_ID.test(raw.petId)) return null
  if (!Array.isArray(raw.awards) || raw.awards.length === 0) return null
  if (!Number.isSafeInteger(raw.at) || (raw.at as number) < 0) return null
  const levels = [raw.levelBefore, raw.levelAfter]
  if (levels.some(level => !Number.isSafeInteger(level) || (level as number) < 1)) return null
  if (!STAGES.has(String(raw.stageBefore)) || !STAGES.has(String(raw.stageAfter))) return null
  const awards: ProgressionAwardEvent['awards'] = []
  for (const candidate of raw.awards.slice(0, MAX_AWARDS_PER_EVENT)) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null
    const award = candidate as Record<string, unknown>
    if (typeof award.ruleId !== 'string' || !RULE_ID.test(award.ruleId)) return null
    if (!Number.isSafeInteger(award.amount) || (award.amount as number) < 1 || (award.amount as number) > MAX_AMOUNT) return null
    awards.push({ ruleId: award.ruleId, amount: award.amount as number })
  }
  return {
    petId: raw.petId,
    awards,
    at: raw.at as number,
    levelBefore: raw.levelBefore as number,
    levelAfter: raw.levelAfter as number,
    stageBefore: raw.stageBefore as EvolutionStage,
    stageAfter: raw.stageAfter as EvolutionStage,
  }
}

/** A level-up only when the level strictly rose; replays/loads never qualify. */
export function levelUpFromAward(event: ProgressionAwardEvent, id: string): LevelUpEvent | null {
  if (event.levelAfter <= event.levelBefore) return null
  return {
    id,
    petId: event.petId,
    fromLevel: event.levelBefore,
    toLevel: event.levelAfter,
    fromStage: event.stageBefore,
    toStage: event.stageAfter,
    evolved: event.stageAfter !== event.stageBefore,
    at: event.at,
  }
}

export function recentAwardsFromEvent(event: ProgressionAwardEvent, firstId: number): RecentAward[] {
  return event.awards.map((award, index) => ({
    id: `${event.petId}:${event.at}:${firstId + index}`,
    petId: event.petId,
    ruleId: award.ruleId,
    amount: award.amount,
    at: event.at,
  }))
}

export const RECENT_AWARD_LIMIT = 20
