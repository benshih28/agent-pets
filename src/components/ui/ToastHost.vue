<script setup lang="ts">
import { useToast } from '@/composables/useToast'
import Toast from '@/components/ui/Toast.vue'

// Mount once near the app root. Renders the useToast() queue.
const { toasts, dismiss } = useToast()

function runAction(id: number, handler?: () => void) {
  handler?.()
  dismiss(id)
}
</script>

<template>
  <div v-if="toasts.length" class="toast-host">
    <Toast
      v-for="item in toasts"
      :key="item.id"
      :tone="item.tone"
      :title="item.title"
      :message="item.message"
      :action-label="item.actionLabel"
      :duration="item.duration"
      @action="runAction(item.id, item.onAction)"
      @dismiss="dismiss(item.id)"
    />
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  right: var(--space-3);
  bottom: var(--space-3);
  left: var(--space-3);
  z-index: var(--z-toast);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  pointer-events: none;
}

.toast-host > * {
  pointer-events: auto;
}
</style>
