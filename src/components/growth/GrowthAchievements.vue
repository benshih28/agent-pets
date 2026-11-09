<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { locale, t, type TranslationKey } from '@/i18n'
import { useAgentStore } from '@/stores/agentStore'
import type { AchievementCategory, AchievementTokenQuality, AchievementView } from '@/types/achievement'
import { sectionAchievements, type AchievementFilter } from '@/utils/achievement-order'
import Card from '@/components/ui/Card.vue'
import Icon from '@/components/ui/Icon.vue'
import ProgressTrack from '@/components/ui/ProgressTrack.vue'
import ToggleRow from '@/components/ui/ToggleRow.vue'
import { formatDateDefault } from '@/utils/intl-format'

const store = useAgentStore()
const filter = ref<AchievementFilter>('all')
const FILTERS: Array<{ id: AchievementFilter; label: TranslationKey }> = [
  { id: 'all', label: 'growth.achievementsFilterAll' },
  { id: 'progress', label: 'growth.achievementsFilterProgress' },
  { id: 'unlocked', label: 'growth.achievementsFilterUnlocked' },
]
const CATEGORY_KEYS: Record<AchievementCategory, TranslationKey> = {
  milestone: 'growth.categoryMilestone',
  habit: 'growth.categoryHabit',
  explore: 'growth.categoryExplore',
  level: 'growth.categoryLevel',
}
const achievementQualityLabels: Partial<Record<AchievementTokenQuality, TranslationKey>> = {
  exact: 'achievementTokenExact', estimated: 'achievementTokenEstimated',
}

const sections = computed(() => sectionAchievements(store.achievements?.achievements ?? []))
const showProgress = computed(() => filter.value !== 'unlocked')
const showUnlocked = computed(() => filter.value !== 'progress')
// With nothing unlocked yet, point at the easiest first step.
const starterId = computed(() => (
  store.achievements && store.achievements.totalUnlocked === 0 ? sections.value.inProgress[0]?.id : undefined
))

// Unlocks newer than the last time this view was opened are marked "New".
// Per-viewer convenience only, so storage failures are simply ignored.
const SEEN_KEY = 'agent-pet-achievements-seen-at'
let seenAt = 0
try { seenAt = Number(localStorage.getItem(SEEN_KEY)) || 0 } catch { seenAt = 0 }

function isNew(unlockedAt?: number): boolean {
  return unlockedAt !== undefined && unlockedAt > seenAt
}

function unlockedDate(unlockedAt?: number): string {
  return unlockedAt === undefined
    ? ''
    : t('growth.unlockedOn', { date: formatDateDefault(unlockedAt, locale.value) })
}

function markSeen(): void {
  try { localStorage.setItem(SEEN_KEY, String(Date.now())) } catch { /* ignore */ }
}
onBeforeUnmount(markSeen)
onMounted(() => window.addEventListener('pagehide', markSeen))

function qualityLabel(quality: AchievementTokenQuality): string {
  const key = achievementQualityLabels[quality]
  return key ? t(key) : ''
}

function percent(item: AchievementView): number {
  return Math.round((item.progress.current / item.progress.target) * 100)
}
</script>

<template>
  <Card :title="t('achievements')" tone="accent">
    <template #heading>
      <span class="stat-readout">{{ store.achievements?.totalUnlocked ?? 0 }} / {{ store.achievements?.achievements.length ?? 0 }}</span>
    </template>
    <ToggleRow :model-value="store.achievementsEnabled" :label="t('achievementsEnable')" :help="t('achievementsEnableHelp')" @update:model-value="store.setAchievementsEnabled($event)" />

    <template v-if="store.achievements">
      <div class="achievement-filter" role="group" :aria-label="t('growth.achievementsFilterLabel')">
        <button
          v-for="option in FILTERS"
          :key="option.id"
          type="button"
          class="achievement-filter-button"
          :class="{ active: filter === option.id }"
          :aria-pressed="filter === option.id"
          @click="filter = option.id"
        >{{ t(option.label) }}</button>
      </div>

      <ul v-if="showProgress && sections.inProgress.length > 0" class="achievement-list" :aria-label="t('growth.achievementsFilterProgress')">
        <li v-for="item in sections.inProgress" :key="`${item.id}:${item.version}`" class="achievement-tile">
          <span class="achievement-icon"><Icon name="lock" :size="15" /></span>
          <span class="achievement-copy">
            <strong>{{ t(item.titleKey) }}<em v-if="item.id === starterId" class="achievement-new">{{ t('growth.achievementsHighlight') }}</em></strong>
            <span>{{ t(item.descriptionKey) }}</span>
            <small>{{ t(CATEGORY_KEYS[item.category]) }}</small>
            <ProgressTrack :value="percent(item)" size="sm" :aria-label="t(item.titleKey)" />
          </span>
          <span class="achievement-state">{{ t('growth.achievementProgress', { current: item.progress.current, target: item.progress.target }) }}</span>
        </li>
      </ul>

      <ul v-if="showUnlocked && sections.unlocked.length > 0" class="achievement-list" :aria-label="t('growth.achievementsFilterUnlocked')">
        <li v-for="item in sections.unlocked" :key="`${item.id}:${item.version}`" class="achievement-tile unlocked">
          <span class="achievement-icon unlocked"><Icon name="trophy" :size="15" /></span>
          <span class="achievement-copy">
            <strong>{{ t(item.titleKey) }}<em v-if="isNew(item.unlockedAt)" class="achievement-new">{{ t('growth.badgeNew') }}</em></strong>
            <span>{{ t(item.descriptionKey) }}</span>
            <small v-if="item.unlockedAt">{{ unlockedDate(item.unlockedAt) }}</small>
            <small v-if="item.tokenQuality !== 'none'">{{ t('achievementTokenQuality', { quality: qualityLabel(item.tokenQuality) }) }}</small>
          </span>
          <span class="achievement-state">{{ t('achievementUnlocked') }}</span>
        </li>
      </ul>

      <ul v-if="showProgress && sections.hidden.length > 0" class="achievement-list">
        <li v-for="item in sections.hidden" :key="`${item.id}:${item.version}`" class="achievement-tile">
          <span class="achievement-icon"><Icon name="lock" :size="15" /></span>
          <span class="achievement-copy">
            <strong>{{ t('growth.achievementHidden') }}</strong>
            <span>{{ t('growth.achievementHiddenHelp') }}</span>
          </span>
        </li>
      </ul>
    </template>
    <div v-else class="growth-unavailable" role="status">{{ t('achievementGalleryEmpty') }}</div>
  </Card>
</template>

<style scoped>
.achievement-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: var(--space-3) 0 0;
  padding: 0;
  list-style: none;
}

.achievement-filter {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

.achievement-filter-button {
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-pill);
  background: var(--surface-raised);
  color: var(--text-secondary);
  font: inherit;
  font-size: var(--font-sm);
  cursor: pointer;
}

.achievement-filter-button.active {
  border-color: var(--border-accent);
  background: var(--accent-wash);
  color: var(--text-primary);
}

.achievement-filter-button:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}

.achievement-new {
  margin-left: var(--space-2);
  padding: 0 var(--space-2);
  border-radius: var(--radius-pill);
  /* 文字放在實心強調色上用 accentHover／onAccent（驗證器保證 >= 4.5:1）。 */
  background: var(--accent-hover);
  color: var(--accent-on);
  font-size: var(--font-xs);
  font-style: normal;
}
</style>
