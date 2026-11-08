<script setup lang="ts">
import { t } from '@/i18n'
import { useHistoryFormat } from '@/composables/useHistoryFormat'
import type { HistoryModelStat } from '@/types/history'
import { agentDisplayName } from '@/utils/agent-label'
import Card from '@/components/ui/Card.vue'
import ProgressTrack from '@/components/ui/ProgressTrack.vue'

// Per-model token totals for the History range. Only local-log usage names a
// model, so the hint explains why hook-only agents are missing here.
const props = defineProps<{ models: HistoryModelStat[]; totalTokens: number }>()
const { tokens } = useHistoryFormat()

function modelLabel(stat: HistoryModelStat): string {
  return `${agentDisplayName(stat.adapterId)} · ${stat.model || t('growth.modelUnknown')}`
}

// Share of the range's fresh input + output, the same basis as the headline.
function modelShare(stat: HistoryModelStat): number {
  return props.totalTokens > 0 ? Math.round(((stat.tokenInput + stat.tokenOutput) / props.totalTokens) * 100) : 0
}
</script>

<template>
  <Card class="history-agent-card">
    <p class="history-muted history-models-hint">{{ t('growth.modelsHint') }}</p>
    <div class="history-agent-list">
      <div v-for="stat in models" :key="`${stat.adapterId}/${stat.model}`" class="history-agent-row">
        <div class="history-agent-heading history-model-heading">
          <span class="history-model-name" :title="modelLabel(stat)">{{ modelLabel(stat) }}</span>
          <strong>{{ tokens(stat.tokenInput + stat.tokenOutput) }} · {{ modelShare(stat) }}%</strong>
        </div>
        <ProgressTrack :value="modelShare(stat)" tone="accent" decorative />
        <div class="history-muted">
          {{ tokens(stat.tokenInput, 'full') }} {{ t('historyTokenIn') }} · {{ tokens(stat.tokenOutput, 'full') }} {{ t('historyTokenOut') }}<template v-if="stat.tokenCacheRead + stat.tokenCacheWrite > 0"> · {{ t('growth.cacheNote', { value: tokens(stat.tokenCacheRead + stat.tokenCacheWrite) }) }}</template>
        </div>
      </div>
    </div>
  </Card>
</template>

<style scoped>
.history-model-heading {
  gap: var(--space-2);
}

.history-model-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-model-heading strong {
  flex-shrink: 0;
}

.history-models-hint {
  margin: 0 0 var(--space-3);
}
</style>
