<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { t, type TranslationKey } from '@/i18n'
import { useHistoryFormat } from '@/composables/useHistoryFormat'
import { useProgressionLabels } from '@/composables/useProgressionLabels'
import { useQuotaFormat } from '@/composables/useQuotaFormat'
import { useAgentStore } from '@/stores/agentStore'
import {
  HISTORY_RANGE_OPTIONS,
  type HistoryAgentStat,
  type HistoryRangeDays,
  type HistorySummary,
} from '@/types/history'
import { agentDisplayName } from '@/utils/agent-label'
import { localDateKey } from '@/utils/local-date'
import GrowthEmptyState from '@/components/growth/GrowthEmptyState.vue'
import HistoryChart from '@/components/growth/HistoryChart.vue'
import HistoryModelList from '@/components/growth/HistoryModelList.vue'
import HistorySessions from '@/components/growth/HistorySessions.vue'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import Icon from '@/components/ui/Icon.vue'
import ProgressTrack from '@/components/ui/ProgressTrack.vue'
import Select from '@/components/ui/Select.vue'
import TabPanel from '@/components/ui/TabPanel.vue'
import Tabs from '@/components/ui/Tabs.vue'
import { formatDate } from '@/utils/intl-format'

const props = defineProps<{ active: boolean }>()
const store = useAgentStore()
const { tokens, duration } = useHistoryFormat()
const { evolutionLabel, moodStage } = useProgressionLabels()
const { formatAge } = useQuotaFormat(() => Date.now())

const historySummary = ref<HistorySummary | null>(null)
const historyLoading = ref(false)
const HISTORY_REFRESH_DEBOUNCE_MS = 500
let historyRefreshTimer: ReturnType<typeof setTimeout> | null = null
const historyError = ref('')
const historyAction = ref('')
const historyProjectFilter = ref('')
const historyExporting = ref(false)
const lastExportPath = ref('')
const agentMetric = ref<'tokens' | 'time'>('tokens')
const progression = computed(() => store.progression)
let cleanupHistoryUpdated: (() => void) | null = null
let actionTimer: ReturnType<typeof setTimeout> | null = null
let dayWatchTimer: ReturnType<typeof setInterval> | null = null

// --- remembered per-viewer view state (all optional conveniences) -----------
const RANGE_KEY = 'agent-pet-history-range'
const COLLAPSE_KEY = 'agent-pet-history-collapsed'
const INTRO_KEY = 'agent-pet-history-intro-dismissed'
const VIEW_KEY = 'agent-pet-history-view'
type HistoryView = 'overview' | 'sessions'

function readRange(): HistoryRangeDays {
  try {
    const stored = Number(localStorage.getItem(RANGE_KEY))
    return HISTORY_RANGE_OPTIONS.find(option => option === stored) ?? 7
  } catch { return 7 }
}
function readCollapsed(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '{}') as Record<string, boolean> } catch { return {} }
}
const historyRange = ref<HistoryRangeDays>(readRange())
const collapsed = ref<Record<string, boolean>>(readCollapsed())
const historyView = ref<HistoryView>('overview')
try { if (localStorage.getItem(VIEW_KEY) === 'sessions') historyView.value = 'sessions' } catch { /* convenience only */ }
const viewItems = computed(() => [
  { id: 'overview', label: t('growth.viewOverview') },
  { id: 'sessions', label: t('growth.viewSessions') },
])
function selectView(view: string): void {
  historyView.value = view === 'sessions' ? 'sessions' : 'overview'
  try { localStorage.setItem(VIEW_KEY, historyView.value) } catch { /* convenience only */ }
}
const introDismissed = ref(true)
try { introDismissed.value = localStorage.getItem(INTRO_KEY) === '1' } catch { introDismissed.value = false }

const RANGE_LABEL_KEYS = { 7: 'growth.range7', 30: 'growth.range30', 90: 'growth.range90' } as const
const TOKEN_LABEL_KEYS: Partial<Record<HistorySummary['tokenQuality'], TranslationKey>> = {
  exact: 'historyTokenExact', estimated: 'historyTokenEstimated',
}

function selectRange(days: HistoryRangeDays): void {
  if (historyRange.value === days) return
  historyRange.value = days
  try { localStorage.setItem(RANGE_KEY, String(days)) } catch { /* convenience only */ }
  void refreshHistory()
}

