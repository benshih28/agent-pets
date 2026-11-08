<script setup lang="ts">
import { nextTick, useId } from 'vue'
import { nextTabId, panelDomId, tabDomId, type TabOrientation } from '@/utils/tab-navigation'

// The one tablist. Implements the WAI-ARIA tabs pattern: roving tabindex,
// arrow keys (up/down when vertical), Home/End, aria-controls pointing at the
// matching <TabPanel>. Replaces the two hand-written tablists in StatusPanel.
//
// Usage:
//   <Tabs v-model="tab" :items="items" id-prefix="dash" :aria-label="…" />
//   <TabPanel id-prefix="dash" id="sessions" :active="tab === 'sessions'">…</TabPanel>
//
// Render a <nav> around <Tabs> if a navigation landmark is wanted; the
// tablist itself must keep role="tablist".
export interface TabItem {
  id: string
  label: string
  icon?: string
  disabled?: boolean
}

const props = withDefaults(defineProps<{
  items: TabItem[]
  ariaLabel: string
  orientation?: TabOrientation
  /** Shared with <TabPanel>; defaults to a unique id. */
  idPrefix?: string
  variant?: 'underline' | 'pill'
}>(), {
  orientation: 'horizontal',
  variant: 'underline',
})

const model = defineModel<string>({ required: true })

const uid = useId()
const prefix = () => props.idPrefix ?? `tabs-${uid}`

async function onKeydown(event: KeyboardEvent) {
  const target = nextTabId(props.items, model.value, event.key, props.orientation)
  if (!target) return
  event.preventDefault()
  model.value = target
  await nextTick()
  document.getElementById(tabDomId(prefix(), target))?.focus()
}
</script>

<template>
  <div
    class="tabs"
    :class="[`orientation-${orientation}`, `variant-${variant}`]"
    role="tablist"
    :aria-label="ariaLabel"
    :aria-orientation="orientation"
    @keydown="onKeydown"
  >
    <button
      v-for="item in items"
      :id="tabDomId(prefix(), item.id)"
      :key="item.id"
      type="button"
      class="tab"
      :class="{ active: model === item.id }"
      role="tab"
      :aria-selected="model === item.id"
      :aria-controls="panelDomId(prefix(), item.id)"
      :tabindex="model === item.id ? 0 : -1"
      :disabled="item.disabled"
      @click="model = item.id"
    >
      <slot name="tab" :item="item" :active="model === item.id">{{ item.label }}</slot>
    </button>
  </div>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: var(--space-1);
}

.orientation-vertical {
  flex-direction: column;
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--hit-min);
  padding: var(--space-1) var(--space-3);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: var(--font-sm);
  font-weight: var(--weight-medium);
  line-height: var(--leading-tight);
  cursor: pointer;
  transition:
    color var(--transition-fast),
    background var(--transition-fast),
    border-color var(--transition-fast);
}

.orientation-vertical .tab {
  justify-content: flex-start;
  width: 100%;
}

.tab:hover:not(:disabled) {
  background: var(--surface-raised-hover);
  color: var(--text-primary);
}

.tab:disabled {
  cursor: default;
  opacity: 0.55;
}

/* One active-indicator treatment per variant, from tokens only. */
.variant-pill .tab.active {
  background: var(--accent-soft);
  color: var(--accent-text, var(--accent-bright));
}

.variant-underline .tab {
  border-radius: 0;
}

.variant-underline.orientation-horizontal .tab.active {
  border-bottom-color: var(--accent);
  color: var(--text-primary);
}

.variant-underline.orientation-vertical .tab.active {
  border-left-color: var(--accent);
  color: var(--text-primary);
}

@media (prefers-contrast: more) {
  .tab.active {
    border-color: currentColor;
  }
}

@media (forced-colors: active) {
  .tab.active {
    border-color: Highlight;
    color: Highlight;
  }
}
</style>
