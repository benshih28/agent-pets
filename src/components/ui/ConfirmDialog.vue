<script setup lang="ts">
import { t } from '@/i18n'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'

// Replaces window.confirm(). The native dialog steals focus from the panel,
// which the main process reads as a blur and hides the panel out from under
// the confirmation; it also renders as a Windows message box on one platform
// and a macOS sheet on the other, so the same flow looked like two different
// products. Behaviour (Esc, focus trap, focus restore, inert background) is
// provided by Dialog / useDialogA11y.
withDefaults(defineProps<{
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
</script>

<template>
  <Dialog
    :open="open"
    :title="title"
    :description="message"
    role="alertdialog"
    :initial-focus="focusCancel ? '[data-cancel]' : '[data-confirm]'"
    @close="emit('cancel')"
  >
    <slot />
    <template #footer>
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
    </template>
  </Dialog>
</template>
