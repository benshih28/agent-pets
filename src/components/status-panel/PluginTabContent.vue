<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { locale, t, type TranslationKey } from '@/i18n'
import { useAgentStore } from '@/stores/agentStore'
import { useToast } from '@/composables/useToast'
import Button from '@/components/ui/Button.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Icon from '@/components/ui/Icon.vue'
import Skeleton from '@/components/ui/Skeleton.vue'
import Spinner from '@/components/ui/Spinner.vue'
import { formatDateTime } from '@/utils/intl-format'
import { isCurrentPluginPanelViewClose, pluginPanelViewCloseError } from '@/utils/plugin-panel-view'
import type { PluginDashboardTab } from '@/composables/usePluginTabs'
import type { PluginNotificationRecord, PluginPanelViewClosedEvent } from '@/types/plugin'

// One plugin's dashboard tab. A plugin with a panel view embeds it in the content area
// through the same open / bounds / close IPC as the Settings plugin page; every other
// plugin gets a native summary (recent feed, commands, links to Settings -> Plugins).
const props = defineProps<{
  tab: PluginDashboardTab
  active: boolean
  feed: PluginNotificationRecord[]
  loading: boolean
}>()
const emit = defineEmits<{ openSettings: [pluginId: string]; openDetail: [pluginId: string] }>()

const store = useAgentStore()
const toast = useToast()

const hasPanelView = computed(() => Boolean(props.tab.plugin.manifest?.contributes.panelView))
const pluginTitle = computed(() => props.tab.plugin.manifest?.contributes.panelView?.title[locale.value] || props.tab.label)
const commands = computed(() => props.tab.plugin.manifest?.contributes.commands ?? [])
const recentFeed = computed(() => [...props.feed].sort((a, b) => b.item.createdAt - a.item.createdAt).slice(0, 8))

const frame = ref<HTMLElement | null>(null)
const content = ref<HTMLElement | null>(null)
const openToken = ref(0)
const viewError = ref('')
const opening = ref(false)
const invoking = ref('')
let sequence = 0
let openTimer: ReturnType<typeof setTimeout> | null = null
let observer: ResizeObserver | null = null
let removeClosedListener: (() => void) | null = null

const ERROR_KEYS: Record<string, TranslationKey> = {
  disabled: 'pluginPanelUnavailable',
  host_unavailable: 'pluginCommandHostUnavailable',
  not_permitted: 'pluginCommandNotPermitted',
  rate_limited: 'pluginCommandRateLimited',
  panel_unavailable: 'pluginPanelViewUnavailable',
  panel_load_failed: 'pluginPanelViewLoadFailed',
  panel_crashed: 'pluginPanelViewCrashed',
  panel_closed: 'pluginPanelViewClosed',
  plugin_service_unavailable: 'pluginServiceUnavailable',
  plugin_not_found: 'pluginNotFound',
  invalid_request: 'plugins.errInvalidRequest',
}

function localizedError(code: string): string {
  return t(ERROR_KEYS[code] ?? 'pluginActionFailed')
}

function readBounds(): { frame: DOMRect; content: DOMRect } | null {
  const f = frame.value?.getBoundingClientRect()
  const c = content.value?.getBoundingClientRect()
  if (!f || !c || f.width < 1 || f.height < 1 || c.width < 1 || c.height < 1) return null
  return { frame: f, content: c }
}

function rect(r: DOMRect) {
  return { x: r.left, y: r.top, width: r.width, height: r.height }
}

let boundsFrame = 0
let lastSentKey = ''

function sendBounds(): void {
  const token = openToken.value
  const bounds = readBounds()
  if (!token || !bounds) return
  const next = { frame: rect(bounds.frame), content: rect(bounds.content), viewport: { width: window.innerWidth, height: window.innerHeight } }
  const key = `${token}|${JSON.stringify(next)}`
  if (key === lastSentKey) return
  lastSentKey = key
  window.electronAPI?.setPluginPanelViewBounds(token, next.frame, next.content, next.viewport)
}

// Scroll / resize / ResizeObserver can fire many times per frame; send at most once per frame.
function scheduleBounds(): void {
  if (boundsFrame) return
  boundsFrame = requestAnimationFrame(() => { boundsFrame = 0; sendBounds() })
}

function stopTracking(): void {
  observer?.disconnect()
  observer = null
  window.removeEventListener('resize', scheduleBounds)
  window.removeEventListener('scroll', scheduleBounds, true)
  if (boundsFrame) cancelAnimationFrame(boundsFrame)
  boundsFrame = 0
  lastSentKey = ''
}

function startTracking(): void {
  stopTracking()
  if (!frame.value || !content.value) return
  observer = new ResizeObserver(scheduleBounds)
  observer.observe(frame.value)
  observer.observe(content.value)
  window.addEventListener('resize', scheduleBounds)
  window.addEventListener('scroll', scheduleBounds, true)
}

