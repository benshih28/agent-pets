<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { t, type TranslationKey } from '@/i18n'
import { useHistoryFormat } from '@/composables/useHistoryFormat'
import { useAgentStore } from '@/stores/agentStore'
import { AGENT_ADAPTER_REGISTRY } from '@/types/agent-adapter'
import {
  HISTORY_SESSION_OUTCOMES,
  HISTORY_SESSION_PAGE_DEFAULT,
  HISTORY_SESSION_SEARCH_MAX,
  type HistorySessionCursor,
  type HistorySessionListItem,
  type HistorySessionOutcome,
  type HistorySessionQuery,
} from '@/types/history'
import { agentDisplayName } from '@/utils/agent-label'
import { formatDateTime } from '@/utils/intl-format'
import GrowthEmptyState from '@/components/growth/GrowthEmptyState.vue'
import HistorySessionDetail from '@/components/growth/HistorySessionDetail.vue'
import Badge from '@/components/ui/Badge.vue'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Select from '@/components/ui/Select.vue'
import TextField from '@/components/ui/TextField.vue'

// 歷史分頁的「工作階段」清單：只顯示中繼資料（狀態、工具次數、token、時間），
// 以 keyset 分頁「載入更多」，篩選條件變動時從第一頁重新查詢。
const props = defineProps<{ active: boolean; rangeDays: number; projectId: string }>()
const store = useAgentStore()
const { tokens, duration } = useHistoryFormat()

const DAY_MS = 24 * 60 * 60 * 1000
const SEARCH_DEBOUNCE_MS = 250
const REFRESH_DEBOUNCE_MS = 800

const OUTCOME_LABEL_KEYS: Record<HistorySessionOutcome, TranslationKey> = {
  success: 'growth.outcomeSuccess',
  error: 'growth.outcomeError',
  cancelled: 'growth.outcomeCancelled',
  active: 'growth.outcomeActive',
  incomplete: 'growth.outcomeIncomplete',
}
const OUTCOME_TONES: Record<HistorySessionOutcome, 'success' | 'danger' | 'neutral' | 'accent' | 'warn'> = {
  success: 'success',
  error: 'danger',
  cancelled: 'neutral',
  active: 'accent',
  incomplete: 'warn',
}

// --- filters -----------------------------------------------------------------
const adapterFilter = ref('')
const outcomeFilter = ref('')
const search = ref('')
const appliedSearch = ref('')
const customRange = ref(false)
const fromDate = ref('')
const toDate = ref('')
let searchTimer: ReturnType<typeof setTimeout> | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null

const adapterOptions = AGENT_ADAPTER_REGISTRY.map(entry => ({ id: entry.id, label: entry.displayName }))

/**
 * Local midnight of a YYYY-MM-DD from <input type="date"> plus `dayOffset`
 * days; NaN when empty or invalid. Day arithmetic goes through Date so a DST
 * day (23 or 25 hours) still ends at the next local midnight.
 */
function localDayStart(value: string, dayOffset = 0): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return Number.NaN
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + dayOffset).getTime()
}

function currentQuery(): HistorySessionQuery {
  const query: HistorySessionQuery = {}
  if (props.projectId) query.projectId = props.projectId
  if (adapterFilter.value) query.adapterId = adapterFilter.value
  if (outcomeFilter.value) query.outcome = outcomeFilter.value as HistorySessionOutcome
  if (appliedSearch.value) query.search = appliedSearch.value
  if (customRange.value) {
    const from = localDayStart(fromDate.value)
    const to = localDayStart(toDate.value, 1)
    if (Number.isFinite(from)) query.from = from
    if (Number.isFinite(to)) query.to = to - 1
  } else {
    query.from = Date.now() - props.rangeDays * DAY_MS
  }
  return query
}

// --- loading -----------------------------------------------------------------
// shallowRef: rows are replaced or appended as whole arrays, never mutated in place.
const items = shallowRef<HistorySessionListItem[]>([])
const nextCursor = ref<HistorySessionCursor | null>(null)
const loading = ref(false)
const loadingMore = ref(false)
const error = ref(false)
const loaded = ref(false)
const loadMoreFailed = ref(false)
let requestSeq = 0
// The query of the first page, reused (with the cursor) for every later page:
// recomputing it would move the rolling "last N days" bound between pages.
let pageQuery: HistorySessionQuery = {}

async function reload(): Promise<void> {
  const seq = ++requestSeq
  loading.value = true
  error.value = false
  loadMoreFailed.value = false
  pageQuery = currentQuery()
  try {
    const page = await window.electronAPI?.listHistorySessions(pageQuery)
    if (seq !== requestSeq) return
    items.value = page?.items ?? []
    nextCursor.value = page?.nextCursor ?? null
    loaded.value = true
  } catch {
    if (seq === requestSeq) error.value = true
  } finally {
    if (seq === requestSeq) loading.value = false
  }
}

