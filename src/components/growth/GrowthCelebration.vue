<script setup lang="ts">
// Level-up, evolution, achievement and +XP feedback on the pet window.
// Informational toasts (level/achievement) show even when the decorative
// reactions switch is off; only Do Not Disturb defers them, and everything
// deferred is replayed once as a single merged card when DND ends.
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { t, type TranslationKey } from '@/i18n'
import { useProgressionLabels } from '@/composables/useProgressionLabels'
import { useAgentStore } from '@/stores/agentStore'
import Icon from '@/components/ui/Icon.vue'
import {
  addAchievement,
  addLevelUp,
  batchIsEmpty,
  emptyBatch,
  mergeBatches,
  type CelebrationBatch,
} from '@/utils/celebration-batch'

const DISMISS_MS = 6_000
const XP_FLOAT_MS = 2_200

const store = useAgentStore()
const { evolutionLabel } = useProgressionLabels()
const visible = ref<CelebrationBatch>(emptyBatch())
const deferred = ref<CelebrationBatch>(emptyBatch())
const xpFloat = ref<{ id: number; amount: number } | null>(null)
let dismissTimer: ReturnType<typeof setTimeout> | null = null
let floatTimer: ReturnType<typeof setTimeout> | null = null
let floatSequence = 0

function show(batch: CelebrationBatch): void {
  visible.value = mergeBatches(visible.value, batch)
  if (dismissTimer) clearTimeout(dismissTimer)
  dismissTimer = setTimeout(() => { visible.value = emptyBatch() }, DISMISS_MS)
}

function route(batch: CelebrationBatch): void {
  if (store.dndEnabled) deferred.value = mergeBatches(deferred.value, batch)
  else show(batch)
}

watch(() => store.levelUpEvent, (event) => {
  if (event) route(addLevelUp(emptyBatch(), event))
})

watch(() => store.achievementUnlock, (unlock) => {
  if (!unlock) return
  route(addAchievement(emptyBatch(), {
    id: unlock.achievementId,
    titleKey: unlock.titleKey,
    descriptionKey: unlock.descriptionKey,
    visualReward: unlock.visualReward,
  }))
})

watch(() => store.dndEnabled, (enabled) => {
  if (enabled || batchIsEmpty(deferred.value)) return
  const batch = deferred.value
  deferred.value = emptyBatch()
  show(batch)
})

// +XP chip is decorative, so it follows the reactions switch and DND.
watch(() => store.recentAwards[0]?.id, () => {
  const latest = store.recentAwards[0]
  if (!latest || !store.reactionsActive) return
  const stamp = latest.at
  const amount = store.recentAwards.filter(item => item.at === stamp).reduce((sum, item) => sum + item.amount, 0)
  floatSequence += 1
  xpFloat.value = { id: floatSequence, amount }
  if (floatTimer) clearTimeout(floatTimer)
  floatTimer = setTimeout(() => { xpFloat.value = null }, XP_FLOAT_MS)
})

const levelTitle = computed(() => {
  const level = visible.value.level
  return level ? t('growth.levelUpTitle', { from: level.from, to: level.to }) : ''
})
const evolutionTitle = computed(() => {
  const stage = visible.value.level?.evolvedTo
  return stage ? t('growth.evolveTitle', { stage: evolutionLabel(stage) }) : ''
})
const achievementTitle = computed(() => {
  const items = visible.value.achievements
  if (items.length === 0) return ''
  if (items.length === 1) return t('growth.achievementOne', { title: t(items[0].titleKey as TranslationKey) })
  return t('growth.achievementMany', { count: items.length })
})
const achievementBody = computed(() => {
  const items = visible.value.achievements
  return items.length === 1 ? t(items[0].descriptionKey as TranslationKey) : ''
})
const rewardClass = computed(() => (
  visible.value.achievements.some(item => item.visualReward === 'badge') ? 'reward-badge' : 'reward-sparkle'
))

onBeforeUnmount(() => {
  if (dismissTimer) clearTimeout(dismissTimer)
  if (floatTimer) clearTimeout(floatTimer)
})
</script>

<template>
  <div class="growth-celebration" aria-hidden="false">
    <Transition name="growth-pop">
      <div v-if="xpFloat" :key="xpFloat.id" class="growth-xp-float" aria-hidden="true">{{ t('growth.xpFloat', { amount: xpFloat.amount }) }}</div>
    </Transition>
    <Transition name="growth-pop">
      <div
        v-if="!batchIsEmpty(visible)"
        class="growth-card"
        :class="rewardClass"
        role="status"
        aria-live="polite"
      >
        <div v-if="levelTitle" class="growth-card-row">
          <Icon name="growth" :size="16" />
          <div>
            <strong>{{ levelTitle }}</strong>
            <span v-if="evolutionTitle">{{ evolutionTitle }}</span>
          </div>
        </div>
        <div v-if="achievementTitle" class="growth-card-row">
          <Icon name="trophy" :size="16" />
          <div>
            <strong>{{ achievementTitle }}</strong>
            <span v-if="achievementBody">{{ achievementBody }}</span>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.growth-celebration {
  position: fixed;
  top: var(--space-2);
  left: 50%;
  z-index: calc(var(--z-sticky) + 30);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  width: max-content;
  max-width: calc(100vw - var(--space-4));
  transform: translateX(-50%);
  pointer-events: none;
}

.growth-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-accent);
  border-radius: var(--radius-md);
  background: var(--surface-overlay);
  box-shadow: var(--shadow-raised);
  color: var(--text-primary);
  font-size: var(--font-sm);
}

.growth-card-row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
}

.growth-card-row > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.growth-card-row span {
  color: var(--text-secondary);
  font-size: var(--font-xs);
}

.growth-card-row :deep(.icon) {
  margin-top: 2px;
  color: var(--accent-bright);
}

.reward-sparkle {
  animation: growth-sparkle 1.4s ease-out 1;
}

.reward-badge {
  animation: growth-badge 0.5s cubic-bezier(0.2, 1.4, 0.4, 1) 1;
}

.growth-xp-float {
  padding: 2px var(--space-3);
  border-radius: var(--radius-pill);
  background: var(--surface-overlay);
  color: var(--state-success);
  font-size: var(--font-md);
  font-weight: var(--weight-bold);
}

.growth-pop-enter-active,
.growth-pop-leave-active {
  transition: opacity var(--transition-base), transform var(--transition-base);
}

.growth-pop-enter-from,
.growth-pop-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

@keyframes growth-sparkle {
  0% { box-shadow: 0 0 0 0 var(--accent-glow); }
  60% { box-shadow: 0 0 0 10px transparent; }
  100% { box-shadow: var(--shadow-raised); }
}

@keyframes growth-badge {
  from { transform: scale(0.8); }
  to { transform: scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .reward-sparkle,
  .reward-badge {
    animation: none;
  }

  .growth-pop-enter-active,
  .growth-pop-leave-active {
    transition: none;
  }
}
</style>
