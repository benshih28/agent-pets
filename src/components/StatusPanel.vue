<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, provide, ref, watch } from 'vue'
import { useAgentStore } from '@/stores/agentStore'
import { t } from '@/i18n'
import { useProgressionLabels } from '@/composables/useProgressionLabels'
import type { PluginEventSourceStatusView } from '@/types/plugin'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import { DIALOG_HOST_KEY } from '@/components/ui/dialog-host'
import ActionMenu, { type ActionMenuItem } from '@/components/ui/ActionMenu.vue'
import { type ThemePreference, nextThemePreference, setThemePreference, themePreference } from '@/composables/useTheme'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import InlinePermissionCard from '@/components/ui/InlinePermissionCard.vue'
import PermissionOutcomeNotice from '@/components/permission/PermissionOutcomeNotice.vue'
import PetAnimation from '@/components/PetAnimation.vue'
import PanelThemeBackdrop from '@/components/PanelThemeBackdrop.vue'
import { usePanelTheme } from '@/composables/usePanelTheme'
import ServerHealthBanner from '@/components/status-panel/ServerHealthBanner.vue'
import StatusPanelHistory from '@/components/status-panel/StatusPanelHistory.vue'
import StatusPanelSessions from '@/components/status-panel/StatusPanelSessions.vue'
import StatusPanelUsage from '@/components/status-panel/StatusPanelUsage.vue'
import PluginTabContent from '@/components/status-panel/PluginTabContent.vue'
import { usePluginTabs } from '@/composables/usePluginTabs'
import { isBuiltInDashboardTab, parseStoredDashboardTab, pluginIdOfTab, resolveDashboardTab } from '@/utils/plugin-tabs'
import { requestPluginDetail, type PluginDetailRequestSection } from '@/utils/plugin-detail-request'
import { panelThemeTargetRequest } from '@/utils/settings-navigation'
import { closePanelThemeEditor, panelThemeEditorRequest } from '@/composables/useMyPanelThemes'
import { countByBucket } from '@/utils/session-view'
import { DEFAULT_SETTINGS_GROUP, SETTINGS_GROUPS, isSettingsGroupId, type SettingsGroupId } from '@/utils/settingsRegistry'

const store = useAgentStore()
const panelRoot = ref<HTMLElement | null>(null)
// 面板內的對話框都掛到面板根元素，遮罩才會蓋住整個面板（見 dialog-host.ts）。
provide(DIALOG_HOST_KEY, panelRoot)
// 插件面板主題：只在此元素上以 inline 設定 --organic-*（spec §7.3）。
const { backdrop: panelThemeBackdrop } = usePanelTheme()
const settingsShortcut = /Mac/i.test(navigator.platform) ? '\u2318,' : 'Ctrl+,'

const themeLabel = (preference: ThemePreference) =>
  preference === 'light' ? t('design.theme.light') : preference === 'dark' ? t('design.theme.dark') : t('design.theme.system')

// Toggles close the menu after the click (ActionMenu's single behaviour); the
// current state stays visible in each row and, for DND, as a dot on the trigger.
const headerMenuItems = computed<ActionMenuItem[]>(() => [
  { id: 'dnd', icon: 'bell-off', label: t('dnd'), role: 'menuitemcheckbox', checked: store.dndEnabled, state: store.dndEnabled ? t('panel.stateOn') : t('panel.stateOff') },
  { id: 'pin', icon: 'pin', label: t('panel.menuKeepOpen'), role: 'menuitemcheckbox', checked: store.panelPinned, state: store.panelPinned ? t('panel.stateOn') : t('panel.stateOff') },
  {
    id: 'theme',
    icon: themePreference.value === 'light' ? 'sun' : themePreference.value === 'dark' ? 'moon' : 'theme-auto',
    label: t('design.theme.menuLabel'),
    state: t('design.theme.cycle', { current: themeLabel(themePreference.value), next: themeLabel(nextThemePreference(themePreference.value)) }),
  },
])

