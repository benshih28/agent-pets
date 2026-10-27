<script setup lang="ts">
import { nextTick, onUnmounted, ref, watch } from 'vue'
import { t } from '@/i18n'
import Button from '@/components/ui/Button.vue'

// Replaces window.confirm(). The native dialog steals focus from the panel,
// which the main process reads as a blur and hides the panel out from under
// the confirmation; it also renders as a Windows message box on one platform
// and a macOS sheet on the other, so the same flow looked like two different
// products.
const props = withDefaults(defineProps<{
  open: boolean
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  focusCancel?: boolean
  tone?: 'default' | 'danger'
}>(), {
  focusCancel: false,
  tone: 'default',
})

const emit = defineEmits<{ confirm: []; cancel: [] }>()

const dialogRef = ref<HTMLElement | null>(null)

// Listen on the window rather than the dialog element: the scrim is a plain
// div, so it only receives key events once focus is already inside it. Esc
// has to work even if focusing the button lost a race with the transition.
function onKeydown(event: KeyboardEvent) {
  if (!props.open) return
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('cancel')
    return
  }
  if (event.key !== 'Tab') return
  // Keep Tab inside the dialog while it is open.
  const focusable = dialogRef.value?.querySelectorAll<HTMLElement>('button')
  if (!focusable?.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

// Focus the designated action on open so keyboard confirmation stays explicit.
watch(() => props.open, async (open) => {
  if (open) {
    window.addEventListener('keydown', onKeydown, true)
    await nextTick()
    const selector = props.focusCancel ? '[data-cancel]' : '[data-confirm]'
    ;(dialogRef.value?.querySelector(selector) as HTMLElement | null)?.focus()
  } else {
    window.removeEventListener('keydown', onKeydown, true)
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown, true)
})
</script>

<template>
  <Transition name="confirm">
    <div v-if="open" class="scrim" @click.self="emit('cancel')">
      <div
        ref="dialogRef"
        class="dialog"
        role="alertdialog"
        aria-modal="true"
        :aria-label="title"
      >
        <h2 class="title">{{ title }}</h2>
        <p v-if="message" class="message">{{ message }}</p>
        <slot />
        <div class="actions">
          <Button variant="secondary" size="sm" data-cancel @click="emit('cancel')">
            {{ cancelLabel || t('cancel') }}
          </Button>
          <Button
            :variant="tone === 'danger' ? 'danger' : 'primary'"
            size="sm"
            data-confirm
            @click="emit('confirm')"
          >
            {{ confirmLabel || t('confirm') }}
          </Button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.scrim {
  position: absolute;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4);
  background: var(--surface-scrim);
  backdrop-filter: blur(2px);
}

.dialog {
  display: flex;
  width: 100%;
  max-width: 300px;
  flex-direction: column;
  gap: var(--organic-space-2, var(--space-2));
  padding: var(--organic-space-4, var(--space-4));
  border: 1px solid var(--border-strong);
  border-radius: var(--organic-radius-md, var(--radius-md));
  background: var(--surface-overlay);
  box-shadow: var(--shadow-panel);
}

.title {
  margin: 0;
  color: var(--text-primary);
  font-family: var(--font-heading, var(--font-ui));
  font-size: var(--font-heading-sm, var(--font-md));
  font-weight: var(--weight-medium);
}

.message {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--font-body-sm, var(--font-sm));
  line-height: 1.5;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-1);
}

.confirm-enter-active,
.confirm-leave-active {
  transition: opacity var(--transition-fast);
}

.confirm-enter-from,
.confirm-leave-to {
  opacity: 0;
}
</style>
