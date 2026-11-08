<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { t, type TranslationKey } from '@/i18n'
import { useHistoryFormat } from '@/composables/useHistoryFormat'
import { STATE_LABELS } from '@/types/agent'
import {
  HISTORY_SESSION_TIMELINE_MAX,
  type HistorySessionDetail,
  type HistorySessionListItem,
  type HistorySessionOutcome,
} from '@/types/history'
import { agentDisplayName } from '@/utils/agent-label'
import { formatDateTime, formatTimeFull } from '@/utils/intl-format'
import { stateAriaLabel } from '@/utils/state-aria'
import Dialog from '@/components/ui/Dialog.vue'
import Skeleton from '@/components/ui/Skeleton.vue'

// 單一工作階段的時間軸對話框：狀態轉換（工具只顯示名稱）與每段持續時間。
const props = defineProps<{ session: HistorySessionListItem | null; projectName: string }>()
const emit = defineEmits<{ close: [] }>()
const { tokens, duration } = useHistoryFormat()

const OUTCOME_LABEL_KEYS: Record<HistorySessionOutcome, TranslationKey> = {
  success: 'growth.outcomeSuccess',
  error: 'growth.outcomeError',
  cancelled: 'growth.outcomeCancelled',
  active: 'growth.outcomeActive',
  incomplete: 'growth.outcomeIncomplete',
}

const TERMINAL_STATES = new Set(['success', 'error', 'offline'])

const detail = shallowRef<HistorySessionDetail | null>(null)
const loading = ref(false)
const failed = ref(false)
let requestSeq = 0

watch(() => props.session?.id, async id => {
  const seq = ++requestSeq
  detail.value = null
  failed.value = false
  if (!id) return
  loading.value = true
  try {
    const result = await window.electronAPI?.getHistorySessionDetail(id)
    if (seq !== requestSeq) return
    detail.value = result ?? null
    failed.value = !result
  } catch {
    if (seq === requestSeq) failed.value = true
  } finally {
    if (seq === requestSeq) loading.value = false
  }
}, { immediate: true })

// Prefer the freshly read row; fall back to the list row while loading.
const current = computed(() => detail.value?.session ?? props.session)

const description = computed(() => {
  const session = current.value
  if (!session) return ''
  const range = t('growth.sessionDetailRange', { start: formatDateTime(session.startedAt), end: formatDateTime(session.lastSeenAt) })
  return `${agentDisplayName(session.adapterId)} · ${range}`
})

/** Each entry lasts until the next one; the last until the session's last activity. */
const timeline = computed(() => {
  const entries = detail.value?.timeline ?? []
  const endAt = current.value?.lastSeenAt ?? 0
  return entries.map((entry, index) => ({
    ...entry,
    key: `${index}-${entry.occurredAt}`,
    // A terminal last entry has no meaningful duration of its own.
    spanMs: index === entries.length - 1 && TERMINAL_STATES.has(entry.state)
      ? null
      : Math.max(0, (entries[index + 1]?.occurredAt ?? endAt) - entry.occurredAt),
  }))
})

// Read as one sentence: translated state, tool, time and duration.
function entryAriaLabel(entry: { occurredAt: number; state: string; toolName?: string; spanMs: number | null }): string {
  return [
    stateAriaLabel(entry.state),
    entry.toolName ?? '',
    formatTimeFull(entry.occurredAt),
    entry.spanMs === null ? '' : t('growth.sessionTimelineFor', { duration: duration(entry.spanMs) }),
  ].filter(Boolean).join(' · ')
}

function unknownOr(tracked: boolean, value: string): string {
  return tracked ? value : t('growth.sessionUnknown')
}
</script>

