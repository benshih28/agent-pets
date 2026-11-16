// 成長進度與成就：XP／等級／連續天數與成就由主程序計算，renderer 只驗證並保存最新快照與「剛剛發生」的事件。
//
// - 事件輸入：主程序廣播經 App.vue 呼叫 `setProgressionSnapshot`／`setAchievementsSnapshot`／
//   `handleProgressionAwarded`／`handleAchievementUnlocked`；啟動與換寵物時呼叫 `initialize*`／`setProgressionPet`。
// - 計時器：無。
// - storage：無（持久化在主程序）。
// - 跨視窗同步：每個視窗各自接主程序的廣播；升級／解鎖只來自廣播，冷載入或重播事件不會變成慶祝。
import { ref, shallowRef } from 'vue'
import type { AchievementSnapshot, AchievementUnlock } from '@/types/achievement'
import { ACHIEVEMENT_DEFINITIONS } from '@/types/achievement'
import type { ProgressionSnapshot } from '@/types/progression'
import {
  levelUpFromAward,
  normalizeProgressionAwardEvent,
  RECENT_AWARD_LIMIT,
  recentAwardsFromEvent,
  type LevelUpEvent,
  type RecentAward,
} from '@/utils/progression-events'
import { isValidPetId } from '@/utils/pet-id'

const ACHIEVEMENT_DEFINITION_BY_ID = new Map(ACHIEVEMENT_DEFINITIONS.map(entry => [entry.id, entry]))
const EVOLUTION_STAGES = new Set(['egg', 'baby', 'teen', 'adult', 'master'])

function normalizeProgressionSnapshot(value: unknown): ProgressionSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const integerFields = ['totalXp', 'level', 'xpIntoLevel', 'xpToNext', 'currentStreak', 'longestStreak', 'updatedAt']
  if (
    typeof raw.petId !== 'string'
    || !EVOLUTION_STAGES.has(String(raw.evolutionStage))
    || integerFields.some((field) => !Number.isSafeInteger(raw[field]))
    || Number(raw.totalXp) < 0
    || Number(raw.level) < 1
    || Number(raw.xpIntoLevel) < 0
    || Number(raw.xpToNext) <= 0
    || Number(raw.currentStreak) < 0
    || Number(raw.longestStreak) < 0
  ) return null
  const lastActiveLocalDate = typeof raw.lastActiveLocalDate === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(raw.lastActiveLocalDate)
    ? raw.lastActiveLocalDate
    : undefined
  return {
    petId: raw.petId,
    totalXp: raw.totalXp as number,
    level: raw.level as number,
    xpIntoLevel: raw.xpIntoLevel as number,
    xpToNext: raw.xpToNext as number,
    evolutionStage: raw.evolutionStage as ProgressionSnapshot['evolutionStage'],
    currentStreak: raw.currentStreak as number,
    longestStreak: raw.longestStreak as number,
    ...(lastActiveLocalDate ? { lastActiveLocalDate } : {}),
    updatedAt: raw.updatedAt as number,
  }
}

