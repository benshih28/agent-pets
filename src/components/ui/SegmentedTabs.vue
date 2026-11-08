<script setup lang="ts">
// A segmented tablist with roving focus. The panel body is rendered by the
// caller; each tab id maps to `${idPrefix}-tab-${id}` and the caller marks its
// panel with `${idPrefix}-panel-${id}` so aria-controls resolves.
const props = withDefaults(defineProps<{
  tabs: Array<{ id: string; label: string; badge?: number | string }>
  ariaLabel?: string
  idPrefix?: string
}>(), {
  idPrefix: 'segmented',
})

const model = defineModel<string>({ required: true })

function onKeydown(event: KeyboardEvent): void {
  const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
  const edge = event.key === 'Home' ? 0 : event.key === 'End' ? props.tabs.length - 1 : -1
  if (!step && edge < 0) return
  event.preventDefault()
  const ids = props.tabs.map(tab => tab.id)
  const index = edge >= 0 ? edge : (ids.indexOf(model.value) + step + ids.length) % ids.length
  model.value = ids[index]
  document.getElementById(`${props.idPrefix}-tab-${ids[index]}`)?.focus()
}
</script>

<template>
  <div class="segmented" role="tablist" :aria-label="ariaLabel" @keydown="onKeydown">
    <button
      v-for="tab in tabs"
      :id="`${idPrefix}-tab-${tab.id}`"
      :key="tab.id"
      type="button"
      role="tab"
      class="segment"
      :class="{ active: model === tab.id }"
      :aria-selected="model === tab.id"
      :aria-controls="`${idPrefix}-panel-${tab.id}`"
      :tabindex="model === tab.id ? 0 : -1"
      @click="model = tab.id"
    >
      <span class="segment-label">{{ tab.label }}</span>
      <span v-if="tab.badge !== undefined && tab.badge !== 0" class="segment-badge">{{ tab.badge }}</span>
    </button>
  </div>
</template>

<style scoped>
.segmented {
  display: flex;
  gap: var(--space-1);
  padding: var(--space-1);
  border-radius: var(--radius-pill);
  background: var(--surface-sunken);
}

.segment {
  display: inline-flex;
  min-width: 0;
  min-height: 32px;
  flex: 1 1 0;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  padding: 0 var(--space-2);
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: var(--font-sm);
  font-weight: var(--weight-medium);
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.segment:hover:not(.active) {
  background: var(--surface-raised-hover);
  color: var(--text-primary);
}

.segment.active {
  background: var(--accent);
  color: var(--accent-bright);
}

.segment:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}

.segment-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.segment-badge {
  min-width: 18px;
  padding: 1px 6px;
  border-radius: var(--radius-pill);
  background: var(--accent-soft);
  color: var(--accent-text, var(--accent-bright));
  font-size: var(--font-xs);
  line-height: 1.4;
}

.segment.active .segment-badge {
  background: var(--accent-bright);
  color: var(--accent);
}

@media (prefers-reduced-motion: reduce) {
  .segment {
    transition: none;
  }
}

@media (forced-colors: active) {
  .segment.active {
    background: Highlight;
    color: HighlightText;
  }
}
</style>
