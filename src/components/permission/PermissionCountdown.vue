<script setup lang="ts">
import { computed } from 'vue'
import { t } from '@/i18n'
import type { PermissionRequestView } from '@/types/permission'
import { PERMISSION_CLOCK_INTERVAL_MS } from '@/components/permission/usePermissionClock'
import {
  formatDuration,
  permissionIsUrgent,
  permissionRemainingFraction,
  permissionRemainingMs,
} from '@/utils/permission-view'

const props = defineProps<{
  request: Pick<PermissionRequestView, 'expiresAt' | 'receivedAt'>
  now: number
}>()

const remaining = computed(() => formatDuration(permissionRemainingMs(props.request, props.now)))
const urgent = computed(() => permissionIsUrgent(props.request, props.now))
const percent = computed(() => Math.round(permissionRemainingFraction(props.request, props.now) * 100))
// 補間剛好一個時鐘間隔，倒數條才會連續滑動而不是一格一格跳。
const fillTransition = `${PERMISSION_CLOCK_INTERVAL_MS}ms`
</script>

<template>
  <div class="permission-countdown" :class="{ urgent }">
    <span
      class="permission-countdown-track"
      role="progressbar"
      :aria-label="t('permission.remaining', { time: remaining })"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="percent"
    >
      <span class="permission-countdown-fill" :style="{ width: `${percent}%`, transitionDuration: fillTransition }" />
    </span>
    <span class="permission-countdown-text">
      {{ t('permission.remaining', { time: remaining }) }}<template v-if="urgent"> · {{ t('permission.expiringSoon') }}</template>
    </span>
  </div>
</template>

<style scoped>
.permission-countdown {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0 1px var(--space-2);
}

.permission-countdown-track {
  display: block;
  height: 4px;
  overflow: hidden;
  border-radius: var(--radius-pill);
  background: var(--border-strong);
}

.permission-countdown-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--state-info);
  transition-property: width;
  transition-timing-function: linear;
}

.permission-countdown-text {
  color: var(--text-secondary);
  font-size: var(--font-xs);
  font-variant-numeric: tabular-nums;
}

.permission-countdown.urgent .permission-countdown-fill {
  background: var(--state-warn-bright);
}

.permission-countdown.urgent .permission-countdown-text {
  color: var(--state-warn-bright);
  font-weight: var(--weight-bold);
}

@media (prefers-reduced-motion: reduce) {
  .permission-countdown-fill {
    transition: none;
  }
}

@media (prefers-contrast: more) {
  .permission-countdown-track {
    outline: 1px solid currentColor;
  }
}
</style>