function onHeaderMenu(id: string): void {
  if (id === 'dnd') store.setDndEnabled(!store.dndEnabled)
  else if (id === 'pin') store.setPanelPinned(!store.panelPinned)
  else if (id === 'theme') setThemePreference(nextThemePreference(themePreference.value))
}

type DashboardTab = string

const DASHBOARD_TAB_STORAGE_KEY = 'agent-pets-dashboard-tab'
const SETTINGS_GROUP_STORAGE_KEY = 'agent-pets-settings-group'

function readStoredSettingsGroup(): SettingsGroupId {
  try {
    const stored = localStorage.getItem(SETTINGS_GROUP_STORAGE_KEY)
    if (isSettingsGroupId(stored)) return stored
  } catch {}
  return DEFAULT_SETTINGS_GROUP
}

// The last-used group is remembered across panel opens.
const settingsGroup = ref<SettingsGroupId>(readStoredSettingsGroup())
const dashboardTab = ref<DashboardTab>('sessions')
const pluginTabs = usePluginTabs()
// Usage and History mount on first visit, then stay mounted so their state survives tab switches.
const visitedTabs = ref(new Set<DashboardTab>(['sessions']))
const requestedPluginViewId = ref('')
// 每次請求遞增，取代「先清空再 nextTick 設定」的時序 hack，讓相同 id 的重複請求也會觸發。
const pluginViewRequestNonce = ref(0)
const pluginEventSourceStatuses = ref<PluginEventSourceStatusView[]>([])
const nowTick = ref(Date.now())
let tickTimer: ReturnType<typeof setInterval> | null = null
let removePluginViewRequestListener: (() => void) | null = null
let removePanelSettingsListener: (() => void) | null = null
let cleanupPluginEventSourceChanged: (() => void) | null = null

const SettingsPage = defineAsyncComponent(() => import('@/components/status-panel/SettingsPage.vue'))
// 編輯器連同驗證器與色盤產生器只在第一次開啟時載入（獨立 chunk，不增加面板啟動大小）。
const PanelThemeEditor = defineAsyncComponent(() => import('@/components/panel-theme/PanelThemeEditor.vue'))

const settingsGroupLabel = computed(() => {
  const group = SETTINGS_GROUPS.find(item => item.id === settingsGroup.value)
  return group ? t(group.labelKey) : ''
})
const dashboardTabs = computed(() => [
  { value: 'sessions', label: t('sessions'), badge: attentionCount.value },
  { value: 'usage', label: t('tokenRemaining') },
  { value: 'history', label: t('history') },
  ...pluginTabs.tabs.value.map(tab => ({
    value: tab.value,
    label: tab.label,
    iconUrl: tab.iconUrl ?? undefined,
    icon: tab.iconUrl ? undefined : 'plugin',
    badgeText: tab.badgeText,
    truncate: true,
  })),
])
const activePluginTab = computed(() => pluginTabs.tabs.value.find(tab => tab.value === dashboardTab.value) ?? null)
const pluginTabIds = computed(() => pluginTabs.tabs.value.map(tab => tab.pluginId))
const attentionCount = computed(() => countByBucket(store.sessionList).attention)
const activePetName = computed(() => store.pets.find(pet => pet.id === store.activePetId)?.displayName ?? t('appName'))
const { evolutionLabel } = useProgressionLabels()
// Give up on "loading" after a while so the header never spins forever.
const progressionTimedOut = ref(false)
let progressionTimeout: ReturnType<typeof setTimeout> | null = null
const sessionCounts = computed(() => countByBucket(store.sessionList))
const panelPetSubtitle = computed(() => {
  const { running, attention } = sessionCounts.value
  if (running + attention > 0) return t('panel.subtitleActive', { running, attention })
  if (!store.progression) return progressionTimedOut.value ? t('panel.progressUnavailable') : t('petProgressLoading')
  return `${t('historyLevel', { level: store.progression.level })} · ${evolutionLabel(store.progression.evolutionStage)} · ${t('dayStreak', { days: store.progression.currentStreak })}`
})