async function loadMore(): Promise<void> {
  const cursor = nextCursor.value
  if (!cursor || loadingMore.value) return
  const seq = requestSeq
  loadingMore.value = true
  loadMoreFailed.value = false
  try {
    const page = await window.electronAPI?.listHistorySessions({ ...pageQuery, cursor })
    // A filter change while this page was in flight makes it stale.
    if (seq !== requestSeq || !page) return
    const known = new Set(items.value.map(item => item.id))
    items.value = [...items.value, ...page.items.filter(item => !known.has(item.id))]
    nextCursor.value = page.nextCursor
  } catch {
    if (seq === requestSeq) loadMoreFailed.value = true
  } finally {
    loadingMore.value = false
  }
}

function onSearchInput(value: string): void {
  search.value = value
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    searchTimer = null
    const trimmed = value.trim().slice(0, HISTORY_SESSION_SEARCH_MAX)
    if (trimmed !== appliedSearch.value) appliedSearch.value = trimmed
  }, SEARCH_DEBOUNCE_MS)
}

watch(
  () => [props.active, props.rangeDays, props.projectId, adapterFilter.value, outcomeFilter.value, appliedSearch.value, customRange.value, fromDate.value, toDate.value],
  () => { if (props.active) void reload() },
  { immediate: true },
)

// --- labels ------------------------------------------------------------------
const projectNames = computed(() => new Map(store.projectPets.map(project => [project.projectId, project.displayName])))

function projectName(item: HistorySessionListItem): string {
  return projectNames.value.get(item.projectId) || item.projectLabel || t('growth.sessionsNoProject')
}

function outcomeLabel(outcome: HistorySessionOutcome): string {
  return t(OUTCOME_LABEL_KEYS[outcome])
}

function metaLine(item: HistorySessionListItem): string {
  const parts = [duration(item.durationMs)]
  if (item.tracked) {
    parts.push(t('growth.sessionsTools', { count: item.toolRuns }))
    if (item.permissionWaits > 0) parts.push(t('growth.sessionsPermissionWaits', { count: item.permissionWaits }))
  } else {
    parts.push(t('growth.sessionsCountsUnknown'))
  }
  if (item.tokenInput + item.tokenOutput > 0) parts.push(t('growth.sessionsTokens', { value: tokens(item.tokenInput + item.tokenOutput) }))
  if (item.topModel) parts.push(item.topModel)
  return parts.join(' · ')
}

// --- detail ------------------------------------------------------------------
const selected = shallowRef<HistorySessionListItem | null>(null)

// --- lifecycle ---------------------------------------------------------------
let cleanupHistoryUpdated: (() => void) | null = null
onMounted(() => {
  cleanupHistoryUpdated = window.electronAPI?.onHistoryUpdated(() => {
    // Only the first page refreshes on its own; a reader who loaded more
    // pages keeps their place instead of the list jumping under them.
    if (!props.active || items.value.length > HISTORY_SESSION_PAGE_DEFAULT || selected.value) return
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => { refreshTimer = null; void reload() }, REFRESH_DEBOUNCE_MS)
  }) ?? null
})
onUnmounted(() => {
  cleanupHistoryUpdated?.()
  if (searchTimer) clearTimeout(searchTimer)
  if (refreshTimer) clearTimeout(refreshTimer)
  requestSeq += 1
})
</script>

