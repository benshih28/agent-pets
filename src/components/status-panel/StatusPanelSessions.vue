<script setup lang="ts">
import { computed, ref } from 'vue'
import { locale, t } from '@/i18n'
import { useAgentStore } from '@/stores/agentStore'
import { SOURCE_FAMILIES, SOURCE_LABELS, STATE_LABELS } from '@/types/agent'
import type { PluginEventSourceState, PluginEventSourceStatusView } from '@/types/plugin'
import { useQuotaFormat } from '@/composables/useQuotaFormat'
import {
  countByBucket,
  groupSessions,
  projectLabels,
  type SessionFilter,
  type SessionSort,
} from '@/utils/session-view'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Icon from '@/components/ui/Icon.vue'
import ProgressTrack from '@/components/ui/ProgressTrack.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import Select from '@/components/ui/Select.vue'
import SessionRow from '@/components/status-panel/SessionRow.vue'
import { formatTimeFull } from '@/utils/intl-format'

const props = defineProps<{ nowTick: number; pluginEventSourceStatuses: PluginEventSourceStatusView[] }>()
const emit = defineEmits<{ managePlugins: [] }>()
const store = useAgentStore()
const { quotaPercent, formatReset, quotaTone } = useQuotaFormat(() => props.nowTick)
const QUOTA_STRIP_TONE = { healthy: 'success', warn: 'warn', critical: 'error' } as const
const LIVE_STATES = new Set(['thinking', 'tool-running', 'waiting-permission', 'waiting-input'])

const filter = ref<SessionFilter>('all')
const sourceFamily = ref('all')
const sort = ref<SessionSort>('priority')

const activeSessionList = computed(() => store.sessionList.filter(session => session.state !== 'offline'))
const offlineSessionList = computed(() => store.sessionList.filter(session => session.state === 'offline'))
const hasOffline = computed(() => offlineSessionList.value.length > 0)
const counts = computed(() => countByBucket(activeSessionList.value))
const labels = computed(() => projectLabels(store.sessionList.map(session => session.project)))
const groups = computed(() => groupSessions(store.sessionList, {
  filter: filter.value,
  sources: sourceFamily.value === 'all' ? null : SOURCE_FAMILIES.find(family => family.key === sourceFamily.value)?.sources ?? null,
  sort: sort.value,
}))
const visibleGroups = computed(() => ([
  { id: 'attention', title: t('panel.groupAttention'), sessions: groups.value.attention },
  { id: 'running', title: t('panel.groupRunning'), sessions: groups.value.running },
  { id: 'other', title: t('panel.groupOther'), sessions: groups.value.other },
] as const).filter(group => group.sessions.length > 0))
const filterOptions = computed(() => [
  { value: 'all', label: t('panel.filterAll') },
  { value: 'attention', label: t('panel.filterAttention'), badge: counts.value.attention },
  { value: 'running', label: t('panel.filterRunning'), badge: counts.value.running },
])
const activeToolFamilyCount = computed(() => new Set(
  activeSessionList.value.map(session => SOURCE_FAMILIES.find(family => family.sources.includes(session.source))?.key ?? session.source),
).size)
const noMatches = computed(() => visibleGroups.value.length === 0 && activeSessionList.value.length > 0)
const quotaStripFamilies = computed(() => (
  (['codex', 'claude'] as const).flatMap((id) => {
    const quota = store.quotaByFamily[id]
    if (!quota) return []
    // The label comes from the provider payload, so a new provider needs no edit here.
    const name = store.quotaUsage?.providers.find(provider => provider.id === id)?.name ?? id
    return [{ id, ...quota, label: name }]
  })
))

function projectLabel(project?: string): string {
  return project ? labels.value.get(project) ?? '' : ''
}

function sessionDetail(session: (typeof store.sessionList)[number]): string {
  if (session.state === 'waiting-permission') {
    if (store.permissionRequest?.sessionId === session.sessionId) return t('permissionInlineHint')
    return t('returnToTerminal')
  }
  if (session.toolName) return `${STATE_LABELS[session.state]} · ${session.toolName}`
  if (session.state === 'success') return `${STATE_LABELS[session.state]} · ${formatTime(session.lastSeenAt)}`
  return STATE_LABELS[session.state]
}

function pluginEventSourceStateLabel(state: PluginEventSourceState): string {
  const labels: Record<PluginEventSourceState, Parameters<typeof t>[0]> = {
    thinking: 'pluginEventSourceThinking',
    'tool-running': 'pluginEventSourceToolRunning',
    idle: 'pluginEventSourceIdle',
    done: 'pluginEventSourceDone',
    error: 'pluginEventSourceError',
  }
  return t(labels[state])
}

function formatTime(timestamp: number): string {
  return formatTimeFull(timestamp, locale.value)
}

</script>