// The shared clock only needs to be precise while the permission card shows
// its running seconds; Usage reset labels are minute-granular. Sessions have
// their own per-label clock (useNow), so idle panels barely wake the renderer.
const TICK_FAST_MS = 1000
const TICK_SLOW_MS = 30_000
const tickInterval = computed(() => store.permissionRequest ? TICK_FAST_MS : TICK_SLOW_MS)
let tickTimerMs = 0

function syncTickTimer(): void {
  if (document.hidden) {
    if (tickTimer) clearInterval(tickTimer)
    tickTimer = null
    tickTimerMs = 0
    return
  }
  if (tickTimer && tickTimerMs === tickInterval.value) return
  if (tickTimer) clearInterval(tickTimer)
  nowTick.value = Date.now()
  tickTimerMs = tickInterval.value
  tickTimer = setInterval(() => { nowTick.value = Date.now() }, tickTimerMs)
}

watch(tickInterval, syncTickTimer)

// Esc steps back one level: wizard / MCP, then settings, then hide the panel.
// Anything that already handled the key (ConfirmDialog, inputs) wins.
function onGlobalKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented) return
  if ((event.metaKey || event.ctrlKey) && event.key === ',') {
    event.preventDefault()
    if (store.panelView !== 'settings') store.openSettings()
    return
  }
  if (event.key !== 'Escape') return
  event.preventDefault()
  if (store.showWizard) store.closeSetupWizard()
  else if (store.showProjectMcpPanel) store.closeProjectMcpPanel()
  else if (store.panelView === 'settings') store.backToSessions()
  else store.closePanel()
}

function openPetSettings(): void {
  settingsGroup.value = 'pets'
  store.openSettings()
}

function openPluginSettings(): void {
  settingsGroup.value = 'plugins'
  store.openSettings()
}

function selectDashboardTab(tab: DashboardTab): void {
  dashboardTab.value = tab
  if (isBuiltInDashboardTab(tab)) visitedTabs.value.add(tab)
  try { localStorage.setItem(DASHBOARD_TAB_STORAGE_KEY, tab) } catch {}
  // refreshQuota() is TTL-gated, so this only reaches the network when the
  // reading is stale; a first-ever open still loads.
  if (tab === 'sessions' || tab === 'usage') void store.refreshQuota()
}

function openPluginTabSettings(pluginId: string, section: PluginDetailRequestSection = 'settings'): void {
  requestPluginDetail(pluginId, section)
  openPluginSettings()
}

// 主題設定的目的地：有分頁就回到儀表板並切到該插件的分頁，否則開詳情頁的面板主題。
watch(panelThemeTargetRequest, request => {
  if (!request) return
  const tab = pluginTabs.tabs.value.find(candidate => candidate.pluginId === request.pluginId && candidate.sections.panelThemes)
  if (!tab) {
    openPluginTabSettings(request.pluginId, 'themes')
    return
  }
  if (store.panelView === 'settings') store.backToSessions()
  selectDashboardTab(tab.value)
})

// Restore the remembered tab once the plugin list is known, but only if it still qualifies;
// a plugin tab that disappears later (disabled, removed, crashed) falls back to Sessions.
let restoredTab = false
watch(() => [pluginTabs.loading.value, pluginTabIds.value.join('|')] as const, () => {
  if (pluginTabs.loading.value) return
  if (!restoredTab) {
    restoredTab = true
    let stored: string | null = null
    try { stored = parseStoredDashboardTab(localStorage.getItem(DASHBOARD_TAB_STORAGE_KEY)) } catch {}
    if (stored && stored !== dashboardTab.value) {
      const resolved = resolveDashboardTab(stored, pluginTabIds.value)
      if (resolved !== dashboardTab.value) selectDashboardTab(resolved)
    }
    return
  }
  if (pluginIdOfTab(dashboardTab.value) !== null) {
    const resolved = resolveDashboardTab(dashboardTab.value, pluginTabIds.value)
    if (resolved !== dashboardTab.value) selectDashboardTab(resolved)
  }
}, { immediate: true })