<template>
  <Dialog
    :open="Boolean(session)"
    :title="projectName"
    :description="description"
    size="lg"
    show-close
    @close="emit('close')"
  >
    <template v-if="current">
      <dl class="detail-facts">
        <div><dt>{{ t('growth.sessionOutcome') }}</dt><dd>{{ t(OUTCOME_LABEL_KEYS[current.outcome]) }}</dd></div>
        <div><dt>{{ t('growth.sessionDuration') }}</dt><dd>{{ duration(current.durationMs) }}</dd></div>
        <div><dt>{{ t('growth.sessionActiveTime') }}</dt><dd>{{ duration(current.activeMs) }}</dd></div>
        <div>
          <dt>{{ t('growth.sessionTokens') }}</dt>
          <dd>
            <template v-if="current.tokenSource === 'none'">{{ t('growth.sessionUnknown') }}</template>
            <template v-else>
              {{ t('growth.sessionTokensValue', { input: tokens(current.tokenInput, 'full'), output: tokens(current.tokenOutput, 'full') }) }}
              <span v-if="current.tokenCacheRead + current.tokenCacheWrite > 0" class="detail-muted">{{ t('growth.cacheNote', { value: tokens(current.tokenCacheRead + current.tokenCacheWrite) }) }}</span>
              <span class="detail-muted">{{ t(current.tokenSource === 'local' ? 'growth.sessionTokenSourceLocal' : 'growth.sessionTokenSourceHook') }}</span>
            </template>
          </dd>
        </div>
        <div><dt>{{ t('growth.sessionModel') }}</dt><dd class="detail-truncate" :title="current.topModel || undefined">{{ current.topModel || t('growth.sessionUnknown') }}</dd></div>
        <div><dt>{{ t('growth.sessionToolRuns') }}</dt><dd>{{ unknownOr(current.tracked, String(current.toolRuns)) }}</dd></div>
        <div>
          <dt>{{ t('growth.sessionPermission') }}</dt>
          <dd>{{ unknownOr(current.tracked, t('growth.sessionPermissionValue', { count: current.permissionWaits, duration: duration(current.permissionWaitMs) })) }}</dd>
        </div>
      </dl>

      <h3 class="detail-heading">{{ t('growth.sessionTimeline') }}</h3>
      <div v-if="loading" aria-busy="true"><Skeleton variant="line" :lines="4" /></div>
      <p v-else-if="failed" class="detail-muted" role="alert">{{ t('growth.sessionDetailError') }}</p>
      <p v-else-if="timeline.length === 0" class="detail-muted">{{ t('growth.sessionTimelineEmpty') }}</p>
      <template v-else>
        <p v-if="detail?.truncated" class="detail-muted">{{ t('growth.sessionTimelineTruncated', { count: HISTORY_SESSION_TIMELINE_MAX }) }}</p>
        <p v-else-if="!current.tracked" class="detail-muted">{{ t('growth.sessionTimelinePartial') }}</p>
        <ol class="detail-timeline">
          <li
            v-for="entry in timeline"
            :key="entry.key"
            class="detail-entry"
            :class="`state-${entry.state}`"
            :aria-label="entryAriaLabel(entry)"
          >
            <time class="detail-time" :datetime="new Date(entry.occurredAt).toISOString()">{{ formatTimeFull(entry.occurredAt) }}</time>
            <span class="detail-marker" aria-hidden="true" />
            <span class="detail-state">
              <span class="detail-state-label">{{ STATE_LABELS[entry.state] ?? entry.state }}</span>
              <code v-if="entry.toolName" class="detail-tool" :title="entry.toolName">{{ entry.toolName }}</code>
            </span>
            <span class="detail-span">{{ entry.spanMs === null ? '' : t('growth.sessionTimelineFor', { duration: duration(entry.spanMs) }) }}</span>
          </li>
        </ol>
      </template>
    </template>
  </Dialog>
</template>

<style scoped>
.detail-facts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--space-2) var(--space-3);
  margin: 0;
}

.detail-facts > div {
  min-width: 0;
}

.detail-facts dt {
  color: var(--text-muted);
  font-size: var(--font-xs);
}

.detail-facts dd {
  display: flex;
  flex-direction: column;
  margin: 0;
  color: var(--text-primary);
  font-size: var(--font-sm);
}

.detail-truncate,
.detail-tool {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-heading {
  margin: var(--space-2) 0 0;
  color: var(--text-primary);
  font-size: var(--font-md);
  font-weight: var(--weight-bold);
}

.detail-muted {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-xs);
}

.detail-timeline {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.detail-entry {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) 0;
  border-bottom: 1px solid var(--border-subtle);
  font-size: var(--font-xs);
  content-visibility: auto;
  contain-intrinsic-size: auto 28px;
}

.detail-time,
.detail-span {
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* The marker shape plus the state text carry the meaning; colour only adds to it. */
.detail-marker {
  width: var(--space-2);
  height: var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--state-idle);
}

.state-thinking .detail-marker,
.state-tool-running .detail-marker {
  background: var(--state-info);
}

.state-waiting-permission .detail-marker,
.state-waiting-input .detail-marker {
  border-radius: 0;
  background: var(--state-warn);
}

.state-success .detail-marker {
  background: var(--state-success);
}

.state-error .detail-marker {
  border-radius: 0;
  background: var(--state-error);
}

.detail-state {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--space-2);
  color: var(--text-primary);
}

.detail-state-label {
  flex-shrink: 0;
  white-space: nowrap;
}

.detail-tool {
  padding: 0 var(--space-1);
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  color: var(--text-secondary);
  font-size: var(--font-xs);
}
</style>