// Closes the native view first so it can never linger over other UI.
function closeView(): void {
  sequence += 1
  if (openTimer) clearTimeout(openTimer)
  openTimer = null
  stopTracking()
  const token = openToken.value
  openToken.value = 0
  opening.value = false
  if (token) window.electronAPI?.closePluginPanelView(token)
}

async function openView(): Promise<void> {
  if (!hasPanelView.value || !props.active) return
  const mySequence = ++sequence
  viewError.value = ''
  opening.value = true
  const previous = openToken.value
  openToken.value = 0
  if (previous) window.electronAPI?.closePluginPanelView(previous)
  await nextTick()
  if (mySequence !== sequence) return
  const bounds = readBounds()
  if (!bounds) { opening.value = false; viewError.value = 'panel_unavailable'; return }
  try {
    const result = await window.electronAPI?.openPluginPanelView(props.tab.pluginId, rect(bounds.frame), rect(bounds.content))
    if (mySequence !== sequence) {
      if (result?.ok) window.electronAPI?.closePluginPanelView(result.value.openToken)
      return
    }
    opening.value = false
    if (!result?.ok) { viewError.value = result && !result.ok ? result.error : 'plugin_service_unavailable'; return }
    openToken.value = result.value.openToken
    startTracking()
    await nextTick()
    sendBounds()
  } catch {
    if (mySequence !== sequence) return
    opening.value = false
    viewError.value = 'plugin_service_unavailable'
  }
}

// Arrow-key browsing across tabs must not spin up a native view per stop.
function scheduleOpen(): void {
  if (openTimer) clearTimeout(openTimer)
  openTimer = setTimeout(() => { openTimer = null; void openView() }, 150)
}

function onViewClosed(event: PluginPanelViewClosedEvent): void {
  if (!isCurrentPluginPanelViewClose(event, props.tab.pluginId, openToken.value)) return
  sequence += 1
  stopTracking()
  openToken.value = 0
  const error = pluginPanelViewCloseError(event.reason)
  // A view hidden with the panel window is reopened the next time the panel opens.
  viewError.value = error === 'hidden' ? '' : error
}

async function runCommand(commandId: string, title: string): Promise<void> {
  if (invoking.value) return
  invoking.value = commandId
  try {
    const result = await window.electronAPI?.invokePluginCommand(props.tab.pluginId, commandId)
    if (result?.ok) toast.push({ tone: 'success', message: t('plugins.commandSentNamed', { command: title, name: props.tab.label }) })
    else toast.push({ tone: 'danger', message: localizedError(result && !result.ok ? result.error : 'plugin_service_unavailable') })
  } catch {
    toast.push({ tone: 'danger', message: localizedError('plugin_service_unavailable') })
  } finally {
    invoking.value = ''
  }
}

watch(() => [props.active, hasPanelView.value] as const, ([active, panel]) => {
  if (active && panel) scheduleOpen()
  else closeView()
}, { immediate: true })

watch(() => store.panelOpenCount, () => {
  if (props.active && hasPanelView.value && !openToken.value && !opening.value) scheduleOpen()
})

onMounted(() => {
  removeClosedListener = window.electronAPI?.onPluginPanelViewClosed(onViewClosed) ?? null
})
onBeforeUnmount(() => {
  closeView()
  removeClosedListener?.()
})
</script>

