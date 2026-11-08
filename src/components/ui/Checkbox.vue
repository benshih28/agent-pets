<script setup lang="ts">
import { computed, useId } from 'vue'
import Icon from '@/components/ui/Icon.vue'

// Plain checkbox with an optional help line. Use ToggleRow for on/off
// settings; use Checkbox for selections inside forms and dialogs.
const props = withDefaults(defineProps<{
  label: string
  help?: string
  disabled?: boolean
}>(), {
  disabled: false,
})

const model = defineModel<boolean>({ required: true })

const helpId = `checkbox-${useId()}-help`
const describedBy = computed(() => (props.help ? helpId : undefined))
</script>

<template>
  <label class="checkbox" :class="{ disabled }">
    <span class="box-wrap">
      <input
        v-model="model"
        type="checkbox"
        :disabled="disabled"
        :aria-describedby="describedBy"
      />
      <span class="box"><Icon name="check" :size="12" /></span>
    </span>
    <span class="copy">
      <span class="label">{{ label }}</span>
      <span v-if="help" :id="helpId" class="help">{{ help }}</span>
    </span>
  </label>
</template>

<style scoped>
.checkbox {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  min-height: var(--hit-min);
  padding: var(--space-1) 0;
  cursor: pointer;
}

.checkbox.disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.box-wrap {
  position: relative;
  display: inline-flex;
  flex: 0 0 auto;
  margin-top: 1px;
}

.box-wrap input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: inherit;
}

.box {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface-raised);
  color: transparent;
  transition:
    background var(--transition-fast),
    border-color var(--transition-fast),
    color var(--transition-fast);
}

.box-wrap input:checked + .box {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--accent-bright);
}

.box-wrap input:focus-visible {
  outline: none;
}

.box-wrap input:focus-visible + .box {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}

.copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.label {
  color: var(--text-primary);
  font-size: var(--font-sm);
  font-weight: var(--weight-medium);
}

.help {
  color: var(--text-secondary);
  font-size: var(--font-sm);
  line-height: var(--leading-normal);
}

@media (forced-colors: active) {
  .box-wrap input:checked + .box {
    border-color: Highlight;
    background: Highlight;
    color: HighlightText;
  }
}
</style>
