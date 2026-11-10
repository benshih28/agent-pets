<script setup lang="ts">
import { ref, useId } from 'vue'
import Icon from '@/components/ui/Icon.vue'

// The one text input. Replaces the bare <input> styles (.pet-rename-input and
// the settings search box). Supports a leading search icon, a clear button, an
// optional error line, and a character counter when maxlength is set.
const props = withDefaults(defineProps<{
  label?: string
  ariaLabel?: string
  placeholder?: string
  type?: 'text' | 'search'
  maxlength?: number
  error?: string
  clearLabel?: string
  size?: 'sm' | 'md'
  /** Shows a leading magnifier icon. */
  search?: boolean
  /** Escape is handled by the parent: stop it from reaching panel-level Esc handling. */
  consumeEscape?: boolean
}>(), {
  type: 'text',
  size: 'md',
  search: false,
})

const emit = defineEmits<{ enter: []; escape: []; blur: [] }>()
const model = defineModel<string>({ required: true })
const input = ref<HTMLInputElement | null>(null)
const errorId = `text-field-${useId()}-error`

defineExpose({ focus: () => input.value?.focus(), select: () => input.value?.select() })

function onEscape(event: KeyboardEvent): void {
  if (props.consumeEscape) event.preventDefault()
  emit('escape')
}

function clear(): void {
  model.value = ''
  input.value?.focus()
}
</script>

<template>
  <label class="text-field" :class="[`size-${size}`, { invalid: !!error, search }]">
    <span v-if="label" class="text-field-label">{{ label }}</span>
    <span class="text-field-control">
      <Icon v-if="search" class="text-field-icon" name="search" :size="14" />
      <input
        ref="input"
        v-model="model"
        class="text-field-input"
        :type="type"
        :placeholder="placeholder"
        :maxlength="maxlength"
        :aria-label="ariaLabel || label"
        :aria-invalid="error ? true : undefined"
        :aria-describedby="error ? errorId : undefined"
        @keydown.enter="emit('enter')"
        @keydown.escape="onEscape"
        @blur="emit('blur')"
      />
      <button v-if="clearLabel && model" type="button" class="text-field-clear" :aria-label="clearLabel" :title="clearLabel" @click.prevent="clear">
        <Icon name="close" :size="12" />
      </button>
    </span>
    <span v-if="error || maxlength" class="text-field-meta">
      <span v-if="error" :id="errorId" class="text-field-error" role="alert">{{ error }}</span>
      <span v-if="maxlength" class="text-field-count">{{ model.length }} / {{ maxlength }}</span>
    </span>
  </label>
</template>

<style scoped>
.text-field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-1);
}

.text-field-label {
  color: var(--text-secondary);
  font-size: var(--font-sm);
  font-weight: var(--weight-medium);
}

.text-field-control {
  position: relative;
  display: flex;
  align-items: center;
}

.text-field-icon {
  position: absolute;
  left: var(--space-3);
  color: var(--text-muted);
  pointer-events: none;
}

.text-field-input {
  width: 100%;
  min-width: 0;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-pill);
  background: var(--surface-raised-hover);
  color: var(--text-primary);
  font: inherit;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.size-md .text-field-input {
  padding: var(--space-2) var(--space-3);
  font-size: var(--font-sm);
}

.size-sm .text-field-input {
  padding: var(--space-1-5) var(--space-3);
  font-size: var(--font-sm);
}

.search .text-field-input {
  padding-left: 32px;
}

.text-field-input::placeholder {
  color: var(--text-muted);
}

.text-field-input:focus-visible {
  border-color: var(--accent);
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: 1px;
  box-shadow: 0 0 0 var(--focus-ring-width) var(--accent-glow);
}

.invalid .text-field-input {
  border-color: var(--text-danger);
}

.text-field-input::-webkit-search-cancel-button {
  display: none;
}

.text-field-clear {
  position: absolute;
  right: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: var(--hit-min);
  min-height: var(--hit-min);
  padding: var(--space-1);
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.text-field-clear:hover {
  background: var(--surface-raised-hover);
  color: var(--text-primary);
}

.text-field-clear:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
}

.text-field-meta {
  display: flex;
  justify-content: space-between;
  gap: var(--space-2);
  font-size: var(--font-xs);
}

.text-field-error {
  color: var(--text-danger);
}

.text-field-count {
  margin-left: auto;
  color: var(--text-muted);
}
</style>
