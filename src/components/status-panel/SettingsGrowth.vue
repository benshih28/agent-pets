<script setup lang="ts">
import { computed } from 'vue'
import { t } from '@/i18n'
import { useAgentStore } from '@/stores/agentStore'
import type { AchievementTokenQuality, AchievementTranslationKey } from '@/types/achievement'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import Icon from '@/components/ui/Icon.vue'
import ProgressTrack from '@/components/ui/ProgressTrack.vue'
import ToggleRow from '@/components/ui/ToggleRow.vue'

const store = useAgentStore()
const progression = computed(() => store.progression)
const evolutionLabels = computed<Record<string, ReturnType<typeof t>>>(() => ({
  egg: t('evolutionEgg'), baby: t('evolutionBaby'), teen: t('evolutionTeen'), adult: t('evolutionAdult'), master: t('evolutionMaster'),
}))
const evolutionLabel = computed(() => progression.value ? evolutionLabels.value[progression.value.evolutionStage] : '')
const progressionPercent = computed(() => {
  if (!progression.value) return 0
  return Math.min(100, Math.round((progression.value.xpIntoLevel / progression.value.xpToNext) * 100))
})
const moodStage = computed(() => {
  if (store.mood >= 90) return t('moodOverdrive')
  if (store.mood >= 70) return t('moodRadiant')
  if (store.mood >= 40) return t('moodCharged')
  return t('moodResting')
})
const achievementQualityLabels: Partial<Record<AchievementTokenQuality, Parameters<typeof t>[0]>> = {
  exact: 'achievementTokenExact', estimated: 'achievementTokenEstimated',
}

function achievementText(key: AchievementTranslationKey): string {
  return t(key)
}

function achievementQualityLabel(quality: AchievementTokenQuality): string {
  const key = achievementQualityLabels[quality]
  return key ? t(key) : ''
}
</script>

<template>
  <Card :title="t('petMood')">
    <template #heading>
      <Button size="sm" variant="secondary" :title="t('resetBaseline')" @click="store.resetMood()">{{ t('reset') }}</Button>
    </template>
    <div class="stat-row"><span class="stat-readout">{{ store.mood }} · {{ moodStage }}</span></div>
    <ProgressTrack :value="store.mood" tone="success" :aria-label="t('petMood')" />
  </Card>

  <template v-if="progression">
    <Card :title="t('growth')" tone="accent">
      <template #heading><span class="stat-readout">{{ progression.totalXp }} XP</span></template>
      <div class="stat-row"><span class="stat-readout">Lv {{ progression.level }} · {{ evolutionLabel }}</span></div>
      <ProgressTrack :value="progressionPercent" :aria-label="t('growth')" />
      <div class="stat-row muted">
        <span>{{ t('toNextLevel', { value: `${progression.xpIntoLevel} / ${progression.xpToNext}` }) }}</span>
        <span v-if="progression.currentStreak > 0">{{ t('dayStreak', { days: progression.currentStreak }) }}</span>
        <span v-else>{{ t('startStreak') }}</span>
      </div>
    </Card>
    <Card :title="t('moodVisuals')">
      <ToggleRow :model-value="store.moodVisualsEnabled" :label="t('moodVisuals')" :help="t('moodVisualsHelp')" @update:model-value="store.setMoodVisualsEnabled($event)" />
    </Card>
  </template>
  <div v-else class="growth-unavailable" role="status">{{ t('growthDataUnavailable') }}</div>

  <Card :title="t('achievements')" tone="accent">
    <template #heading>
      <span class="stat-readout">{{ store.achievements?.totalUnlocked ?? 0 }} / {{ store.achievements?.achievements.length ?? 0 }}</span>
    </template>
    <ToggleRow :model-value="store.achievementsEnabled" :label="t('achievementsEnable')" :help="t('achievementsEnableHelp')" @update:model-value="store.setAchievementsEnabled($event)" />
    <div v-if="store.achievements" class="achievement-grid">
      <article
        v-for="achievement in store.achievements.achievements"
        :key="`${achievement.id}:${achievement.version}`"
        class="achievement-tile"
        :class="{ unlocked: achievement.unlocked }"
        :aria-label="`${achievementText(achievement.titleKey)} · ${achievement.unlocked ? t('achievementUnlocked') : t('achievementLocked')}`"
      >
        <span class="achievement-icon" :class="{ unlocked: achievement.unlocked }"><Icon :name="achievement.unlocked ? 'trophy' : 'lock'" :size="15" /></span>
        <span class="achievement-copy">
          <strong>{{ achievementText(achievement.titleKey) }}</strong>
          <span>{{ achievementText(achievement.descriptionKey) }}</span>
          <small v-if="achievement.tokenQuality !== 'none'">{{ t('achievementTokenQuality', { quality: achievementQualityLabel(achievement.tokenQuality) }) }}</small>
        </span>
        <span class="achievement-state">{{ achievement.unlocked ? t('achievementUnlocked') : t('achievementLocked') }}</span>
      </article>
    </div>
    <div v-else class="growth-unavailable" role="status">{{ t('achievementGalleryEmpty') }}</div>
  </Card>
</template>