/** `selectedPet` 由寵物模組持有；初始化時要用目前選的寵物向主程序要快照。 */
export function useProgression(selectedPet: { readonly value: string }) {
  // shallowRef: both are always replaced wholesale (setProgressionSnapshot,
  // setAchievementsSnapshot each assign a fresh value), never mutated in
  // place，所以不需要深層響應。
  const progression = shallowRef<ProgressionSnapshot | null>(null)
  const achievements = shallowRef<AchievementSnapshot | null>(null)
  const achievementUnlock = ref<AchievementUnlock | null>(null)
  // XP the main process actually granted (newest first), and the last
  // level-up/evolution. Both come only from main's award notifications, so a
  // cold load or a replayed event can never look like a fresh celebration.
  const recentAwards = shallowRef<RecentAward[]>([])
  const levelUpEvent = shallowRef<LevelUpEvent | null>(null)
  let awardSequence = 0

  function setProgressionSnapshot(value: unknown): boolean {
    const normalized = normalizeProgressionSnapshot(value)
    if (!normalized) return false
    progression.value = normalized
    return true
  }

  function handleProgressionAwarded(value: unknown): boolean {
    const event = normalizeProgressionAwardEvent(value)
    if (!event) return false
    const fresh = recentAwardsFromEvent(event, awardSequence)
    awardSequence += fresh.length
    recentAwards.value = [...fresh, ...recentAwards.value].slice(0, RECENT_AWARD_LIMIT)
    const levelUp = levelUpFromAward(event, `${event.petId}:${event.levelAfter}:${event.at}`)
    if (levelUp) levelUpEvent.value = levelUp
    return true
  }

  function setAchievementsSnapshot(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const raw = value as Partial<AchievementSnapshot>
    const generatedAt = raw.generatedAt
    const petId = raw.petId
    if (
      raw.schemaVersion !== 1
      || typeof petId !== 'string'
      || !isValidPetId(petId, 128)
      || !Number.isSafeInteger(generatedAt)
      || !Array.isArray(raw.achievements)
      || raw.achievements.length !== ACHIEVEMENT_DEFINITIONS.length
    ) return false

    const seen = new Set<string>()
    const normalized = raw.achievements.map(candidate => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null
      const item = candidate as Partial<AchievementSnapshot['achievements'][number]>
      const definition = (typeof item.id === 'string' ? ACHIEVEMENT_DEFINITION_BY_ID.get(item.id) : undefined)
      if (
        !definition
        || seen.has(definition.id)
        || item.version !== definition.version
        || item.titleKey !== definition.titleKey
        || item.descriptionKey !== definition.descriptionKey
        || item.visualReward !== definition.visualReward
        || typeof item.unlocked !== 'boolean'
        || (item.unlockedAt !== undefined && (!Number.isSafeInteger(item.unlockedAt) || item.unlockedAt < 0))
        || (item.tokenQuality !== 'none' && item.tokenQuality !== 'estimated' && item.tokenQuality !== 'exact')
        || item.category !== definition.category
        || typeof item.hidden !== 'boolean'
        || !item.progress
        || !Number.isSafeInteger(item.progress.current)
        || !Number.isSafeInteger(item.progress.target)
        || item.progress.current < 0
        || item.progress.target <= 0
      ) return null
      seen.add(definition.id)
      return {
        id: definition.id,
        version: definition.version,
        titleKey: definition.titleKey,
        descriptionKey: definition.descriptionKey,
        visualReward: definition.visualReward,
        unlocked: item.unlocked,
        ...(item.unlockedAt === undefined ? {} : { unlockedAt: item.unlockedAt }),
        tokenQuality: item.tokenQuality,
        category: definition.category,
        hidden: item.hidden,
        progress: { current: Math.min(item.progress.current, item.progress.target), target: item.progress.target },
      }
    })
    if (normalized.some(item => item === null)) return false
    const safeAchievements = normalized as AchievementSnapshot['achievements']
    achievements.value = {
      schemaVersion: 1,
      generatedAt: generatedAt as number,
      petId,
      totalUnlocked: safeAchievements.filter(item => item.unlocked).length,
      achievements: safeAchievements,
    }
    return true
  }

  function handleAchievementUnlocked(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const raw = value as Partial<AchievementUnlock>
    const definition = (typeof raw.achievementId === 'string' ? ACHIEVEMENT_DEFINITION_BY_ID.get(raw.achievementId) : undefined)
    const petId = raw.petId
    const unlockedAt = raw.unlockedAt
    const tokenQuality = raw.tokenQuality
    if (
      typeof petId !== 'string'
      || !isValidPetId(petId, 128)
      || !definition
      || raw.version !== definition.version
      || raw.titleKey !== definition.titleKey
      || raw.descriptionKey !== definition.descriptionKey
      || raw.visualReward !== definition.visualReward
      || typeof raw.achievementId !== 'string'
      || !Number.isSafeInteger(unlockedAt)
      || (unlockedAt as number) < 0
      || (tokenQuality !== 'none' && tokenQuality !== 'estimated' && tokenQuality !== 'exact')
    ) return false
    achievementUnlock.value = {
      petId,
      achievementId: definition.id,
      version: definition.version,
      unlockedAt: unlockedAt as number,
      titleKey: definition.titleKey,
      descriptionKey: definition.descriptionKey,
      visualReward: definition.visualReward,
      tokenQuality: tokenQuality as AchievementUnlock['tokenQuality'],
    }
    return true
  }

  async function initializeAchievements(): Promise<void> {
    try {
      const snapshot = await window.electronAPI?.initializeAchievements(selectedPet.value)
      if (snapshot) setAchievementsSnapshot(snapshot)
    } catch {
      achievements.value = null
    }
  }

  async function initializeProgression(): Promise<void> {
    try {
      const snapshot = await window.electronAPI?.initializeProgression(selectedPet.value)
      if (snapshot) setProgressionSnapshot(snapshot)
    } catch {
      progression.value = null
    }
  }

  async function setProgressionPet(petId: string): Promise<void> {
    if (!isValidPetId(petId, 128)) return
    try {
      const snapshot = await window.electronAPI?.setProgressionPet(petId)
      if (snapshot) setProgressionSnapshot(snapshot)
      await initializeAchievements()
    } catch {
      // Main remains authoritative; a later broadcast restores the snapshot.
    }
  }

  return {
    progression,
    achievements,
    achievementUnlock,
    recentAwards,
    levelUpEvent,
    handleProgressionAwarded,
    setProgressionSnapshot,
    setAchievementsSnapshot,
    handleAchievementUnlocked,
    initializeProgression,
    initializeAchievements,
    setProgressionPet,
  }
}
