<script setup lang="ts">
import { locale, t, translateBackendError } from '@/i18n'
import { useAgentStore } from '@/stores/agentStore'
import { quotaWindowLabel, roundQuotaPercent } from '@/utils/format'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import ProgressTrack from '@/components/ui/ProgressTrack.vue'

const props = defineProps<{ nowTick: number }>()
const store = useAgentStore()

function quotaPercent(value: number): string {
  return `${roundQuotaPercent(value)}%`
}

function formatReset(timestamp?: string): string {
  if (!timestamp) return t('resetTimeUnavailable')
  const reset = new Date(timestamp).getTime()
  if (!Number.isFinite(reset)) return t('resetTimeUnavailable')
  const deltaMinutes = Math.max(0, Math.round((reset - props.nowTick) / 60_000))
  if (deltaMinutes < 1) return t('resetsNow')
  if (deltaMinutes < 60) return t('resetsInMinutes', { minutes: deltaMinutes })
  const hours = Math.floor(deltaMinutes / 60)
  const minutes = deltaMinutes % 60
  if (hours < 24) return t('resetsInHours', { hours, minutes })
  const days = Math.floor(hours / 24)
  return t('resetsInDays', { days, hours: hours % 24 })
}

function formatResetAt(timestamp?: string): string {
  if (!timestamp) return ''
  const reset = new Date(timestamp)
  if (!Number.isFinite(reset.getTime())) return ''
  return reset.toLocaleString(locale.value, {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

function formatUpdated(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit' })
}

</script>

<template>
  <div id="panel-usage" role="tabpanel" aria-labelledby="tab-usage" class="usage-view">
    <div v-if="store.quotaLoading && !store.quotaUsage" class="panel-empty usage-loading">
      {{ t('loadingQuota') }}
    </div>
    <div v-else-if="store.quotaError && !store.quotaUsage" class="panel-empty usage-error">
      {{ translateBackendError(store.quotaError) }}
    </div>
    <template v-else-if="store.quotaUsage">
      <Card
        v-for="provider in store.quotaUsage.providers"
        :key="provider.id"
        class="usage-provider-card"
        :tone="provider.id === 'claude' ? 'claude' : 'accent'"
      >
        <template #heading>
          <span class="usage-provider-name">{{ provider.name }}</span>
          <span v-if="provider.plan" class="usage-plan" :class="`plan-${provider.id}`">{{ provider.plan }}</span>
          <span class="usage-updated">{{ t('updated', { time: formatUpdated(store.quotaUsage.updatedAt) }) }}</span>
        </template>
        <div v-if="provider.error" class="usage-provider-error">
          {{ translateBackendError(provider.error) }}
        </div>
        <div v-else class="quota-window-list">
          <div v-for="quota in provider.windows" :key="quota.id" class="quota-window">
            <div class="quota-copy">
              <span class="quota-label">{{ quotaWindowLabel(quota.id, quota.label) }}</span>
              <span class="quota-value">{{ quotaPercent(quota.remainingPercent) }}</span>
            </div>
            <ProgressTrack
              class="quota-progress"
              :value="quota.remainingPercent"
              :tone="provider.id === 'claude' ? 'claude' : 'accent'"
              :aria-label="t('quotaRemainingAria', { provider: provider.name, quota: quotaWindowLabel(quota.id, quota.label) })"
            />
            <div class="quota-reset">
              <span>{{ formatReset(quota.resetsAt) }}</span>
              <span v-if="formatResetAt(quota.resetsAt)" class="quota-reset-at">
                {{ formatResetAt(quota.resetsAt) }}
              </span>
            </div>
          </div>
        </div>
      </Card>
      <div class="usage-footer">
        <span>{{ t('quotaLocalLoginNote') }}</span>
        <Button variant="secondary" size="sm" :disabled="store.quotaLoading" @click="store.refreshQuota(true)">
          {{ store.quotaLoading ? t('refreshing') : t('refresh') }}
        </Button>
      </div>
    </template>
  </div>
</template>
