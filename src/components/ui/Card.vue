<script setup lang="ts">
withDefaults(defineProps<{
  tone?: 'neutral' | 'accent' | 'success' | 'claude' | 'warn'
  title?: string
}>(), {
  tone: 'neutral',
})
</script>

<template>
  <section class="card" :class="`tone-${tone}`">
    <header v-if="title || $slots.heading" class="card-heading">
      <h3 v-if="title" class="card-title">{{ title }}</h3>
      <slot name="heading" />
    </header>
    <slot />
  </section>
</template>

<style scoped>
.card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--organic-space-2, var(--space-2));
  padding: var(--organic-space-4, var(--space-4));
  border: 0;
  border-radius: var(--organic-radius-md, var(--radius-md));
  background: var(--surface-raised);
  box-shadow: var(--shadow-raised);
}

.card::before {
  display: none;
}

.tone-accent {
  background: var(--surface-raised);
}

.tone-success {
  background: var(--surface-raised);
}

.tone-claude {
  background: var(--surface-raised);
}

.tone-warn {
  background: var(--surface-raised);
}

.card-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.card-title {
  margin: 0;
  color: var(--text-secondary);
  font-family: var(--font-heading, var(--font-ui));
  font-size: var(--font-heading-sm, var(--font-xs));
  font-weight: var(--weight-bold);
  line-height: var(--leading-tight);
}

.tone-accent .card-title {
  color: var(--accent-text, var(--accent-bright));
}

.tone-success .card-title {
  color: var(--state-success);
}

.tone-claude .card-title {
  color: var(--accent-claude);
}

.tone-warn .card-title {
  color: var(--accent-text, var(--state-warn-bright));
}
</style>
