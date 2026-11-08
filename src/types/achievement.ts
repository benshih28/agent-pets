export type AchievementId =
  | 'hello_world'
  | 'getting_serious'
  | 'night_owl'
  | 'one_million'
  | 'polyglot_agents'
  | 'busy_day'
  | 'loyal_companion'
  | 'old_friend'
  | 'level_10'
  | 'level_20'
  | 'sessions_10'
  | 'sessions_500'
  | 'streak_3'
  | 'streak_30'

export type AchievementCategory = 'milestone' | 'habit' | 'explore' | 'level'

export interface AchievementProgress {
  current: number
  target: number
}

export type AchievementTranslationKey =
  | 'achievementHelloWorld'
  | 'achievementGettingSerious'
  | 'achievementNightOwl'
  | 'achievementOneMillion'
  | 'achievementPolyglotAgents'
  | 'achievementBusyDay'
  | 'achievementLoyalCompanion'
  | 'achievementOldFriend'
  | 'achievementLevel10'
  | 'achievementLevel20'
  | 'achievementHelloWorldHelp'
  | 'achievementGettingSeriousHelp'
  | 'achievementNightOwlHelp'
  | 'achievementOneMillionHelp'
  | 'achievementPolyglotAgentsHelp'
  | 'achievementBusyDayHelp'
  | 'achievementLoyalCompanionHelp'
  | 'achievementOldFriendHelp'
  | 'achievementLevel10Help'
  | 'achievementLevel20Help'
  | 'growth.achievementSessions10'
  | 'growth.achievementSessions10Help'
  | 'growth.achievementSessions500'
  | 'growth.achievementSessions500Help'
  | 'growth.achievementStreak3'
  | 'growth.achievementStreak3Help'
  | 'growth.achievementStreak30'
  | 'growth.achievementStreak30Help'

export type AchievementTokenQuality = 'none' | 'estimated' | 'exact'
export type AchievementVisualReward = 'sparkle' | 'badge'

export interface AchievementEvaluationContext {
  completedSessions: number
  completedSessionsToday: number
  tokenTotal: number
  tokenQuality: AchievementTokenQuality
  adapterCount: number
  activeDays: number
  nightOwlCompletion: boolean
  currentStreak: number
  level: number
}

export interface AchievementEvaluation {
  id: AchievementId
  tokenQuality?: Exclude<AchievementTokenQuality, 'none'>
}

export interface AchievementDefinition {
  id: AchievementId
  version: number
  titleKey: AchievementTranslationKey
  descriptionKey: AchievementTranslationKey
  visualReward: AchievementVisualReward
  category: AchievementCategory
  /** Shown as "???" until unlocked, to keep some discovery. */
  hidden?: boolean
  /** Distance to unlock, from the same context evaluate() uses. */
  progress: (context: AchievementEvaluationContext) => AchievementProgress
  evaluate: (context: AchievementEvaluationContext) => AchievementEvaluation | null
}

export interface AchievementUnlock {
  petId: string
  achievementId: AchievementId
  version: number
  unlockedAt: number
  titleKey: AchievementTranslationKey
  descriptionKey: AchievementTranslationKey
  visualReward: AchievementVisualReward
  tokenQuality: AchievementTokenQuality
}

export interface AchievementView {
  id: AchievementId
  version: number
  titleKey: AchievementTranslationKey
  descriptionKey: AchievementTranslationKey
  visualReward: AchievementVisualReward
  unlocked: boolean
  unlockedAt?: number
  tokenQuality: AchievementTokenQuality
  category: AchievementCategory
  hidden: boolean
  progress: AchievementProgress
}

export interface AchievementSnapshot {
  schemaVersion: 1
  generatedAt: number
  petId: string
  totalUnlocked: number
  achievements: AchievementView[]
}

