<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { t } from '@/i18n'

// Numeric input that only reports a value once it is valid. The draft is a
// string, so clearing the box never turns into 0; leaving the field (or
// pressing Enter) validates it, and a rejected value shows an inline error and
// snaps back to the last valid number. Esc reverts without an error.
const props = withDefaults(defineProps<{
  label: string
  min?: number
  max?: number
  step?: number
  help?: string
  error?: string
  rangeText?: string
  disabled?: boolean
  hideLabel?: boolean
}>(), {
  step: 1,
  disabled: false,
  hideLabel: false,
})

const model = defineModel<number>({ required: true })
const emit = defineEmits<{ commit: [value: number] }>()

const id = useId()
const draft = ref(String(model.value))
const localError = ref('')
const shownError = computed(() => props.error || localError.value)
const describedBy = computed(() => [props.help ? `${id}-help` : '', shownError.value ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined)

watch(model, value => {
  draft.value = String(value)
})

function rangeMessage(): string {
  if (props.rangeText) return props.rangeText
  if (props.min !== undefined && props.max !== undefined) return t('plugins.numberRange', { min: props.min, max: props.max })
  return t('plugins.numberInvalid')
}

function commit(): void {
  const raw = draft.value.trim()
  const parsed = Number(raw)
  const outOfRange = (props.min !== undefined && parsed < props.min) || (props.max !== undefined && parsed > props.max)
  if (raw === '' || !Number.isFinite(parsed) || outOfRange) {
    localError.value = raw === '' ? t('plugins.numberRequired') : rangeMessage()
    draft.value = String(model.value)
    return
  }
  localError.value = ''
  if (parsed !== model.value) {
    model.value = parsed
    emit('commit', parsed)
  }
}

function revert(): void {
  localError.value = ''
  draft.value = String(model.value)
}
</script>

<template>
  <div class="field">
    <label :for="id" class="field-label" :class="{ 'sr-only': hideLabel }">{{ label }}</label>
    <input
      :id="id"
      v-model="draft"
      class="field-input"
      type="number"
      inputmode="numeric"
      :min="min"
      :max="max"
      :step="step"
      :disabled="disabled"
      :aria-invalid="shownError ? true : undefined"
      :aria-describedby="describedBy"
      @input="localError = ''"
      @change="commit"
      @keydown.enter="commit"
      @keydown.esc="revert"
    />
    <small v-if="help" :id="`${id}-help`" class="field-help">{{ help }}</small>
    <small v-if="shownError" :id="`${id}-error`" class="field-error" role="alert">{{ shownError }}</small>
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
  color: var(--text-secondary);
  font-size: var(--font-xs);
}

.field-input {
  width: 100%;
  min-width: 0;
  min-height: 34px;
  padding: 0 var(--space-3);
  border: 1px solid var(--border-accent);
  border-radius: var(--radius-pill);
  background: var(--surface-raised-hover);
  color: var(--text-primary);
  font: inherit;
  font-size: var(--font-sm);
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.field-input:hover:not(:disabled) {
  border-color: var(--border-accent-strong);
}

.field-input:focus-visible {
  border-color: var(--accent);
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}

.field-input[aria-invalid="true"] {
  border-color: var(--state-error);
}

.field-input:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.field-help {
  color: var(--text-muted);
  font-size: var(--font-xs);
  line-height: 1.4;
}

.field-error {
  color: var(--state-error-soft);
  font-size: var(--font-xs);
  line-height: 1.4;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
