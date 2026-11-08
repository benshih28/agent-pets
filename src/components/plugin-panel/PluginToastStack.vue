<script setup lang="ts">
import { t } from '@/i18n'
import Toast from '@/components/ui/Toast.vue'

// Fixed-position stack of plugin feedback. Each message is the shared Toast
// primitive; the stack only positions it and adds the collapsible technical
// code for errors. Being fixed means a message never moves the layout.
export interface PluginToastItem {
  id: number
  tone: 'success' | 'error' | 'info'
  text: string
  detail?: string
  action?: { label: string }
  sticky: boolean
}

defineProps<{ toasts: PluginToastItem[] }>()
const emit = defineEmits<{ dismiss: [id: number]; action: [id: number] }>()

const toneMap = { success: 'success', error: 'danger', info: 'neutral' } as const
</script>

<template>
  <div class="toast-stack">
    <TransitionGroup name="toast">
      <div v-for="toast in toasts" :key="toast.id" class="toast-slot">
        <Toast
          :tone="toneMap[toast.tone]"
          :message="toast.text"
          :action-label="toast.action?.label"
          @action="emit('action', toast.id)"
          @dismiss="emit('dismiss', toast.id)"
        >
          <details v-if="toast.detail" class="toast-detail">
            <summary>{{ t('plugins.technicalDetails') }}</summary>
            <code>{{ toast.detail }}</code>
          </details>
        </Toast>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-stack {
  position: fixed;
  right: var(--space-3);
  bottom: var(--space-3);
  left: var(--space-3);
  z-index: var(--z-toast);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  pointer-events: none;
}

.toast-slot {
  width: 100%;
  max-width: 420px;
  pointer-events: auto;
}

.toast-detail {
  color: var(--text-muted);
  font-size: var(--font-xs);
}

.toast-detail summary {
  cursor: pointer;
}

.toast-detail code {
  overflow-wrap: anywhere;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity var(--transition-base), transform var(--transition-base);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(var(--space-2));
}

@media (prefers-reduced-motion: reduce) {
  .toast-enter-active,
  .toast-leave-active {
    transition: none;
  }

  .toast-enter-from,
  .toast-leave-to {
    transform: none;
  }
}
</style>
