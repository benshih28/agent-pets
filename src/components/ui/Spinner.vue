<script setup lang="ts">
// A small inline activity ring. It is decorative (aria-hidden); the owner of
// the busy region should set aria-busy. Reduced motion falls back to a static
// partial ring so the state stays visible without spinning.
withDefaults(defineProps<{ size?: number }>(), { size: 14 })
</script>

<template>
  <span class="spinner" :style="{ width: `${size}px`, height: `${size}px` }" aria-hidden="true" />
</template>

<style scoped>
.spinner {
  display: inline-block;
  flex: 0 0 auto;
  border: 2px solid var(--border-strong);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spinner-turn 0.8s linear infinite;
}

@keyframes spinner-turn {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation: none;
  }
}
</style>
