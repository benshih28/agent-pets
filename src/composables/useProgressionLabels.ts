import { computed } from 'vue'
import { t, type TranslationKey } from '@/i18n'
import { useAgentStore } from '@/stores/agentStore'
import {
  ACTIVE_CODING_MAX_POINTS_PER_SESSION,
  XP_RULES,
  type EvolutionStage,
} from '@/types/progression'

const EVOLUTION_KEYS: Record<EvolutionStage, TranslationKey> = {
  egg: 'evolutionEgg',
  baby: 'evolutionBaby',
  teen: 'evolutionTeen',
  adult: 'evolutionAdult',
  master: 'evolutionMaster',
}

const RULE_KEYS: Record<string, TranslationKey> = {
  'v1.session-completed': 'growth.ruleSessionCompleted',
  'v1.first-completion-of-day': 'growth.ruleFirstCompletion',
  'v1.active-time': 'growth.ruleActiveTime',
  'v1.daily-streak': 'growth.ruleDailyStreak',
}

// Evolution, mood and XP-rule wording shared by Growth, History and the pet
// celebration, so the three views can never describe the same state differently.
export function useProgressionLabels() {
  const store = useAgentStore()

  function evolutionLabel(stage: EvolutionStage | undefined): string {
    return stage ? t(EVOLUTION_KEYS[stage]) : ''
  }

  const moodStage = computed(() => {
    if (store.mood >= 90) return t('moodOverdrive')
    if (store.mood >= 70) return t('moodRadiant')
    if (store.mood >= 40) return t('moodCharged')
    return t('moodResting')
  })

  // Internal ledger ids (v1.session-completed) never reach the screen.
  function ruleLabel(ruleId: string): string {
    return t(RULE_KEYS[ruleId] ?? 'growth.ruleUnknown')
  }

  const xpSources = computed(() => [
    t('growth.xpSourceSession', { xp: XP_RULES.sessionCompleted }),
    t('growth.xpSourceFirst', { xp: XP_RULES.firstCompletionOfDay }),
    t('growth.xpSourceActive', { xp: XP_RULES.activeCodingThirtyMinutes, max: ACTIVE_CODING_MAX_POINTS_PER_SESSION }),
    t('growth.xpSourceStreak', { xp: XP_RULES.dailyStreak }),
  ])

  return { evolutionLabel, moodStage, ruleLabel, xpSources }
}