function toggleSection(key: string, event: Event): void {
  collapsed.value = { ...collapsed.value, [key]: !(event.target as HTMLDetailsElement).open }
  try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapsed.value)) } catch { /* convenience only */ }
}

function dismissIntro(): void {
  introDismissed.value = true
  try { localStorage.setItem(INTRO_KEY, '1') } catch { /* convenience only */ }
}

// --- derived data ------------------------------------------------------------
const historyIsEmpty = computed(() => {
  const summary = historySummary.value
  if (!summary) return false
  const totals = summary.totals
  return summary.agents.length === 0
    && totals.sessionsCompleted + totals.sessionsFailed + totals.activeMs + totals.tokenInput + totals.tokenOutput === 0
})

const totalTokens = computed(() => (historySummary.value
  ? historySummary.value.totals.tokenInput + historySummary.value.totals.tokenOutput
  : 0))
const cacheTokens = computed(() => (historySummary.value
  ? historySummary.value.totals.tokenCacheRead + historySummary.value.totals.tokenCacheWrite
  : 0))

function delta(current: number, previous: number): string {
  if (previous <= 0) return ''
  const percent = Math.round(((current - previous) / previous) * 100)
  return t('growth.deltaVsPrevious', {
    days: historySummary.value?.rangeDays ?? 7,
    delta: `${percent > 0 ? '+' : ''}${percent}%`,
  })
}
const tokenDelta = computed(() => {
  const previous = historySummary.value?.previousTotals
  return previous ? delta(totalTokens.value, previous.tokenInput + previous.tokenOutput) : ''
})
const timeDelta = computed(() => {
  const summary = historySummary.value
  return summary ? delta(summary.totals.activeMs, summary.previousTotals.activeMs) : ''
})

function tokenLabel(quality: HistorySummary['tokenQuality']): string {
  return t(TOKEN_LABEL_KEYS[quality] ?? 'historyTokenUnavailable')
}

function agentShare(agent: HistoryAgentStat): number {
  const summary = historySummary.value
  if (!summary) return 0
  if (agentMetric.value === 'tokens') {
    const total = summary.totals.tokenInput + summary.totals.tokenOutput
    return total > 0 ? Math.round(((agent.tokenInput + agent.tokenOutput) / total) * 100) : 0
  }
  return summary.totals.activeMs > 0 ? Math.round((agent.activeMs / summary.totals.activeMs) * 100) : 0
}

function agentHeadline(agent: HistoryAgentStat): string {
  return agentMetric.value === 'tokens'
    ? tokens(agent.tokenInput + agent.tokenOutput)
    : duration(agent.activeMs)
}

function trackingDate(): string {
  const since = historySummary.value?.tokenTrackingSince
  if (!since) return ''
  const date = new Date(since)
  return Number.isFinite(date.getTime()) ? formatDate(date) : ''
}

const scanLine = computed(() => {
  const scan = historySummary.value?.scan
  return scan ? t('growth.scanInfo', { age: formatAge(scan.finishedAt) }) : ''
})
const skippedLine = computed(() => {
  const skipped = historySummary.value?.scan?.filesSkipped ?? 0
  return skipped > 0 ? t('growth.scanSkipped', { count: skipped }) : ''
})
const deferredLine = computed(() => {
  const deferred = historySummary.value?.scan?.filesDeferred ?? 0
  return deferred > 0 ? t('growth.scanDeferred', { count: deferred }) : ''
})

// --- loading -------------------------------------------------------------------
async function refreshHistory(): Promise<void> {
  if (historyLoading.value) return
  historyLoading.value = true
  historyError.value = ''
  try {
    const summary = await window.electronAPI?.getHistorySummary(historyProjectFilter.value || undefined, historyRange.value)
    // Keep the previous numbers on screen if a refresh comes back empty.
    if (summary) historySummary.value = summary
    else if (!historySummary.value) historyError.value = t('historyDataUnavailable')
  } catch {
    if (!historySummary.value) historyError.value = t('historyDataUnavailable')
  } finally {
    historyLoading.value = false
  }
}

function onProjectChange(value: string): void {
  historyProjectFilter.value = value
  void refreshHistory()
}