<template>
  <section class="sessions" :aria-busy="loading ? 'true' : undefined">
    <p class="sessions-privacy">{{ t('growth.sessionsPrivacy') }}</p>
    <div class="sessions-filters">
      <TextField
        :model-value="search"
        size="sm"
        search
        class="sessions-search"
        :aria-label="t('growth.sessionsSearch')"
        :placeholder="t('growth.sessionsSearch')"
        :clear-label="t('growth.sessionsClearSearch')"
        @update:model-value="onSearchInput"
      />
      <Select v-model="adapterFilter" size="sm" :aria-label="t('growth.sessionsFilterAgent')">
        <option value="">{{ t('growth.sessionsAllAgents') }}</option>
        <option v-for="adapter in adapterOptions" :key="adapter.id" :value="adapter.id">{{ adapter.label }}</option>
      </Select>
      <Select v-model="outcomeFilter" size="sm" :aria-label="t('growth.sessionsFilterOutcome')">
        <option value="">{{ t('growth.sessionsAllOutcomes') }}</option>
        <option v-for="outcome in HISTORY_SESSION_OUTCOMES" :key="outcome" :value="outcome">{{ outcomeLabel(outcome) }}</option>
      </Select>
      <Button size="sm" :active="customRange" :aria-pressed="customRange ? 'true' : 'false'" @click="customRange = !customRange">
        {{ t('growth.sessionsCustomRange') }}
      </Button>
    </div>
    <div v-if="customRange" class="sessions-dates">
      <Input v-model="fromDate" type="date" size="sm" :label="t('growth.sessionsFrom')" />
      <Input v-model="toDate" type="date" size="sm" :label="t('growth.sessionsTo')" />
    </div>

    <GrowthEmptyState v-if="loading && !loaded" :title="t('checking')" busy />
    <GrowthEmptyState v-else-if="error && items.length === 0" tone="error" icon="warning" :title="t('growth.sessionsError')">
      <Button variant="secondary" size="sm" @click="reload">{{ t('growth.retry') }}</Button>
    </GrowthEmptyState>
    <GrowthEmptyState
      v-else-if="loaded && items.length === 0"
      :title="t('growth.sessionsEmptyTitle')"
      :description="t('growth.sessionsEmptyBody')"
    />
    <template v-else>
      <ul class="sessions-list">
        <li v-for="item in items" :key="item.id" class="sessions-item">
          <!-- raw-control: 整列可點的清單列，內含徽章與多欄文字，不是動作按鈕 -->
          <button
            type="button"
            class="sessions-row"
            :aria-label="t('growth.sessionsOpenDetail', { name: projectName(item) })"
            @click="selected = item"
          >
            <span class="sessions-row-head">
              <Badge :tone="OUTCOME_TONES[item.outcome]" dot>{{ outcomeLabel(item.outcome) }}</Badge>
              <span class="sessions-title" :title="`${agentDisplayName(item.adapterId)} · ${projectName(item)}`">
                {{ agentDisplayName(item.adapterId) }} · {{ projectName(item) }}
              </span>
              <time class="sessions-time" :datetime="new Date(item.lastSeenAt).toISOString()">{{ formatDateTime(item.lastSeenAt) }}</time>
            </span>
            <span class="sessions-meta" :title="metaLine(item)">{{ metaLine(item) }}</span>
          </button>
        </li>
      </ul>
      <div class="sessions-footer">
        <span class="sessions-count" role="status">{{ t('growth.sessionsShown', { count: items.length }) }}</span>
        <span v-if="loadMoreFailed" class="sessions-load-error" role="alert">{{ t('growth.sessionsLoadMoreFailed') }}</span>
        <Button v-if="nextCursor" variant="secondary" size="sm" :loading="loadingMore" @click="loadMore">
          {{ loadMoreFailed ? t('growth.retry') : t('growth.sessionsLoadMore') }}
        </Button>
      </div>
    </template>

    <HistorySessionDetail
      :session="selected"
      :project-name="selected ? projectName(selected) : ''"
      @close="selected = null"
    />
  </section>
</template>

<style scoped>
.sessions {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-3);
}

.sessions-privacy,
.sessions-count {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-xs);
}

.sessions-filters,
.sessions-dates {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--space-2);
}

.sessions-search {
  flex: 1 1 160px;
  min-width: 0;
}

.sessions-dates > * {
  flex: 1 1 120px;
}

.sessions-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

/* Rows are content-layer: flat raised tint, no backdrop blur. Off-screen rows
   skip layout and paint until scrolled near, which keeps long loaded lists cheap. */
.sessions-item {
  content-visibility: auto;
  contain-intrinsic-size: auto 56px;
}

.sessions-row {
  display: flex;
  width: 100%;
  min-width: 0;
  min-height: var(--hit-min);
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-raised);
  color: var(--text-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background var(--transition-fast), border-color var(--transition-fast);
}

.sessions-row:hover {
  border-color: var(--border-strong);
  background: var(--surface-raised-hover);
}

/* content-visibility on the item clips paint to its box, so the ring is drawn
   inside; the extra class outranks the panel-wide :focus-visible offset. */
.sessions-list .sessions-row:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: calc(var(--focus-ring-width) * -1);
}

.sessions-row-head {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--space-2);
}

.sessions-row-head > :first-child,
.sessions-time {
  flex-shrink: 0;
}

.sessions-title,
.sessions-meta {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sessions-title {
  flex: 1 1 auto;
  font-size: var(--font-sm);
  font-weight: var(--weight-medium);
}

.sessions-time,
.sessions-meta {
  color: var(--text-muted);
  font-size: var(--font-xs);
}

.sessions-load-error {
  margin-left: auto;
  color: var(--text-danger);
  font-size: var(--font-xs);
}

.sessions-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

@media (prefers-reduced-motion: reduce) {
  .sessions-row {
    transition: none;
  }
}
</style>
