<script setup lang="ts">
import { computed, useId } from 'vue'

// The one text field. Wires label, help and error text to the control
// (aria-describedby / aria-invalid) so forms stay accessible without each
// caller re-implementing it. Extra attributes (placeholder, maxlength,
// autocomplete, @keydown, @blur …) fall through to the <input>.
defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  label?: string
  help?: string
  error?: string
  type?: 'text' | 'url' | 'search' | 'number' | 'email' | 'password' | 'date'
  /** Required when there is no visible label. */
  ariaLabel?: string
  disabled?: boolean
  size?: 'sm' | 'md'
}>(), {
  type: 'text',
  disabled: false,
  size: 'md',
})

const model = defineModel<string | number>({ default: '' })

const uid = useId()
const inputId = `input-${uid}`
const helpId = `${inputId}-help`
const errorId = `${inputId}-error`

const describedBy = computed(() => {
  const ids: string[] = []
  if (props.error) ids.push(errorId)
  if (props.help) ids.push(helpId)
  return ids.length ? ids.join(' ') : undefined
})
</script>

<template>
  <div class="field" :class="[`size-${size}`, { invalid: Boolean(error), disabled }]">
    <label v-if="label" class="field-label" :for="inputId">{{ label }}</label>
    <input
      v-bind="$attrs"
      :id="inputId"
      v-model="model"
      class="input"
      :type="type"
      :disabled="disabled"
      :aria-label="label ? undefined : ariaLabel"
      :aria-invalid="error ? true : undefined"
      :aria-describedby="describedBy"
    />
    <p v-if="error" :id="errorId" class="field-error" role="alert">{{ error }}</p>
    <p v-if="help" :id="helpId" class="field-help">{{ help }}</p>
  </div>
</template>

<style scoped>
.field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-1);
}

.field-label {
  color: var(--text-primary);
  font-size: var(--font-sm);
  font-weight: var(--weight-medium);
}

.input {
  width: 100%;
  min-width: 0;
  min-height: var(--hit-min);
  box-sizing: border-box;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface-raised);
  color: var(--text-primary);
  font: inherit;
  font-size: var(--font-md);
  transition:
    border-color var(--transition-fast),
    background var(--transition-fast);
}

.size-md .input {
  padding: var(--space-2) var(--space-3);
}

.size-sm .input {
  padding: var(--space-1) var(--space-2);
  font-size: var(--font-sm);
}

.input::placeholder {
  color: var(--text-muted);
}

.input:hover:not(:disabled) {
  border-color: var(--border-accent-strong);
}

.input:focus-visible {
  border-color: var(--accent);
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}

.invalid .input {
  border-color: var(--text-danger);
}

.disabled .input {
  cursor: not-allowed;
  opacity: 0.55;
}

.field-error,
.field-help {
  margin: 0;
  font-size: var(--font-sm);
  line-height: var(--leading-normal);
}

.field-error {
  color: var(--text-danger);
}

.field-help {
  color: var(--text-secondary);
}

@media (prefers-contrast: more) {
  .input {
    border-width: 2px;
  }
}
</style>
