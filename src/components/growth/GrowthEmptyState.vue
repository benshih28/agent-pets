<script setup lang="ts">
// One empty/error/loading block for the Growth, History and Usage views, so
// "nothing yet", "failed" and "loading" read as the same family instead of a
// bare line of text. Keeps a live region so state changes are announced.
import Icon from '@/components/ui/Icon.vue'

withDefaults(defineProps<{
  title: string
  description?: string
  icon?: string
  tone?: 'neutral' | 'error'
  busy?: boolean
}>(), {
  icon: 'growth',
  tone: 'neutral',
})
</script>

<template>
  <div class="growth-empty" :class="`tone-${tone}`" role="status" aria-live="polite" :aria-busy="busy ? 'true' : undefined">
    <span class="growth-empty-icon" aria-hidden="true"><Icon :name="icon" :size="20" /></span>
    <strong class="growth-empty-title">{{ title }}</strong>
    <p v-if="description" class="growth-empty-desc">{{ description }}</p>
    <div v-if="$slots.default" class="growth-empty-actions"><slot /></div>
  </div>
</template>

<style scoped>
.growth-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-4);
  border: 1px dashed var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
  color: var(--text-secondary);
  text-align: center;
}

.growth-empty-icon {
  color: var(--accent-bright);
}

.tone-error .growth-empty-icon,
.tone-error .growth-empty-title {
  color: var(--state-error);
}

.growth-empty-title {
  color: var(--text-primary);
  font-size: var(--font-md);
  font-weight: var(--weight-bold);
}

.growth-empty-desc {
  margin: 0;
  max-width: 28em;
  font-size: var(--font-sm);
  line-height: var(--leading-relaxed);
}

.growth-empty-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-2);
  margin-top: var(--space-1);
}
</style>
