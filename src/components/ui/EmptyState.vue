<script setup lang="ts">
import Icon from '@/components/ui/Icon.vue'

// Shared "nothing here yet" block: icon, title, optional description and an
// action slot. Replaces the per-view empty/unavailable treatments.
withDefaults(defineProps<{
  title: string
  description?: string
  icon?: string
  /** "inline" drops the surrounding padding for use inside a Card. */
  compact?: boolean
}>(), {
  compact: false,
})
</script>

<template>
  <div class="empty" :class="{ compact }">
    <span v-if="icon" class="empty-icon"><Icon :name="icon" :size="24" /></span>
    <p class="empty-title">{{ title }}</p>
    <p v-if="description" class="empty-description">{{ description }}</p>
    <div v-if="$slots.default" class="empty-actions"><slot /></div>
  </div>
</template>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-5) var(--space-4);
  text-align: center;
}

.empty.compact {
  padding: var(--space-3) 0;
}

.empty-icon {
  display: inline-flex;
  color: var(--text-muted);
}

.empty-title {
  margin: 0;
  color: var(--text-primary);
  font-size: var(--font-md);
  font-weight: var(--weight-medium);
}

.empty-description {
  max-width: 28em;
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--font-sm);
  line-height: var(--leading-relaxed);
}

.empty-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-2);
  margin-top: var(--space-1);
}
</style>