<template>
  <div
    :id="`panel-plugin:${tab.pluginId}`"
    class="plugin-tab"
    role="tabpanel"
    :aria-labelledby="`tab-plugin:${tab.pluginId}`"
  >
    <section v-if="hasPanelView" ref="frame" class="plugin-tab-frame" role="region" :aria-label="pluginTitle">
      <header class="plugin-tab-chrome">
        <img v-if="tab.iconUrl" class="plugin-tab-icon" :src="tab.iconUrl" alt="">
        <span v-else class="plugin-tab-icon" aria-hidden="true"><Icon name="plugin" :size="16" /></span>
        <div class="plugin-tab-title">
          <strong>{{ pluginTitle }}</strong>
          <span>{{ tab.label }} · {{ t('pluginVersion', { version: tab.plugin.currentVersion }) }}</span>
        </div>
        <Button variant="ghost" icon-only :aria-label="t('plugins.reloadPanel')" :title="t('plugins.reloadPanel')" @click="openView">
          <Icon name="refresh" :size="18" />
        </Button>
        <Button variant="ghost" icon-only :aria-label="t('plugins.dashTabDetails')" :title="t('plugins.dashTabDetails')" @click="emit('openDetail', tab.pluginId)">
          <Icon name="settings" :size="18" />
        </Button>
      </header>
      <div ref="content" class="plugin-tab-content" data-testid="plugin-tab-view-content">
        <EmptyState v-if="viewError" icon="warning" :title="t('plugins.panelFailedTitle', { name: tab.label })" :description="localizedError(viewError)" role="alert">
          <Button variant="primary" size="sm" @click="openView">{{ t('plugins.reloadPanel') }}</Button>
          <Button variant="ghost" size="sm" @click="emit('openDetail', tab.pluginId)">{{ t('plugins.dashTabDetails') }}</Button>
        </EmptyState>
        <div v-else class="plugin-tab-loading" role="status">
          <Spinner :size="20" />
          <span>{{ t('plugins.panelLoading', { name: tab.label }) }}</span>
        </div>
      </div>
    </section>

    <div v-else class="plugin-tab-summary" :aria-busy="loading ? 'true' : undefined">
      <header class="plugin-tab-chrome">
        <img v-if="tab.iconUrl" class="plugin-tab-icon" :src="tab.iconUrl" alt="">
        <span v-else class="plugin-tab-icon" aria-hidden="true"><Icon name="plugin" :size="16" /></span>
        <div class="plugin-tab-title">
          <strong>{{ tab.label }}</strong>
          <span>{{ t('pluginVersion', { version: tab.plugin.currentVersion }) }}</span>
        </div>
        <Button variant="ghost" size="sm" @click="emit('openSettings', tab.pluginId)">{{ t('plugins.dashTabSettings') }}</Button>
        <Button variant="ghost" size="sm" @click="emit('openDetail', tab.pluginId)">{{ t('plugins.dashTabDetails') }}</Button>
      </header>

      <section v-if="commands.length" class="plugin-tab-section" :aria-label="t('pluginCommandsHeading')">
        <h2>{{ t('pluginCommandsHeading') }}</h2>
        <div class="plugin-tab-commands">
          <Button
            v-for="command in commands"
            :key="command.id"
            variant="secondary"
            size="sm"
            :loading="invoking === command.id"
            :disabled="Boolean(invoking) && invoking !== command.id"
            @click="runCommand(command.id, command.title[locale])"
          >{{ command.title[locale] }}</Button>
        </div>
      </section>

      <section class="plugin-tab-section" :aria-label="t('pluginNotificationsHeading')">
        <h2>{{ t('pluginNotificationsHeading') }}</h2>
        <div v-if="loading" class="plugin-tab-skeleton"><Skeleton :lines="3" /></div>
        <EmptyState v-else-if="!recentFeed.length" compact icon="info" :title="t('plugins.dashTabFeedEmpty')" />
        <ul v-else class="plugin-tab-feed">
          <li v-for="record in recentFeed" :key="record.item.id" :class="{ unread: !record.read }">
            <strong>{{ record.item.title }}</strong>
            <p v-if="record.item.body">{{ record.item.body }}</p>
            <time :datetime="new Date(record.item.createdAt).toISOString()">{{ formatDateTime(record.item.createdAt) }}</time>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.plugin-tab {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  padding: 0 var(--space-3) var(--space-3);
}

.plugin-tab-frame,
.plugin-tab-summary {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
}

.plugin-tab-summary {
  overflow-y: auto;
}

.plugin-tab-chrome {
  display: flex;
  min-height: 48px;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border-bottom: 1px solid var(--border-subtle);
}

.plugin-tab-icon {
  display: inline-flex;
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  object-fit: cover;
}

.plugin-tab-title {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}

.plugin-tab-title strong,
.plugin-tab-title span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plugin-tab-title strong {
  color: var(--text-primary);
  font-size: var(--font-sm);
}

.plugin-tab-title span {
  color: var(--text-muted);
  font-size: var(--font-xs);
}

.plugin-tab-content {
  display: flex;
  min-height: 0;
  flex: 1;
  align-items: center;
  justify-content: center;
}

.plugin-tab-loading {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--text-muted);
  font-size: var(--font-sm);
}

.plugin-tab-section {
  padding: var(--space-3);
}

.plugin-tab-section h2 {
  margin: 0 0 var(--space-2);
  color: var(--text-secondary);
  font-size: var(--font-xs);
  font-weight: var(--weight-medium);
}

.plugin-tab-commands {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.plugin-tab-feed {
  display: flex;
  margin: 0;
  padding: 0;
  flex-direction: column;
  gap: var(--space-2);
  list-style: none;
}

.plugin-tab-feed li {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
}

.plugin-tab-feed li.unread {
  border-color: var(--border-accent);
}

.plugin-tab-feed strong {
  color: var(--text-primary);
  font-size: var(--font-sm);
}

.plugin-tab-feed p {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--font-xs);
  overflow-wrap: anywhere;
}

.plugin-tab-feed time {
  color: var(--text-muted);
  font-size: var(--font-xs);
}
</style>