// Plugins are managed in Settings, so re-read them whenever the dashboard is shown again.
watch(() => [store.panelView, store.panelOpenCount] as const, ([view]) => {
  if (view === 'sessions') void pluginTabs.refresh()
})

// Move keyboard focus into the panel whenever it is (re)opened so Tab / arrows work immediately.
watch(() => store.panelOpenCount, async () => {
  await nextTick()
  const target = store.panelView === 'settings'
    ? panelRoot.value?.querySelector<HTMLElement>('.panel-header button')
    : document.getElementById(`tab-${dashboardTab.value}`)
  target?.focus({ preventScroll: true })
})

watch(settingsGroup, group => {
  try { localStorage.setItem(SETTINGS_GROUP_STORAGE_KEY, group) } catch {}
})

onMounted(() => {
  // Keep the settings panels code-split while warming the default tab off the
  // render path, so the first settings click does not wait for its chunk.
  void import('@/components/status-panel/SettingsPage.vue').catch(() => {})
  progressionTimeout = setTimeout(() => { progressionTimedOut.value = true }, 8000)
  document.addEventListener('visibilitychange', syncTickTimer)
  window.addEventListener('keydown', onGlobalKeydown)
  syncTickTimer()
  removePanelSettingsListener = window.electronAPI?.onPanelOpenSettings(() => {
    requestedPluginViewId.value = ''
    pluginViewRequestNonce.value += 1
  }) ?? null
  removePluginViewRequestListener = window.electronAPI?.onPanelOpenPluginView(pluginId => {
    settingsGroup.value = 'plugins'
    requestedPluginViewId.value = pluginId
    pluginViewRequestNonce.value += 1
  }) ?? null
  store.loadPets()
  void store.refreshProjectPets()
  void store.refreshQuota()
  if (window.electronAPI?.onPluginEventSourceChanged) {
    cleanupPluginEventSourceChanged = window.electronAPI.onPluginEventSourceChanged(statuses => {
      pluginEventSourceStatuses.value = statuses
    })
  }
  void window.electronAPI?.getPluginEventSourceStatuses().then(statuses => {
    pluginEventSourceStatuses.value = statuses
  }).catch(() => {})
})

onUnmounted(() => {
  document.removeEventListener('visibilitychange', syncTickTimer)
  window.removeEventListener('keydown', onGlobalKeydown)
  if (progressionTimeout) clearTimeout(progressionTimeout)
  if (tickTimer) clearInterval(tickTimer)
  removePluginViewRequestListener?.()
  removePanelSettingsListener?.()
  cleanupPluginEventSourceChanged?.()
})
</script>

