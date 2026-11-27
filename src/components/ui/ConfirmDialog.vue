<script setup lang="ts">
import { t } from '@/i18n'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'

// Not window.confirm(): the native dialog steals focus, which the main process reads as a blur and hides the panel.
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
