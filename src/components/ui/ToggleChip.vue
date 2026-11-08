<script setup lang="ts">
import Icon from '@/components/ui/Icon.vue'

// A compact on/off chip for global quick switches (notifications, DND, sound).
// Exposes switch semantics (role=switch + aria-checked) and shows state with an
// icon and text, not colour alone. When another setting overrides it, pass
// `overridden` plus a reason so the chip reads as disabled but explained.
const props = defineProps<{
  label: string
  /** Visible state text, e.g. "On" / "Off". */
  stateLabel: string
  icon: string
  /** Icon shown while off (defaults to the on icon). */
  iconOff?: string
  overridden?: boolean
  overriddenLabel?: string
}>()

const model = defineModel<boolean>({ required: true })

function toggle(): void {
  if (!props.overridden) model.value = !model.value
}
</script>

<template>
  <button
    type="button"
    class="toggle-chip"
    :class="{ on: model, overridden }"
    role="switch"
    :aria-checked="model"
    :aria-disabled="overridden ? true : undefined"
    :title="overridden ? overriddenLabel : undefined"
    @click="toggle"
  >
    <Icon :name="model ? icon : (iconOff ?? icon)" :size="16" />
    <span class="chip-copy">
      <span class="chip-label">{{ label }}</span>
      <span class="chip-state">{{ overridden && overriddenLabel ? overriddenLabel : stateLabel }}</span>
    </span>
  </button>
</template>

<style scoped>
.toggle-chip {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1.5px solid var(--border-strong);
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--text-secondary);
  font-family: var(--font-ui);
  text-align: left;
  cursor: pointer;
  transition: color var(--transition-fast), background var(--transition-fast), border-color var(--transition-fast);
}

.toggle-chip:hover:not(.overridden) {
  background: var(--surface-raised-hover);
  color: var(--text-primary);
}

.toggle-chip.on {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-text);
}

.toggle-chip.overridden {
  cursor: not-allowed;
  opacity: 0.6;
}

.toggle-chip:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}

.chip-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 1px;
}

.chip-label {
  overflow: hidden;
  font-size: var(--font-body-sm, var(--font-xs));
  font-weight: var(--weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chip-state {
  overflow: hidden;
  font-size: var(--font-label, var(--font-xs));
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
