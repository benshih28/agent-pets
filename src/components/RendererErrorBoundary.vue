<script setup lang="ts">
import { onErrorCaptured, ref } from 'vue'
import { t } from '@/i18n'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'

const failed = ref(false)

onErrorCaptured(() => {
  // The error itself is reported by app.config.errorHandler; here we only
  // swap the broken tree for a recoverable message.
  failed.value = true
  return false
})

function reload() {
  if (window.electronAPI?.reloadRenderer) window.electronAPI.reloadRenderer()
  else window.location.reload()
}
</script>

<template>
  <div v-if="failed" class="renderer-error" role="alert">
    <Icon name="warning" :size="18" />
    <span>{{ t('reliability.renderer.errorMessage') }}</span>
    <Button size="sm" variant="primary" @click="reload">{{ t('reliability.renderer.reload') }}</Button>
  </div>
  <slot v-else />
</template>

<style scoped>
.renderer-error {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  background: var(--surface-overlay);
  color: var(--text-primary);
  font-size: var(--font-sm);
  pointer-events: auto;
}
</style>
