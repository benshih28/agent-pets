<script setup lang="ts">
// A compact status/label pill. Tone is never the only signal: pass an `icon`
// (or put text in the slot) so the meaning survives colour-blindness and
// forced-colors mode.
import Icon from '@/components/ui/Icon.vue'

withDefaults(defineProps<{
  tone?: 'neutral' | 'success' | 'warn' | 'danger' | 'info'
  icon?: string
  title?: string
}>(), {
  tone: 'neutral',
})
</script>

<template>
  <span class="chip" :class="`tone-${tone}`" :title="title">
    <Icon v-if="icon" :name="icon" :size="12" />
    <slot />
  </span>
</template>

<style scoped>
.chip {
  display: inline-flex;
  max-width: 100%;
  align-items: center;
  gap: var(--space-1);
  padding: 2px var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--surface-sunken);
  color: var(--text-secondary);
  font-size: var(--font-xs);
  font-weight: var(--weight-medium);
  line-height: 1.4;
  white-space: nowrap;
}

.tone-success {
  background: color-mix(in srgb, var(--state-success) 12%, transparent);
  color: var(--state-success);
}

.tone-warn {
  background: color-mix(in srgb, var(--state-warn) 12%, transparent);
  color: var(--state-warn-bright);
}

.tone-danger {
  background: color-mix(in srgb, var(--state-error) 12%, transparent);
  color: var(--text-danger);
}

.tone-info {
  background: var(--accent-soft);
  color: var(--accent-text, var(--accent-bright));
}

@media (forced-colors: active) {
  .chip {
    border: 1px solid CanvasText;
    background: Canvas;
    color: CanvasText;
  }
}
</style>
