<script setup lang="ts">
import { computed } from 'vue'
import { t, type TranslationKey } from '@/i18n'
import type { PermissionRisk } from '@/types/permission'

// Risk is conveyed three ways, never by colour alone: an icon with a distinct
// silhouette, the text label, and (on the bubble) a distinct border style.
const props = defineProps<{
  risk: PermissionRisk
  network?: boolean
}>()

const LABEL_KEYS: Record<PermissionRisk, TranslationKey> = {
  high: 'permissionRiskHigh',
  medium: 'permissionRiskMedium',
  low: 'permissionRiskLow',
  unknown: 'permissionRiskUnknown',
}

const ICON_PATHS: Record<PermissionRisk, string> = {
  // Triangle with exclamation.
  high: 'M8 2.4 14.4 13.6H1.6zM8 6.4v3.2M8 11.6v.4',
  // Eye: review before allowing.
  medium: 'M1.6 8S4 3.6 8 3.6 14.4 8 14.4 8 12 12.4 8 12.4 1.6 8 1.6 8ZM8 6.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6',
  // Check in a circle.
  low: 'M8 1.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 8 1.8ZM5.2 8.2l2 2 3.6-4',
  // Question mark in a circle.
  unknown: 'M8 1.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 8 1.8ZM6.2 6.4a1.8 1.8 0 1 1 2.6 1.6c-.5.3-.8.6-.8 1.2M8 11.4v.2',
}

const label = computed(() => t(LABEL_KEYS[props.risk]))
</script>

<template>
  <span class="permission-risk" :class="`risk-${risk}`">
    <svg class="permission-risk-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path :d="ICON_PATHS[risk]" />
    </svg>
    <span>{{ label }}</span>
    <span v-if="network" class="permission-risk-network">· {{ t('permission.network') }}</span>
  </span>
</template>

<style scoped>
.permission-risk {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--font-xs);
  font-weight: var(--weight-bold);
  line-height: var(--leading-tight);
}

.permission-risk-icon {
  flex: 0 0 auto;
}

.permission-risk-network {
  font-weight: var(--weight-medium);
}

.risk-high { color: var(--text-danger); }
.risk-medium { color: var(--state-warn-bright); }
.risk-low { color: var(--state-success); }
.risk-unknown { color: var(--text-secondary); }
</style>
