<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { locale, t, type TranslationKey } from '@/i18n'
import { useAgentStore } from '@/stores/agentStore'
import type { HistoryAgentStat, HistoryDailyStat, HistorySummary } from '@/types/history'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import ProgressTrack from '@/components/ui/ProgressTrack.vue'
import Select from '@/components/ui/Select.vue'

const props = defineProps<{ active: boolean }>()
const store = useAgentStore()
const historySummary = ref<HistorySummary | null>(null)
const historyLoading = ref(false)
const historyError = ref('')
const historyAction = ref('')
const historyProjectFilter = ref('')
let cleanupHistoryUpdated: (() => void) | null = null
const progression = computed(() => store.progression)
const evolutionLabels = computed<Record<string, string>>(() => ({
  egg: t('evolutionEgg'), baby: t('evolutionBaby'), teen: t('evolutionTeen'),
  adult: t('evolutionAdult'), master: t('evolutionMaster'),
}))
const evolutionLabel = computed(() => progression.value ? evolutionLabels.value[progression.value.evolutionStage] : '')
const moodStage = computed(() => {
  if (store.mood >= 90) return t('moodOverdrive')
  if (store.mood >= 70) return t('moodRadiant')
  if (store.mood >= 40) return t('moodCharged')
  return t('moodResting')
})

const HISTORY_TOKEN_LABEL_KEYS: Partial<Record<HistorySummary['tokenQuality'], TranslationKey>> = {
  exact: 'historyTokenExact', estimated: 'historyTokenEstimated',
}
const confirmDialog = ref<{
  title: string
  message?: string
  tone: 'default' | 'danger'
  onConfirm: () => void | Promise<void>
} | null>(null)

const historyMaxTokens = computed(() => Math.max(
  1,
  ...(historySummary.value?.days.map(day => day.tokenInput + day.tokenOutput) ?? [1]),
))
const compactNumberFormatter = computed(() => new Intl.NumberFormat(locale.value, {
  notation: 'compact', maximumFractionDigits: 1,
}))

function onHistoryProjectFilterChange(value: string): void {
  historyProjectFilter.value = value
  void refreshHistory()
}

async function refreshHistory(): Promise<void> {
  if (historyLoading.value) return
  historyLoading.value = true
  historyError.value = ''
  try {
    const summary = await window.electronAPI?.getHistorySummary(historyProjectFilter.value || undefined)
    historySummary.value = summary ?? null
    if (!summary) historyError.value = t('historyDataUnavailable')
  } catch {
    historySummary.value = null
    historyError.value = t('historyDataUnavailable')
  } finally {
    historyLoading.value = false
  }
}

function historyDateLabel(value: string): string {
  const date = new Date(`${value}T12:00:00`)
  if (!Number.isFinite(date.getTime())) return value
  return date.toLocaleDateString(locale.value, { month: 'numeric', day: 'numeric' })
}

function historyDayLabel(day: HistoryDailyStat): string {
  if (historySummary.value?.days.at(-1)?.localDate === day.localDate) return t('historyToday')
  return historyDateLabel(day.localDate)
}