// --- actions -------------------------------------------------------------------
function announce(message: string, path = ''): void {
  historyAction.value = message
  lastExportPath.value = path
  if (actionTimer) clearTimeout(actionTimer)
  // Status text fades away after a few seconds so a stale result never lingers.
  actionTimer = setTimeout(() => { historyAction.value = ''; lastExportPath.value = '' }, 8_000)
}

function dismissAction(): void {
  historyAction.value = ''
  lastExportPath.value = ''
  if (actionTimer) clearTimeout(actionTimer)
}

async function exportHistory(format: 'json' | 'csv'): Promise<void> {
  dismissAction()
  historyExporting.value = true
  try {
    const result = await window.electronAPI?.exportHistory({
      format,
      rangeDays: historyRange.value,
      ...(historyProjectFilter.value ? { projectId: historyProjectFilter.value } : {}),
    })
    if (result?.ok) announce(t('growth.exportedTo', { path: result.path ?? '' }), result.path ?? '')
    else if (result?.error === 'cancelled') announce(t('historyExportCancelled'))
    else if (result?.error === 'write_failed') announce(t('growth.exportWriteFailed'))
    else if (result?.error === 'unavailable') announce(t('growth.exportUnavailable'))
    else announce(t('historyActionFailed'))
  } catch {
    announce(t('historyActionFailed'))
  } finally {
    historyExporting.value = false
  }
}

async function revealExport(): Promise<void> {
  try { await window.electronAPI?.revealHistoryExport() } catch { /* nothing to reveal */ }
}

const confirmClear = ref(false)

async function performClearHistory(): Promise<void> {
  confirmClear.value = false
  dismissAction()
  try {
    const result = await window.electronAPI?.clearHistory()
    if (result?.ok) {
      announce(t('historyCleared'))
      await refreshHistory()
    } else announce(t('historyActionFailed'))
  } catch {
    announce(t('historyActionFailed'))
  }
}

// --- lifecycle -------------------------------------------------------------------
watch(() => props.active, active => {
  if (active && !historySummary.value) void refreshHistory()
})
watch(() => store.projectPets, projects => {
  if (historyProjectFilter.value && !projects.some(project => project.projectId === historyProjectFilter.value)) {
    historyProjectFilter.value = ''
    if (props.active) void refreshHistory()
  }
})

// A panel left open past midnight must not keep showing yesterday as "today".
function refreshWhenDayChanges(): void {
  const summary = historySummary.value
  if (props.active && summary && summary.localDate !== localDateKey(Date.now())) void refreshHistory()
}

onMounted(() => {
  dayWatchTimer = setInterval(refreshWhenDayChanges, 60_000)
  cleanupHistoryUpdated = window.electronAPI?.onHistoryUpdated(() => {
    if (!props.active) return
    // Trailing debounce: a burst of updates triggers one refetch.
    if (historyRefreshTimer) clearTimeout(historyRefreshTimer)
    historyRefreshTimer = setTimeout(() => { historyRefreshTimer = null; void refreshHistory() }, HISTORY_REFRESH_DEBOUNCE_MS)
  }) ?? null
})
onUnmounted(() => {
  cleanupHistoryUpdated?.()
  if (historyRefreshTimer) clearTimeout(historyRefreshTimer)
  if (actionTimer) clearTimeout(actionTimer)
  if (dayWatchTimer) clearInterval(dayWatchTimer)
})
</script>

