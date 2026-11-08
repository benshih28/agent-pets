<script setup lang="ts">
import { computed } from 'vue'
import { t } from '@/i18n'
import { useHistoryFormat } from '@/composables/useHistoryFormat'
import { useQuotaFormat } from '@/composables/useQuotaFormat'
import type { HistoryUsageBlock } from '@/types/history'
import { agentDisplayName } from '@/utils/agent-label'
import { USAGE_BLOCK_MS, usageBlockView } from '@/utils/usage-blocks'
import ProgressTrack from '@/components/ui/ProgressTrack.vue'

// One local 5-hour block, shown beside the provider quota. It is computed from
// local logs only, so the source line is always visible next to the numbers.
const props = defineProps<{ block: HistoryUsageBlock; nowTick: number; showAgent?: boolean }>()
const { tokens, duration } = useHistoryFormat()
const { formatClock } = useQuotaFormat(() => props.nowTick)

const view = computed(() => usageBlockView(props.block, props.nowTick))
const elapsedPercent = computed(() => Math.round((view.value.elapsedMs / USAGE_BLOCK_MS) * 100))
const elapsedText = computed(() => t('growth.blockElapsed', {
  elapsed: duration(view.value.elapsedMs),
  remaining: duration(view.value.remainingMs),
}))
</script>

<template>
  <div class="usage-block">
    <div class="quota-copy">
      <span class="quota-label usage-block-title">
        {{ t('growth.blockTitle') }}<template v-if="showAgent"> · {{ agentDisplayName(block.adapterId) }}</template>
      </span>
      <span class="quota-value" :title="tokens(view.tokens, 'full')">{{ t('growth.blockTokens', { tokens: tokens(view.tokens) }) }}</span>
    </div>
    <ProgressTrack
      size="sm"
      :value="elapsedPercent"
      :value-text="elapsedText"
      :aria-label="t('growth.blockProgressAria', { agent: agentDisplayName(block.adapterId) })"
    />
    <div class="quota-reset usage-block-meta">
      <span>{{ elapsedText }}</span>
      <span>{{ t('growth.blockBurn', { rate: tokens(view.burnRatePerMinute) }) }}</span>
    </div>
    <div class="usage-block-source" :title="t('growth.blockHint')">
      {{ t('growth.blockSource') }} · {{ t('growth.blockStarted', { time: formatClock(block.startAt) }) }}
    </div>
  </div>
</template>

<style scoped>
.usage-block {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding-top: var(--space-2);
  border-top: 1px solid var(--border-subtle);
}

.usage-block-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.usage-block-meta {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--space-2);
}

.usage-block-source {
  color: var(--text-muted);
  font-size: var(--font-xs);
}
</style>