<template>
  <div ref="panelRoot" class="status-panel" :inert="store.showWizard || store.showProjectMcpPanel" @click.stop>
    <PanelThemeBackdrop :backdrop="panelThemeBackdrop" />
    <div class="panel-header">
      <Button v-if="store.panelView === 'settings'" variant="ghost" icon-only :title="t('back')" :aria-label="t('back')" @click="store.backToSessions()">
        <Icon name="back" />
      </Button>
      <template v-if="store.panelView === 'sessions'">
        <!-- raw-control: 按鈕內容是寵物動畫頭像；Button 的 icon-only 尺寸與 hover 底色會蓋掉 sprite -->
        <button type="button" class="panel-pet-avatar" :title="t('panel.changePet')" :aria-label="t('panel.changePet')" @click="openPetSettings">
          <PetAnimation class="panel-pet-animation" aria-hidden="true" :state="store.currentState" :pet-id="store.activePetId" :since="store.highestPrioritySession?.lastSeenAt" :mood="store.mood" />
        </button>
        <div class="panel-title-group">
          <span class="panel-title">{{ activePetName }}</span>
          <span class="panel-subtitle">{{ panelPetSubtitle }}</span>
        </div>
      </template>
      <h1 v-else class="panel-title settings-panel-title">
        {{ t('settings') }}<Icon class="breadcrumb-sep" name="chevron-right" :size="12" /><span class="breadcrumb-current">{{ settingsGroupLabel }}</span>
      </h1>
      <div class="header-right">
        <ActionMenu
          v-if="store.panelView === 'sessions'"
          class="header-more"
          :items="headerMenuItems"
          :aria-label="t('panel.more')"
          icon-only
          variant="ghost"
          @select="onHeaderMenu"
        >
          <span class="header-more-icon">
            <Icon name="more" :size="18" />
            <span v-if="store.dndEnabled" class="header-more-dot" role="img" :aria-label="t('panel.dndActive')" />
          </span>
        </ActionMenu>
        <Button v-if="store.panelView === 'sessions'" variant="ghost" icon-only :title="`${t('settings')} (${settingsShortcut})`" :aria-label="t('settings')" @click="store.openSettings()">
          <Icon name="settings" />
        </Button>
        <Button variant="ghost" icon-only :title="`${t('close')} (Esc)`" :aria-label="t('close')" @click="store.closePanel()">
          <Icon name="close" />
        </Button>
      </div>
    </div>

    <template v-if="store.panelView === 'sessions'">
      <ServerHealthBanner />
      <InlinePermissionCard
        v-if="store.permissionRequest"
        class="panel-inline-permission"
        :request="store.permissionRequest"
        @decide="store.decidePermission(store.permissionRequest.requestId, $event)"
      />
      <PermissionOutcomeNotice v-else-if="store.permissionOutcome" />
      <div v-else-if="store.permissionNotice" class="inline-permission-notice" role="status">
        <Icon name="warning" :size="18" />
        <span><strong>{{ store.permissionNotice.title }}</strong><small>{{ store.permissionNotice.detail }}</small></span>
      </div>
      <div class="dashboard-nav">
        <SegmentedControl
          :model-value="dashboardTab"
          :options="dashboardTabs"
          :ariaLabel="t('dashboardSections')"
          id-prefix="tab-"
          panel-id-prefix="panel-"
          scrollable
          :scroll-prev-label="t('plugins.dashTabScrollPrev')"
          :scroll-next-label="t('plugins.dashTabScrollNext')"
          @update:model-value="selectDashboardTab($event as DashboardTab)"
        />
      </div>
      <StatusPanelSessions v-show="dashboardTab === 'sessions'" :active="dashboardTab === 'sessions'" :now-tick="nowTick" :plugin-event-source-statuses="pluginEventSourceStatuses" @manage-plugins="openPluginSettings" />
      <StatusPanelUsage v-if="visitedTabs.has('usage')" v-show="dashboardTab === 'usage'" :active="dashboardTab === 'usage'" :now-tick="nowTick" />
      <StatusPanelHistory v-if="visitedTabs.has('history')" v-show="dashboardTab === 'history'" :active="dashboardTab === 'history'" />
      <PluginTabContent
        v-if="activePluginTab"
        :key="activePluginTab.pluginId"
        :tab="activePluginTab"
        :active="!store.showWizard && !store.showProjectMcpPanel"
        :feed="pluginTabs.feedFor(activePluginTab.pluginId)"
        :loading="pluginTabs.loading.value"
        @open-settings="openPluginTabSettings($event, 'settings')"
        @open-detail="openPluginTabSettings($event, 'overview')"
        @open-themes="openPluginTabSettings($event, 'themes')"
      />
    </template>

    <SettingsPage v-else v-model:group="settingsGroup" :requested-plugin-id="requestedPluginViewId" :requested-plugin-nonce="pluginViewRequestNonce" />
    <!-- 主題編輯器（全面板對話框）：外觀設定與主題插件分頁共用這一個實例；nonce 讓每次開啟都是新的草稿。 -->
    <PanelThemeEditor v-if="panelThemeEditorRequest" :key="panelThemeEditorRequest.nonce" :request="panelThemeEditorRequest" @close="closePanelThemeEditor()" />
  </div>
</template>

<style scoped src="@/components/StatusPanel.css"></style>
