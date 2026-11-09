<script setup lang="ts">
// One badge for plugin / DEV / status / quota chips. State is carried by the
// label (and the optional dot shape) as well as colour, so it never relies on
// colour alone.
withDefaults(defineProps<{
  tone?: 'neutral' | 'accent' | 'success' | 'warn' | 'danger'
  /** Leading dot, for status badges. */
  dot?: boolean
  /** Compact count pill (e.g. unread). Content should be a short number. */
  count?: boolean
}>(), {
  tone: 'neutral',
  dot: false,
  count: false,
})
</script>

<template>
  <span class="badge" :class="[`tone-${tone}`, { count }]">
    <span v-if="dot" class="dot" aria-hidden="true" />
    <slot />
  </span>
</template>

<style scoped>
.badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  max-width: 100%;
  padding: 1px var(--space-2);
  border: 1px solid transparent;
  border-radius: var(--radius-pill);
  font-size: var(--font-xs);
  font-weight: var(--weight-medium);
  line-height: var(--leading-normal);
  white-space: nowrap;
}

.badge.count {
  min-width: calc(var(--font-xs) + var(--space-3));
  justify-content: center;
  padding-inline: var(--space-1);
}

.dot {
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: var(--radius-pill);
  background: currentColor;
}

.tone-neutral {
  background: var(--surface-raised-hover);
  border-color: var(--border-subtle);
  color: var(--text-secondary);
}

.tone-accent {
  background: var(--accent-soft);
  color: var(--accent-text, var(--accent-bright));
}

.tone-success {
  background: color-mix(in srgb, var(--state-success) 12%, transparent);
  color: var(--text-success);
}

.tone-warn {
  background: color-mix(in srgb, var(--state-warn-bright) 12%, transparent);
  color: var(--text-warning);
}

.tone-danger {
  background: color-mix(in srgb, var(--state-error) 12%, transparent);
  color: var(--text-danger);
}

@media (prefers-contrast: more) {
  .badge {
    border-color: currentColor;
  }
}

@media (forced-colors: active) {
  .badge {
    border-color: CanvasText;
  }
}
</style>