<template>
  <div id="panel-sessions" role="tabpanel" aria-labelledby="tab-sessions" class="dashboard-tab-panel">
    <div v-if="activeSessionList.length > 0" class="session-filter-bar">
      <SegmentedControl
        v-model="filter"
        :options="filterOptions"
        :ariaLabel="t('panel.filterLabel')"
        semantics="radio"
        id-prefix="session-filter-"
        size="sm"
      />
      <Select v-model="sourceFamily" size="sm" :aria-label="t('panel.sourceFilterLabel')">
        <option value="all">{{ t('panel.sourceAll') }}</option>
        <option v-for="family in SOURCE_FAMILIES" :key="family.key" :value="family.key">{{ family.label }}</option>
      </Select>
      <Select v-model="sort" size="sm" :aria-label="t('panel.sortLabel')">
        <option value="priority">{{ t('panel.sortPriority') }}</option>
        <option value="recent">{{ t('panel.sortRecent') }}</option>
      </Select>
    </div>

    <div class="session-scroll">
      <EmptyState
        v-if="activeSessionList.length === 0 && offlineSessionList.length === 0 && pluginEventSourceStatuses.length === 0"
        icon="desktop"
        :title="t('noActiveSessions')"
        :description="t('panel.noSessionsHint')"
      />

      <template v-else>
        <EmptyState v-if="noMatches" :title="t('panel.noMatchingSessions')" />

        <section v-for="group in visibleGroups" :key="group.id" class="session-group">
          <div class="session-group-heading">
            <span>{{ group.title }} ({{ group.sessions.length }})</span>
            <small v-if="group.id === visibleGroups[0].id">{{ t('activeToolFamilies', { count: activeToolFamilyCount }) }}</small>
          </div>
          <Card class="session-card">
            <SessionRow
              v-for="session in group.sessions"
              :key="session.key"
              :session="session"
              :project-label="projectLabel(session.project)"
              :detail="sessionDetail(session)"
              :live="LIVE_STATES.has(session.state)"
            />
          </Card>
        </section>

        <section v-if="hasOffline" class="offline-group">
          <div class="session-group-heading offline-heading">
            <span>{{ t('offlineSessions') }} ({{ groups.offline.length }})</span>
            <Button variant="danger" size="sm" @click="store.clearOfflineSessions()">
              {{ t('clearShort') }}
            </Button>
          </div>
          <div v-for="session in groups.offline" :key="session.key" class="offline-session-item">
            <span class="session-status-dot" aria-hidden="true" />
            <span class="session-title-line" :title="session.project || undefined">{{ SOURCE_LABELS[session.source] }}<template v-if="session.project"> · {{ projectLabel(session.project) }}</template></span>
            <span class="session-time">{{ formatTime(session.lastSeenAt) }}</span>
            <Button variant="ghost" size="sm" icon-only :title="t('panel.removeSession')" :aria-label="`${t('panel.removeSession')} ${SOURCE_LABELS[session.source]} ${projectLabel(session.project)}`" @click="store.removeSession(session.key)">
              <Icon name="close" :size="12" />
            </Button>
          </div>
        </section>

        <section v-if="pluginEventSourceStatuses.length > 0" class="session-group plugin-event-source-group">
          <div class="session-group-heading">
            <span>{{ t('pluginEventSourceHeading') }}</span>
            <Button variant="ghost" size="sm" @click="emit('managePlugins')">{{ t('panel.managePlugins') }}</Button>
          </div>
          <Card class="session-card">
            <div
              v-for="status in pluginEventSourceStatuses"
              :key="status.key"
              class="session-item"
            >
              <div class="session-row">
                <span class="session-status-dot" :class="{ live: status.state === 'thinking' || status.state === 'tool-running' }" aria-hidden="true" />
                <div class="session-info">
                  <span class="session-title-line">{{ t('pluginEventSourceFromPlugin', { name: status.pluginName[locale] }) }}</span>
                  <span class="session-detail">{{ status.displayName[locale] }}</span>
                </div>
                <div class="session-state-column">
                  <span class="state-chip">{{ pluginEventSourceStateLabel(status.state) }}</span>
                  <span class="session-time">{{ formatTime(status.updatedAt) }}</span>
                </div>
              </div>
            </div>
          </Card>
        </section>
      </template>
    </div>

    <div v-if="quotaStripFamilies.length > 0" class="quota-strip" :aria-label="t('quotaStripLabel')">
      <div v-for="family in quotaStripFamilies" :key="family.id" class="quota-strip-column">
        <div class="quota-strip-heading">
          <span>{{ family.label }}</span>
          <strong>{{ quotaPercent(family.remainingPercent) }}</strong>
        </div>
        <ProgressTrack :value="family.remainingPercent" :tone="QUOTA_STRIP_TONE[quotaTone(family.remainingPercent)]" size="sm" decorative />
        <span class="quota-strip-reset">{{ formatReset(family.resetsAt) }}</span>
      </div>
    </div>
  </div>
</template>
