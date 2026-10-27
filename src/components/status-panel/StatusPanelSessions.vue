<script setup lang="ts">
import { computed } from 'vue'
import { locale, t } from '@/i18n'
import { useAgentStore } from '@/stores/agentStore'
import { SOURCE_FAMILIES, SOURCE_LABELS, STATE_COLORS, STATE_LABELS, STATE_LABELS_SHORT } from '@/types/agent'
import type { PluginEventSourceState, PluginEventSourceStatusView } from '@/types/plugin'
import { formatProject, roundQuotaPercent } from '@/utils/format'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import ProgressTrack from '@/components/ui/ProgressTrack.vue'

const props = defineProps<{ nowTick: number; pluginEventSourceStatuses: PluginEventSourceStatusView[] }>()
const store = useAgentStore()
const LIVE_STATES = new Set(['thinking', 'tool-running', 'waiting-permission', 'waiting-input'])

const activeSessionList = computed(() => store.sessionList.filter(session => session.state !== 'offline'))
const offlineSessionList = computed(() => store.sessionList.filter(session => session.state === 'offline'))
const hasOffline = computed(() => offlineSessionList.value.length > 0)
const activeToolFamilyCount = computed(() => new Set(
  activeSessionList.value.map(session => SOURCE_FAMILIES.find(family => family.sources.includes(session.source))?.key ?? session.source),
).size)
const quotaStripFamilies = computed(() => (
  (['codex', 'claude'] as const).flatMap((id) => {
    const quota = store.quotaByFamily[id]
    if (!quota) return []
    return [{ id, ...quota, label: id === 'codex' ? 'Codex' : 'Claude' }]
  })
))

function elapsedLabel(session: { state: string; lastSeenAt: number }): string | null {
  if (!LIVE_STATES.has(session.state)) return null
  const seconds = Math.max(0, (props.nowTick - session.lastSeenAt) / 1000)
  return `${seconds.toFixed(1)}s`
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
  return new Date(timestamp).toLocaleTimeString(locale.value)
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

function quotaPercent(value: number): string {
  return `${roundQuotaPercent(value)}%`
}

</script>

<template>
  <div id="panel-sessions" role="tabpanel" aria-labelledby="tab-sessions" class="tab-panel">
    <div class="session-scroll">
      <div v-if="activeSessionList.length === 0 && offlineSessionList.length === 0 && pluginEventSourceStatuses.length === 0" class="panel-empty">
        {{ t('noActiveSessions') }}
      </div>

      <template v-else>
        <section v-if="activeSessionList.length > 0" class="session-group">
          <div class="session-group-heading">
            <span>{{ t('activeSessions') }}</span>
            <small>{{ t('activeToolFamilies', { count: activeToolFamilyCount }) }}</small>
          </div>
          <Card class="session-card">
            <div
              v-for="(session, index) in activeSessionList"
              :key="session.key"
              class="session-item"
              :class="{ 'is-last': index === activeSessionList.length - 1 }"
            >
              <span
                class="session-status-dot"
                :class="{ live: LIVE_STATES.has(session.state) }"
                :style="{ '--status-color': STATE_COLORS[session.state] }"
                aria-hidden="true"
              />
              <div class="session-info">
                <span class="session-title-line">
                  {{ SOURCE_LABELS[session.source] }}<template v-if="session.project"> · {{ formatProject(session.project) }}</template>
                </span>
                <span class="session-detail">{{ sessionDetail(session) }}</span>
              </div>
              <div class="session-state-column">
                <span
                  class="state-chip"
                  :class="[`state-${session.state}`, { live: LIVE_STATES.has(session.state) }]"
                  :style="{ '--status-color': STATE_COLORS[session.state] }"
                >
                  {{ STATE_LABELS_SHORT[session.state] }}
                </span>
                <span class="session-time">{{ elapsedLabel(session) || formatTime(session.lastSeenAt) }}</span>
              </div>
            </div>
          </Card>
        </section>

        <section v-if="hasOffline" class="offline-group">
          <div class="session-group-heading offline-heading">
            <span>{{ t('offlineSessions') }}</span>
            <Button variant="danger" size="sm" @click="store.clearOfflineSessions()">
              {{ t('clearShort') }}
            </Button>
          </div>
          <div v-for="session in offlineSessionList" :key="session.key" class="offline-session-item">
            <span class="session-status-dot" aria-hidden="true" />
            <span class="session-title-line">{{ SOURCE_LABELS[session.source] }}<template v-if="session.project"> · {{ formatProject(session.project) }}</template></span>
            <span class="session-time">{{ formatTime(session.lastSeenAt) }}</span>
          </div>
        </section>

        <section v-if="pluginEventSourceStatuses.length > 0" class="session-group plugin-event-source-group">
          <div class="session-group-heading"><span>{{ t('pluginEventSourceHeading') }}</span></div>
          <Card class="session-card">
            <div
              v-for="(status, index) in pluginEventSourceStatuses"
              :key="status.key"
              class="session-item"
              :class="{ 'is-last': index === pluginEventSourceStatuses.length - 1 }"
            >
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
        <ProgressTrack :value="family.remainingPercent" tone="success" size="sm" decorative />
        <span class="quota-strip-reset">{{ formatReset(family.resetsAt) }}</span>
      </div>
    </div>
  </div>
</template>
