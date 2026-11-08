<script setup lang="ts">
// Loading placeholder. Static (no shimmer) under prefers-reduced-motion.
// Decorative: the surrounding region should carry aria-busy="true".
withDefaults(defineProps<{
  variant?: 'line' | 'block' | 'circle'
  width?: string
  height?: string
  /** Render N stacked lines (variant "line" only). */
  lines?: number
}>(), {
  variant: 'line',
  lines: 1,
})
</script>

<template>
  <div v-if="variant === 'line' && lines > 1" class="stack" aria-hidden="true">
    <span
      v-for="n in lines"
      :key="n"
      class="skeleton variant-line"
      :style="{ width: n === lines ? '60%' : width, height }"
    />
  </div>
  <span
    v-else
    class="skeleton"
    :class="`variant-${variant}`"
    :style="{ width, height }"
    aria-hidden="true"
  />
</template>

<style scoped>
.stack {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: 100%;
}

.skeleton {
  display: block;
  background: linear-gradient(
    90deg,
    var(--surface-raised-hover) 25%,
    var(--border-subtle) 50%,
    var(--surface-raised-hover) 75%
  );
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.4s var(--ease-standard) infinite;
}

.variant-line {
  width: 100%;
  height: var(--font-md);
  border-radius: var(--radius-sm);
}

.variant-block {
  width: 100%;
  height: 64px;
  border-radius: var(--radius-md);
}

.variant-circle {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-pill);
}

@keyframes skeleton-shimmer {
  from { background-position: 100% 0; }
  to { background-position: -100% 0; }
}

@media (prefers-reduced-motion: reduce) {
  .skeleton {
    animation: none;
    background: var(--surface-raised-hover);
    opacity: 0.6;
  }
}
</style>
