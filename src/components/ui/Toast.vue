<script setup lang="ts">
import Icon from '@/components/ui/Icon.vue'
import Button from '@/components/ui/Button.vue'
import { t } from '@/i18n'

// One transient message: replaces the hand-rolled .pet-toast variants.
// "danger" toasts are announced assertively (role="alert"); everything else
// is polite (role="status"). The countdown bar is static under
// prefers-reduced-motion.
withDefaults(defineProps<{
  tone?: 'neutral' | 'accent' | 'success' | 'warn' | 'danger'
  title?: string
  message?: string
  actionLabel?: string
  /** Auto-dismiss time in ms; drives the countdown bar. 0 = persistent. */
  duration?: number
  dismissible?: boolean
}>(), {
  tone: 'neutral',
  duration: 0,
  dismissible: true,
})

const emit = defineEmits<{ action: []; dismiss: [] }>()

const icons: Record<string, string> = {
  neutral: 'info',
  accent: 'info',
  success: 'check',
  warn: 'warning',
  danger: 'warning',
}
</script>

<template>
  <div class="toast" :class="`tone-${tone}`" :role="tone === 'danger' ? 'alert' : 'status'">
    <span class="toast-icon"><Icon :name="icons[tone]" :size="16" /></span>
    <div class="toast-body">
      <strong v-if="title" class="toast-title">{{ title }}</strong>
      <span v-if="message" class="toast-message">{{ message }}</span>
      <slot />
    </div>
    <Button v-if="actionLabel" variant="secondary" size="sm" @click="emit('action')">{{ actionLabel }}</Button>
    <Button
      v-if="dismissible"
      variant="ghost"
      size="sm"
      icon-only
      :aria-label="t('close')"
      @click="emit('dismiss')"
    >
      <Icon name="close" :size="14" />
    </Button>
    <span
      v-if="duration > 0"
      class="toast-countdown"
      :style="{ animationDuration: `${duration}ms` }"
      aria-hidden="true"
    />
  </div>
</template>

<style scoped>
.toast {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  overflow: hidden;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  background: var(--surface-overlay);
  box-shadow: var(--shadow-raised);
  color: var(--text-primary);
}

.toast-icon {
  display: inline-flex;
  flex: 0 0 auto;
}

.toast-body {
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 2px;
}

.toast-title {
  font-size: var(--font-sm);
  font-weight: var(--weight-medium);
}

.toast-message {
  color: var(--text-secondary);
  font-size: var(--font-sm);
  line-height: var(--leading-normal);
  overflow-wrap: anywhere;
}

.tone-accent .toast-icon { color: var(--accent); }
.tone-success .toast-icon { color: var(--text-success); }
.tone-warn .toast-icon { color: var(--text-warning); }
.tone-danger .toast-icon { color: var(--text-danger); }
.tone-danger { border-color: var(--text-danger); }

.toast-countdown {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 2px;
  background: var(--accent);
  transform-origin: left;
  animation: toast-countdown linear forwards;
}

@keyframes toast-countdown {
  from { transform: scaleX(1); }
  to { transform: scaleX(0); }
}

@media (prefers-reduced-motion: reduce) {
  .toast-countdown {
    animation: none;
    opacity: 0.4;
  }
}
</style>