<template>
  <div id="panel-history" role="tabpanel" aria-labelledby="tab-history" class="history-view" :aria-busy="historyLoading ? 'true' : undefined">
    <div class="history-hero">
      <div>
        <div class="history-kicker">{{ t('historyTitle') }}</div>
        <p>{{ t('historyHelp') }}</p>
      </div>
      <div class="history-controls">
        <div class="history-range" role="group" :aria-label="t('growth.rangeLabel')">
          <Button
            v-for="days in HISTORY_RANGE_OPTIONS"
            :key="days"
            size="sm"
            :active="historyRange === days"
            @click="selectRange(days)"
          >{{ t(RANGE_LABEL_KEYS[days]) }}</Button>
        </div>
        <Select
          :model-value="historyProjectFilter"
          size="sm"
          class="history-project-filter"
          :aria-label="t('historyProjectFilter')"
          @update:model-value="onProjectChange"
        >
          <option value="">{{ t('historyAllProjects') }}</option>
          <option v-for="project in store.projectPets" :key="project.projectId" :value="project.projectId">
            {{ project.displayName }}
          </option>
        </Select>
      </div>
    </div>

    <Tabs
      :model-value="historyView"
      :items="viewItems"
      id-prefix="history-view"
      variant="pill"
      :ariaLabel="t('growth.viewLabel')"
      @update:model-value="selectView"
    />

    <TabPanel id-prefix="history-view" id="sessions" :active="historyView === 'sessions'">
      <HistorySessions
        :active="active && historyView === 'sessions'"
        :range-days="historyRange"
        :project-id="historyProjectFilter"
      />
    </TabPanel>

    <TabPanel id-prefix="history-view" id="overview" :active="historyView === 'overview'" class="history-overview">
    <GrowthEmptyState v-if="historyLoading && !historySummary" :title="t('checking')" busy />
    <GrowthEmptyState v-else-if="historyError && !historySummary" tone="error" icon="warning" :title="historyError">
      <Button variant="secondary" size="sm" @click="refreshHistory">{{ t('growth.retry') }}</Button>
    </GrowthEmptyState>
    <GrowthEmptyState
      v-else-if="historyIsEmpty"
      :title="t('growth.historyEmptyTitle')"
      :description="t('growth.historyEmptyBody')"
    >
      <small>{{ t('growth.historyEmptyHint') }}</small>
    </GrowthEmptyState>
    <template v-else-if="historySummary">
      <div v-if="historyLoading" class="history-updating" role="status">{{ t('growth.updating') }}</div>

      <Card v-if="!introDismissed" class="history-intro" role="note">
        <strong>{{ t('growth.historyIntroTitle') }}</strong>
        <p>{{ t('growth.historyIntroBody') }}</p>
        <Button variant="secondary" size="sm" @click="dismissIntro">{{ t('growth.dismiss') }}</Button>
      </Card>

      <div class="history-stat-grid">
        <Card class="history-stat-tile history-stat-token" tone="accent">
          <span class="history-stat-label" :title="t('growth.tokenBasisTip')">{{ t('historyTokens') }}</span>
          <strong class="history-stat-number" :title="tokens(totalTokens, 'full')">{{ tokens(totalTokens) }}</strong>
          <span class="history-stat-meta">{{ tokenLabel(historySummary.tokenQuality) }}</span>
          <span v-if="tokenDelta" class="history-stat-meta">{{ tokenDelta }}</span>
          <span v-if="cacheTokens > 0" class="history-stat-meta" :title="t('growth.tokenBasisTip')">{{ t('growth.cacheNote', { value: tokens(cacheTokens) }) }}</span>
        </Card>
        <Card class="history-stat-tile history-stat-sessions" tone="success">
          <span class="history-stat-label">{{ t('historyCompleted') }}</span>
          <strong class="history-stat-number">{{ historySummary.totals.sessionsCompleted }}</strong>
          <span class="history-stat-meta">{{ t('historySessions') }}</span>
          <span v-if="historySummary.totals.sessionsFailed > 0" class="history-stat-meta">{{ t('growth.failedCount', { count: historySummary.totals.sessionsFailed }) }}</span>
        </Card>
        <Card class="history-stat-tile history-stat-time">
          <span class="history-stat-label">{{ t('historyActiveTime') }}</span>
          <strong class="history-stat-number">{{ duration(historySummary.totals.activeMs) }}</strong>
          <span class="history-stat-meta">{{ timeDelta || t('historyRetention', { days: historySummary.retentionDays }) }}</span>
        </Card>
      </div>

      <div v-if="progression" class="history-growth-line">
        <span>{{ t('historyLevel', { level: progression.level }) }} · {{ evolutionLabel(progression.evolutionStage) }} · {{ moodStage }}</span>
        <span>{{ t('historyStreak', { days: progression.currentStreak }) }}</span>
      </div>

      <details class="history-section" :open="!collapsed.trend" @toggle="toggleSection('trend', $event)">
        <summary>{{ t('growth.trendTitle', { days: historySummary.rangeDays }) }}</summary>
        <Card class="history-chart-card" tone="accent">
          <HistoryChart
            :days="historySummary.days"
            :today-key="historySummary.localDate"
            :weekday-labels="historySummary.rangeDays === 7"
          />
        </Card>
      </details>

      <details class="history-section" :open="!collapsed.agents" @toggle="toggleSection('agents', $event)">
        <summary>{{ t('historyAgentDistribution') }}</summary>
        <Card class="history-agent-card">
          <div v-if="historySummary.agents.length === 0" class="history-muted">{{ t('historyNoData') }}</div>
          <template v-else>
            <div class="history-metric" role="group" :aria-label="t('growth.agentMetric')">
              <Button size="sm" :active="agentMetric === 'tokens'" @click="agentMetric = 'tokens'">{{ t('growth.agentByTokens') }}</Button>
              <Button size="sm" :active="agentMetric === 'time'" @click="agentMetric = 'time'">{{ t('growth.agentByTime') }}</Button>
            </div>
            <div class="history-agent-list">
              <div v-for="agent in historySummary.agents" :key="agent.adapterId" class="history-agent-row">
                <div class="history-agent-heading"><span>{{ agentDisplayName(agent.adapterId) }}</span><strong>{{ agentHeadline(agent) }} · {{ agentShare(agent) }}%</strong></div>
                <ProgressTrack :value="agentShare(agent)" tone="success" decorative />
                <div class="history-muted">{{ tokens(agent.tokenInput, 'full') }} {{ t('historyTokenIn') }} · {{ tokens(agent.tokenOutput, 'full') }} {{ t('historyTokenOut') }} · {{ tokenLabel(agent.tokenQuality) }}</div>
                <div class="history-muted history-agent-outcomes">
                  <span>{{ duration(agent.activeMs) }}</span>
                  <span class="outcome ok"><Icon name="check" :size="12" />{{ t('growth.agentSuccess', { count: agent.sessionsCompleted }) }}</span>
                  <span v-if="agent.sessionsFailed > 0" class="outcome fail"><Icon name="warning" :size="12" />{{ t('growth.agentFailure', { count: agent.sessionsFailed }) }}</span>
                </div>
              </div>
            </div>
          </template>
        </Card>
      </details>

      <details
        v-if="(historySummary.models ?? []).length > 0"
        class="history-section"
        :open="!collapsed.models"
        @toggle="toggleSection('models', $event)"
      >
        <summary>{{ t('growth.modelsTitle') }}</summary>
        <HistoryModelList :models="historySummary.models" :total-tokens="totalTokens" />
      </details>

      <div class="history-footer">
        <span>{{ t('historyCompactDisclosure', { date: trackingDate() }) }}</span>
        <span v-if="scanLine" class="history-muted">{{ scanLine }}</span>
        <span v-if="skippedLine" class="history-muted">{{ skippedLine }}</span>
        <span v-if="deferredLine" class="history-muted">{{ deferredLine }}</span>
        <div class="history-actions">
          <Button variant="secondary" size="sm" :disabled="historyExporting" @click="exportHistory('json')">{{ historyExporting ? t('growth.exporting') : t('growth.exportJson') }}</Button>
          <Button variant="secondary" size="sm" :disabled="historyExporting" @click="exportHistory('csv')">{{ t('growth.exportCsv') }}</Button>
          <Button variant="danger" size="sm" @click="confirmClear = true">{{ t('historyClearShort') }}</Button>
        </div>
      </div>
    </template>
    </TabPanel>

    <div v-if="historyAction" class="history-action-status" role="status" aria-live="polite">
      <span>{{ historyAction }}</span>
      <Button v-if="lastExportPath" variant="ghost" size="sm" @click="revealExport">{{ t('growth.revealExport') }}</Button>
      <Button variant="ghost" size="sm" :aria-label="t('growth.closeMessage')" @click="dismissAction"><Icon name="close" :size="12" /></Button>
    </div>

    <ConfirmDialog
      :open="confirmClear"
      :title="t('historyClear')"
      :message="t('growth.clearDetail')"
      tone="danger"
      @confirm="performClearHistory"
      @cancel="confirmClear = false"
    />
  </div>
</template>

<style scoped src="@/components/status-panel/StatusPanelHistory.css"></style>