const definitions: readonly AchievementDefinition[] = [
  {
    id: 'hello_world',
    version: 1,
    category: 'milestone',
    progress: c => ({ current: Math.min(1, c.completedSessions), target: 1 }),
    titleKey: 'achievementHelloWorld',
    descriptionKey: 'achievementHelloWorldHelp',
    visualReward: 'sparkle',
    evaluate: context => context.completedSessions >= 1 ? { id: 'hello_world' } : null,
  },
  {
    id: 'getting_serious',
    version: 1,
    category: 'milestone',
    progress: c => ({ current: Math.min(100, c.completedSessions), target: 100 }),
    titleKey: 'achievementGettingSerious',
    descriptionKey: 'achievementGettingSeriousHelp',
    visualReward: 'badge',
    evaluate: context => context.completedSessions >= 100 ? { id: 'getting_serious' } : null,
  },
  {
    id: 'night_owl',
    version: 1,
    category: 'explore',
    hidden: true,
    progress: c => ({ current: Math.min(1, c.nightOwlCompletion ? 1 : 0), target: 1 }),
    titleKey: 'achievementNightOwl',
    descriptionKey: 'achievementNightOwlHelp',
    visualReward: 'sparkle',
    evaluate: context => context.nightOwlCompletion ? { id: 'night_owl' } : null,
  },
  {
    id: 'one_million',
    version: 1,
    category: 'milestone',
    progress: c => ({ current: Math.min(1_000_000, c.tokenTotal), target: 1_000_000 }),
    titleKey: 'achievementOneMillion',
    descriptionKey: 'achievementOneMillionHelp',
    visualReward: 'badge',
    evaluate: context => context.tokenTotal >= 1_000_000 && context.tokenQuality !== 'none'
      ? { id: 'one_million', tokenQuality: context.tokenQuality }
      : null,
  },
  {
    id: 'polyglot_agents',
    version: 1,
    category: 'explore',
    progress: c => ({ current: Math.min(3, c.adapterCount), target: 3 }),
    titleKey: 'achievementPolyglotAgents',
    descriptionKey: 'achievementPolyglotAgentsHelp',
    visualReward: 'badge',
    evaluate: context => context.adapterCount >= 3 ? { id: 'polyglot_agents' } : null,
  },
  {
    id: 'busy_day',
    version: 1,
    category: 'habit',
    progress: c => ({ current: Math.min(20, c.completedSessionsToday), target: 20 }),
    titleKey: 'achievementBusyDay',
    descriptionKey: 'achievementBusyDayHelp',
    visualReward: 'sparkle',
    evaluate: context => context.completedSessionsToday >= 20 ? { id: 'busy_day' } : null,
  },
  {
    id: 'loyal_companion',
    version: 1,
    category: 'habit',
    progress: c => ({ current: Math.min(7, c.currentStreak), target: 7 }),
    titleKey: 'achievementLoyalCompanion',
    descriptionKey: 'achievementLoyalCompanionHelp',
    visualReward: 'badge',
    evaluate: context => context.currentStreak >= 7 ? { id: 'loyal_companion' } : null,
  },
  {
    id: 'old_friend',
    version: 1,
    category: 'habit',
    progress: c => ({ current: Math.min(30, c.activeDays), target: 30 }),
    titleKey: 'achievementOldFriend',
    descriptionKey: 'achievementOldFriendHelp',
    visualReward: 'badge',
    evaluate: context => context.activeDays >= 30 ? { id: 'old_friend' } : null,
  },
  {
    id: 'level_10',
    version: 1,
    category: 'level',
    progress: c => ({ current: Math.min(10, c.level), target: 10 }),
    titleKey: 'achievementLevel10',
    descriptionKey: 'achievementLevel10Help',
    visualReward: 'sparkle',
    evaluate: context => context.level >= 10 ? { id: 'level_10' } : null,
  },
  {
    id: 'level_20',
    version: 1,
    category: 'level',
    progress: c => ({ current: Math.min(20, c.level), target: 20 }),
    titleKey: 'achievementLevel20',
    descriptionKey: 'achievementLevel20Help',
    visualReward: 'badge',
    evaluate: context => context.level >= 20 ? { id: 'level_20' } : null,
  },
  {
    id: 'sessions_10',
    version: 1,
    category: 'milestone',
    progress: c => ({ current: Math.min(10, c.completedSessions), target: 10 }),
    titleKey: 'growth.achievementSessions10',
    descriptionKey: 'growth.achievementSessions10Help',
    visualReward: 'sparkle',
    evaluate: context => context.completedSessions >= 10 ? { id: 'sessions_10' } : null,
  },
  {
    id: 'sessions_500',
    version: 1,
    category: 'milestone',
    progress: c => ({ current: Math.min(500, c.completedSessions), target: 500 }),
    titleKey: 'growth.achievementSessions500',
    descriptionKey: 'growth.achievementSessions500Help',
    visualReward: 'badge',
    evaluate: context => context.completedSessions >= 500 ? { id: 'sessions_500' } : null,
  },
  {
    id: 'streak_3',
    version: 1,
    category: 'habit',
    progress: c => ({ current: Math.min(3, c.currentStreak), target: 3 }),
    titleKey: 'growth.achievementStreak3',
    descriptionKey: 'growth.achievementStreak3Help',
    visualReward: 'sparkle',
    evaluate: context => context.currentStreak >= 3 ? { id: 'streak_3' } : null,
  },
  {
    id: 'streak_30',
    version: 1,
    category: 'habit',
    progress: c => ({ current: Math.min(30, c.currentStreak), target: 30 }),
    titleKey: 'growth.achievementStreak30',
    descriptionKey: 'growth.achievementStreak30Help',
    visualReward: 'badge',
    evaluate: context => context.currentStreak >= 30 ? { id: 'streak_30' } : null,
  },
]

export const ACHIEVEMENT_DEFINITIONS = Object.freeze(definitions)

export function evaluateAchievements(context: AchievementEvaluationContext): AchievementEvaluation[] {
  return ACHIEVEMENT_DEFINITIONS
    .map(definition => definition.evaluate(context))
    .filter((result): result is AchievementEvaluation => result !== null)
}
