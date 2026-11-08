<script setup lang="ts">
import { computed } from 'vue'
import { useAgentStore } from '@/stores/agentStore'
import { t, type TranslationKey } from '@/i18n'
import { permissionSourceName } from '@/utils/permission-source'
import type { PermissionOutcomeKind } from '@/types/permission'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'

const store = useAgentStore()
const outcome = computed(() => store.permissionOutcome)

const KEYS: Record<PermissionOutcomeKind, TranslationKey> = {
  expired: 'permission.outcomeExpired',
  cancelled: 'permission.outcomeCancelled',
  delivery_failed: 'permission.outcomeDeliveryFailed',
  conflict: 'permission.outcomeConflict',
  error: 'permission.outcomeError',
}
</script>

<template>
  <div v-if="outcome" class="permission-outcome-notice" role="status" aria-live="polite">
    <Icon name="warning" :size="18" />
    <span class="permission-outcome-notice-text">
      {{ t(KEYS[outcome.kind], { source: permissionSourceName(outcome.agentId) }) }}
    </span>
    <Button variant="ghost" size="sm" @click="store.dismissPermissionOutcome()">{{ t('permission.dismiss') }}</Button>
  </div>
</template>

<style scoped>
.permission-outcome-notice {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--state-warn);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
  color: var(--text-primary);
  font-size: var(--font-sm);
  line-height: var(--leading-normal);
}

.permission-outcome-notice-text {
  min-width: 0;
  flex: 1;
}
</style>
