<script setup lang="ts">
// 權限佇列總覽：依動作合併後的待處理清單，以及兩段式「全部拒絕」。
// 沒有「全部允許」。確認狀態只屬於這個清單，清單收起（元件卸載）時一併重設。
import { computed, onBeforeUnmount, ref } from 'vue'
import { useAgentStore } from '@/stores/agentStore'
import { t, tPlural } from '@/i18n'
import { permissionSourceName } from '@/utils/permission-source'
import Button from '@/components/ui/Button.vue'
import { formatClockDuration } from '@/utils/intl-format'
import { groupPermissionRequests, permissionRemainingMs } from '@/utils/permission-view'

defineProps<{
  now: number
}>()

const DENY_ALL_CONFIRM_MS = 4000

const store = useAgentStore()
const queue = computed(() => store.permissionRequests)
const queueGroups = computed(() => groupPermissionRequests(queue.value))
const confirmDenyAll = ref(false)
let confirmTimer: ReturnType<typeof setTimeout> | null = null

function resetDenyAll(): void {
  confirmDenyAll.value = false
  if (confirmTimer) clearTimeout(confirmTimer)
  confirmTimer = null
}

// Two-step: the first press asks, the second (within 4s) denies every pending
// request one by one through the broker.
async function denyAll(): Promise<void> {
  if (!confirmDenyAll.value) {
    confirmDenyAll.value = true
    confirmTimer = setTimeout(resetDenyAll, DENY_ALL_CONFIRM_MS)
    return
  }
  resetDenyAll()
  for (const pending of [...queue.value]) {
    if (pending.status === 'pending') await store.decidePermission(pending.requestId, 'deny')
  }
}

onBeforeUnmount(resetDenyAll)
</script>

<template>
  <div class="permission-queue" role="group" :aria-label="t('permission.queueLabel')">
    <ol class="permission-queue-list">
      <li v-for="group in queueGroups" :key="group.first.requestId" class="permission-queue-item">
        <span class="permission-queue-action">{{ group.first.action }}</span>
        <span class="permission-queue-meta">
          {{ permissionSourceName(group.first.agentId) }} · {{ group.first.projectId || t('projectUnknown') }}
        </span>
        <span v-if="group.count > 1" class="permission-queue-count">x{{ group.count }}</span>
        <span class="permission-queue-time">{{ formatClockDuration(permissionRemainingMs(group.first, now)) }}</span>
        <span v-if="group.first.risk === 'high'" class="permission-queue-risk">{{ t('permissionRiskHigh') }}</span>
      </li>
    </ol>
    <Button class="permission-button deny permission-queue-deny" @mousedown.stop @click.stop="denyAll">
      {{ confirmDenyAll ? tPlural('permission.denyAllConfirm', queue.length) : t('permission.denyAll') }}
    </Button>
  </div>
</template>

<style scoped>
.permission-queue {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.permission-queue-list {
  display: flex;
  max-height: 9em;
  margin: 0;
  padding: 0;
  flex-direction: column;
  gap: var(--space-1);
  overflow-y: auto;
  list-style: none;
}

.permission-queue-item {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  font-size: var(--font-xs);
  line-height: 1.3;
}

.permission-queue-action {
  flex: 0 0 auto;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-weight: var(--weight-bold);
}

.permission-queue-meta {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: var(--text-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.permission-queue-count,
.permission-queue-time {
  flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
}

.permission-queue-risk {
  color: var(--text-danger);
  font-weight: var(--weight-bold);
}

/* 按鈕樣式（.permission-button）由 PermissionBubble 以 :deep 提供。 */
</style>