function historyDuration(value: number): string {
  const minutes = Math.max(0, Math.round(value / 60_000))
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function historyTokenLabel(quality: HistorySummary['tokenQuality']): string {
  return t(HISTORY_TOKEN_LABEL_KEYS[quality] ?? 'historyTokenUnavailable')
}

function historyAgentLabel(adapterId: string): string {
  const id = adapterId.toLowerCase()
  if (id.includes('codex')) return t('clientCodex')
  if (id.includes('claude')) return t('clientClaudeCode')
  if (id.includes('opencode')) return t('clientOpenCode')
  return adapterId
}

function historyDayTokenPercent(day: HistoryDailyStat): number {
  const total = day.tokenInput + day.tokenOutput
  return Math.round((total / historyMaxTokens.value) * 100)
}

function historyDayBarHeight(day: HistoryDailyStat): number {
  const total = historyDayTokenTotal(day)
  return total > 0 ? Math.max(4, historyDayTokenPercent(day)) : 0
}

function historyDayTokenTotal(day: HistoryDailyStat): number {
  return day.tokenInput + day.tokenOutput
}

function formatCompactNumber(value: number): string {
  return compactNumberFormatter.value.format(value)
}

function historyTrackingDateLabel(): string {
  const since = historySummary.value?.tokenTrackingSince
  if (!since) return ''
  const date = new Date(since)
  if (!Number.isFinite(date.getTime())) return ''
  return date.toLocaleDateString(locale.value, { year: 'numeric', month: '2-digit', day: '2-digit' })
}

function historyAgentTokenTotal(agent: HistoryAgentStat): number {
  return agent.tokenInput + agent.tokenOutput
}

function historyAgentBarPercent(agent: HistoryAgentStat): number {
  const summary = historySummary.value
  if (!summary) return 0
  const totalTokens = summary.totals.tokenInput + summary.totals.tokenOutput
  if (totalTokens > 0) return Math.round((historyAgentTokenTotal(agent) / totalTokens) * 100)
  return Math.round((agent.activeMs / Math.max(1, summary.totals.activeMs)) * 100)
}

async function exportHistory(): Promise<void> {
  historyAction.value = ''
  try {
    const result = await window.electronAPI?.exportHistory()
    if (result?.ok) historyAction.value = t('historyExported')
    else if (result?.error === 'cancelled') historyAction.value = t('historyExportCancelled')
    else historyAction.value = t('historyActionFailed')
  } catch {
    historyAction.value = t('historyActionFailed')
  }
}

function askConfirm(request: NonNullable<typeof confirmDialog.value>): void {
  confirmDialog.value = request
}

async function acceptConfirm(): Promise<void> {
  const pending = confirmDialog.value
  confirmDialog.value = null
  await pending?.onConfirm()
}

function clearHistory(): void {
  askConfirm({ title: t('historyClear'), message: t('historyClearConfirm'), tone: 'danger', onConfirm: performClearHistory })
}

async function performClearHistory(): Promise<void> {
  historyAction.value = ''
  try {
    const result = await window.electronAPI?.clearHistory()
    if (result?.ok) {
      historyAction.value = t('historyCleared')
      await refreshHistory()
    } else historyAction.value = t('historyActionFailed')
  } catch {
    historyAction.value = t('historyActionFailed')
  }
}

function formatUpdated(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit' })
}

watch(() => props.active, active => {
  if (active && !historySummary.value) void refreshHistory()
})
watch(() => store.projectPets, projects => {
  if (historyProjectFilter.value && !projects.some(project => project.projectId === historyProjectFilter.value)) {
    historyProjectFilter.value = ''
    if (props.active) void refreshHistory()
  }
})
onMounted(() => {
  cleanupHistoryUpdated = window.electronAPI?.onHistoryUpdated(() => {
    if (props.active) void refreshHistory()
  }) ?? null
})
onUnmounted(() => cleanupHistoryUpdated?.())
</script>

<template>
  <div id="panel-history" role="tabpanel" aria-labelledby="tab-history" class="history-view">
    <div class="history-hero">
      <div>
        <div class="history-kicker">{{ t('historyTitle') }}</div>
        <p>{{ t('historyHelp') }}</p>
      </div>
      <Select
        :model-value="historyProjectFilter"
        size="sm"
        class="history-project-filter"
        :aria-label="t('historyProjectFilter')"
        @update:model-value="onHistoryProjectFilterChange"
      >
        <option value="">{{ t('historyAllProjects') }}</option>
        <option v-for="project in store.projectPets" :key="project.projectId" :value="project.projectId">
          {{ project.displayName }}
        </option>
      </Select>
    </div>

    <div v-if="historyLoading && !historySummary" class="panel-empty">{{ t('checking') }}</div>
    <div v-else-if="historyError && !historySummary" class="panel-empty history-error">{{ historyError }}</div>
    <template v-else-if="historySummary">
      <div class="history-stat-grid">
        <Card class="history-stat-tile history-stat-token" tone="accent">
          <span class="history-stat-label">{{ t('historyTokens') }}</span>
          <strong class="history-stat-number">{{ formatCompactNumber(historySummary.totals.tokenInput + historySummary.totals.tokenOutput) }}</strong>
          <span class="history-stat-meta">{{ historyTokenLabel(historySummary.tokenQuality) }}</span>
        </Card>
        <Card class="history-stat-tile history-stat-sessions" tone="success">
          <span class="history-stat-label">{{ t('historyCompleted') }}</span>
          <strong class="history-stat-number">{{ historySummary.totals.sessionsCompleted }}</strong>
          <span class="history-stat-meta">{{ t('historySessions') }}</span>
        </Card>
        <Card class="history-stat-tile history-stat-time">
          <span class="history-stat-label">{{ t('historyActiveTime') }}</span>
          <strong class="history-stat-number">{{ historyDuration(historySummary.totals.activeMs) }}</strong>
          <span class="history-stat-meta">{{ t('historyRetention', { days: historySummary.retentionDays }) }}</span>
        </Card>
      </div>

      <div v-if="progression" class="history-growth-line">
        <span>{{ t('historyLevel', { level: progression.level }) }} · {{ evolutionLabel }} · {{ moodStage }}</span>
        <span>{{ t('historyStreak', { days: progression.currentStreak }) }}</span>
      </div>

      <Card class="history-chart-card" :title="t('historyTokenTrend')" tone="accent">
        <template #heading><span class="history-muted">{{ t('historyUpdated', { time: formatUpdated(new Date(historySummary.generatedAt).toISOString()) }) }}</span></template>
        <div class="history-bar-chart">
          <div
            v-for="day in historySummary.days"
            :key="day.localDate"
            class="history-bar-column"
            :title="`${day.sessionsCompleted}${t('historyCompleted')} · ${day.sessionsFailed}${t('historyFailed')}`"
          >
            <span class="history-bar-value">{{ formatCompactNumber(historyDayTokenTotal(day)) }}</span>
            <div class="history-bar-track" role="img" :aria-label="`${historyDayLabel(day)} ${historyDayTokenTotal(day)} tokens`">
              <div class="history-bar-fill" :style="{ height: `${historyDayBarHeight(day)}%` }" />
            </div>
            <span class="history-bar-label">{{ historyDayLabel(day) }}</span>
          </div>
        </div>
      </Card>

      <Card class="history-agent-card" :title="t('historyAgentDistribution')">
        <div v-if="historySummary.agents.length === 0" class="history-muted">{{ t('historyNoData') }}</div>
        <div v-else class="history-agent-list">
          <div v-for="agent in historySummary.agents" :key="agent.adapterId" class="history-agent-row">
            <div class="history-agent-heading"><span>{{ historyAgentLabel(agent.adapterId) }}</span><strong>{{ historyAgentTokenTotal(agent).toLocaleString(locale) }}</strong></div>
            <ProgressTrack :value="historyAgentBarPercent(agent)" tone="success" decorative />
            <div class="history-muted">{{ agent.tokenInput.toLocaleString(locale) }} {{ t('historyTokenIn') }} · {{ agent.tokenOutput.toLocaleString(locale) }} {{ t('historyTokenOut') }} · {{ historyTokenLabel(agent.tokenQuality) }}</div>
            <div class="history-muted">{{ historyDuration(agent.activeMs) }} · {{ agent.sessionsCompleted }}✓ {{ agent.sessionsFailed }}!</div>
          </div>
        </div>
      </Card>

      <div class="history-footer">
        <span>{{ t('historyCompactDisclosure', { date: historyTrackingDateLabel() }) }}</span>
        <div class="history-actions">
          <Button variant="secondary" size="sm" @click="exportHistory">{{ t('historyExportShort') }}</Button>
          <Button variant="danger" size="sm" @click="clearHistory">{{ t('historyClearShort') }}</Button>
        </div>
      </div>
    </template>
    <div v-if="historyAction" class="history-action-status" role="status" aria-live="polite">{{ historyAction }}</div>
    <ConfirmDialog
      :open="confirmDialog !== null"
      :title="confirmDialog?.title ?? ''"
      :message="confirmDialog?.message"
      :tone="confirmDialog?.tone"
      @confirm="acceptConfirm"
      @cancel="confirmDialog = null"
    />
  </div>
</template>
