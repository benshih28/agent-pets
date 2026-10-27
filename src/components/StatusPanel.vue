<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useAgentStore } from '@/stores/agentStore'
import { SOURCE_LABELS } from '@/types/agent'
import { t } from '@/i18n'
import type { PluginEventSourceStatusView } from '@/types/plugin'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import InlinePermissionCard from '@/components/ui/InlinePermissionCard.vue'
import PetAnimation from '@/components/PetAnimation.vue'
import StatusPanelHistory from '@/components/status-panel/StatusPanelHistory.vue'
import StatusPanelSessions from '@/components/status-panel/StatusPanelSessions.vue'
import StatusPanelUsage from '@/components/status-panel/StatusPanelUsage.vue'

const store = useAgentStore()

type SettingsSection = 'language' | 'appearance' | 'desktop' | 'plugins' | 'pets' | 'growth' | 'advanced'
type DashboardTab = 'sessions' | 'usage' | 'history'

const settingsTab = ref<SettingsSection>('appearance')
const dashboardTab = ref<DashboardTab>('sessions')
const requestedPluginViewId = ref('')
const pluginEventSourceStatuses = ref<PluginEventSourceStatusView[]>([])
const nowTick = ref(Date.now())
let tickTimer: ReturnType<typeof setInterval> | null = null
let removePluginViewRequestListener: (() => void) | null = null
let removePanelSettingsListener: (() => void) | null = null
let cleanupPluginEventSourceChanged: (() => void) | null = null

const SettingsLanguage = defineAsyncComponent(() => import('@/components/status-panel/SettingsLanguage.vue'))
const SettingsAppearance = defineAsyncComponent(() => import('@/components/status-panel/SettingsAppearance.vue'))
const SettingsDesktop = defineAsyncComponent(() => import('@/components/status-panel/SettingsDesktop.vue'))
const SettingsPlugins = defineAsyncComponent(() => import('@/components/status-panel/SettingsPlugins.vue'))
const SettingsPets = defineAsyncComponent(() => import('@/components/status-panel/SettingsPets.vue'))
const SettingsGrowth = defineAsyncComponent(() => import('@/components/status-panel/SettingsGrowth.vue'))
const SettingsAdvanced = defineAsyncComponent(() => import('@/components/status-panel/SettingsAdvanced.vue'))

const settingsSections = computed<Array<{ id: SettingsSection; icon: string; label: string; hint: string }>>(() => [
  { id: 'language', icon: 'language', label: t('language'), hint: t('languageHint') },
  { id: 'appearance', icon: 'appearance', label: t('appearance'), hint: t('appearanceHint') },
  { id: 'desktop', icon: 'desktop', label: t('desktop'), hint: t('desktopHint') },
  { id: 'plugins', icon: 'advanced', label: t('plugins'), hint: t('pluginSettingsHint') },
  { id: 'pets', icon: 'pets', label: t('pets'), hint: t('petsHint') },
  { id: 'growth', icon: 'growth', label: t('growth'), hint: t('growthHint') },
  { id: 'advanced', icon: 'advanced', label: t('advanced'), hint: t('advancedHint') },
])
const activeSettingsSection = computed(() => settingsSections.value.find(section => section.id === settingsTab.value))
const dashboardTabs = computed<Array<{ id: DashboardTab; label: string }>>(() => [
  { id: 'sessions', label: t('sessions') },
  { id: 'usage', label: t('tokenRemaining') },
  { id: 'history', label: t('history') },
])
const settingsTabComponent = computed(() => ({
  language: SettingsLanguage,
  appearance: SettingsAppearance,
  desktop: SettingsDesktop,
  plugins: SettingsPlugins,
  pets: SettingsPets,
  growth: SettingsGrowth,
  advanced: SettingsAdvanced,
})[settingsTab.value])
const settingsTabProps = computed(() => settingsTab.value === 'plugins'
  ? { requestedPluginId: requestedPluginViewId.value }
  : {})
const activePetName = computed(() => store.pets.find(pet => pet.id === store.activePetId)?.displayName ?? t('appName'))
const evolutionLabels: Record<string, Parameters<typeof t>[0]> = {
  egg: 'evolutionEgg', baby: 'evolutionBaby', teen: 'evolutionTeen', adult: 'evolutionAdult', master: 'evolutionMaster',
}
const panelPetSubtitle = computed(() => {
  if (!store.progression) return t('petProgressLoading')
  return `${t('historyLevel', { level: store.progression.level })} · ${t(evolutionLabels[store.progression.evolutionStage])} · ${t('dayStreak', { days: store.progression.currentStreak })}`
})

function syncTickTimer(): void {
  if (document.hidden) {
    if (tickTimer) clearInterval(tickTimer)
    tickTimer = null
    return
  }
  if (!tickTimer) tickTimer = setInterval(() => { nowTick.value = Date.now() }, 1000)
}

function onTabKeydown(event: KeyboardEvent): void {
  const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
  if (!step) return
  event.preventDefault()
  const ids = dashboardTabs.value.map(tab => tab.id)
  const next = ids[(ids.indexOf(dashboardTab.value) + step + ids.length) % ids.length]
  selectDashboardTab(next)
  document.getElementById(`tab-${next}`)?.focus()
}

function onSettingsKeydown(event: KeyboardEvent): void {
  const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
  if (!step) return
  event.preventDefault()
  const ids = settingsSections.value.map(section => section.id)
  const next = ids[(ids.indexOf(settingsTab.value) + step + ids.length) % ids.length]
  settingsTab.value = next
  document.getElementById(`settings-tab-${next}`)?.focus()
}

function selectDashboardTab(tab: DashboardTab): void {
  dashboardTab.value = tab
  if ((tab === 'sessions' || tab === 'usage') && !store.quotaUsage) void store.refreshQuota()
}

function permissionSourceLabel(agentId: string): string {
  return SOURCE_LABELS[agentId as keyof typeof SOURCE_LABELS] ?? agentId
}

watch(() => store.panelView, view => {
  if (view === 'settings') settingsTab.value = 'appearance'
})

onMounted(() => {
  // Keep the settings panels code-split while warming the default tab off the
  // render path, so the first settings click does not wait for its chunk.
  void import('@/components/status-panel/SettingsAppearance.vue').catch(() => {})
  document.addEventListener('visibilitychange', syncTickTimer)
  syncTickTimer()
  removePanelSettingsListener = window.electronAPI?.onPanelOpenSettings(() => {
    requestedPluginViewId.value = ''
  }) ?? null
  removePluginViewRequestListener = window.electronAPI?.onPanelOpenPluginView(pluginId => {
    settingsTab.value = 'plugins'
    requestedPluginViewId.value = ''
    void nextTick(() => { requestedPluginViewId.value = pluginId })
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
  if (tickTimer) clearInterval(tickTimer)
  removePluginViewRequestListener?.()
  removePanelSettingsListener?.()
  cleanupPluginEventSourceChanged?.()
})
</script>

<template>
  <div class="status-panel" @click.stop>
    <div class="panel-header">
      <Button v-if="store.panelView === 'settings'" variant="ghost" icon-only :title="t('back')" :aria-label="t('back')" @click="store.backToSessions()">
        <Icon name="back" />
      </Button>
      <template v-if="store.panelView === 'sessions'">
        <div class="panel-pet-avatar" aria-hidden="true">
          <PetAnimation class="panel-pet-animation" :state="store.currentState" :pet-id="store.activePetId" :since="store.highestPrioritySession?.lastSeenAt" :mood="store.mood" />
        </div>
        <div class="panel-title-group">
          <span class="panel-title">{{ activePetName }}</span>
          <span class="panel-subtitle">{{ panelPetSubtitle }}</span>
        </div>
      </template>
      <span v-else class="panel-title settings-panel-title">{{ t('settings') }}</span>
      <div class="header-right">
        <Button v-if="store.panelView === 'sessions'" variant="ghost" icon-only :title="t('settings')" :aria-label="t('settings')" @click="store.openSettings()">
          <Icon name="settings" />
        </Button>
        <Button variant="ghost" icon-only :title="t('close')" :aria-label="t('close')" @click="store.closePanel()">
          <Icon name="close" />
        </Button>
      </div>
    </div>

    <template v-if="store.panelView === 'sessions'">
      <InlinePermissionCard
        v-if="store.permissionRequest"
        class="panel-inline-permission"
        :request="store.permissionRequest"
        :title="`${permissionSourceLabel(store.permissionRequest.agentId)} · ${t('permissionInlineTitle')}`"
        :project-label="store.permissionRequest.projectId || t('projectUnknown')"
        :elapsed-label="`${Math.max(0, (nowTick - store.permissionRequest.receivedAt) / 1000).toFixed(1)}s`"
        :allow-label="t('permissionAllowOnce')"
        :deny-label="t('permissionDeny')"
        :warning-label="t('permissionWarning')"
        @decide="store.decidePermission(store.permissionRequest.requestId, $event)"
      />
      <div v-else-if="store.permissionNotice" class="inline-permission-notice" role="status">
        <Icon name="warning" :size="18" />
        <span><strong>{{ store.permissionNotice.title }}</strong><small>{{ store.permissionNotice.detail }}</small></span>
      </div>
      <div class="dashboard-tabs" role="tablist" :aria-label="t('dashboardSections')">
        <Button
          v-for="tab in dashboardTabs"
          :key="tab.id"
          variant="ghost"
          size="sm"
          class="dashboard-tab"
          :class="{ active: dashboardTab === tab.id }"
          role="tab"
          :id="`tab-${tab.id}`"
          :aria-selected="dashboardTab === tab.id"
          :aria-controls="`panel-${tab.id}`"
          :tabindex="dashboardTab === tab.id ? 0 : -1"
          @click="selectDashboardTab(tab.id)"
          @keydown="onTabKeydown"
        >
          {{ tab.label }}
        </Button>
      </div>
      <StatusPanelSessions v-show="dashboardTab === 'sessions'" :active="dashboardTab === 'sessions'" :now-tick="nowTick" :plugin-event-source-statuses="pluginEventSourceStatuses" />
      <StatusPanelUsage v-show="dashboardTab === 'usage'" :now-tick="nowTick" />
      <StatusPanelHistory v-show="dashboardTab === 'history'" :active="dashboardTab === 'history'" />
    </template>

    <div v-else class="settings-layout">
      <div class="settings-content">
        <nav class="settings-nav" role="tablist" :aria-label="t('settingsSections')">
          <Button
            v-for="section in settingsSections"
            :key="section.id"
            variant="ghost"
            size="sm"
            class="settings-nav-item"
            :class="{ active: settingsTab === section.id }"
            role="tab"
            :id="`settings-tab-${section.id}`"
            :aria-selected="settingsTab === section.id"
            :tabindex="settingsTab === section.id ? 0 : -1"
            @click="settingsTab = section.id"
            @keydown="onSettingsKeydown"
          >
            {{ section.label }}
          </Button>
        </nav>

        <div class="settings-content-header">
          <span class="settings-kicker">{{ t('workspacePreferences') }}</span>
          <h2>{{ activeSettingsSection?.label }}</h2>
        </div>

        <div class="settings-quick-toggles" role="group" :aria-label="t('quickSettings')">
          <Button variant="ghost" class="quick-toggle" :class="{ active: store.notificationsEnabled }" :aria-label="`${t('notifications')} ${store.notificationsEnabled ? t('enabledShort') : t('disabledShort')}`" @click="store.setNotificationsEnabled(!store.notificationsEnabled)">
            <Icon name="bell" :size="20" /><span>{{ t('notifications') }} {{ store.notificationsEnabled ? t('enabledShort') : t('disabledShort') }}</span>
          </Button>
          <Button variant="ghost" class="quick-toggle" :class="{ active: store.dndEnabled }" :aria-label="`${t('dnd')} ${store.dndEnabled ? t('enabledShort') : t('disabledShort')}`" @click="store.setDndEnabled(!store.dndEnabled)">
            <Icon name="moon" :size="20" /><span>{{ t('dnd') }} {{ store.dndEnabled ? t('enabledShort') : t('disabledShort') }}</span>
          </Button>
          <Button variant="ghost" class="quick-toggle" :class="{ active: store.soundEnabled }" :aria-label="`${t('sound')} ${store.soundEnabled ? t('enabledShort') : t('disabledShort')}`" @click="store.setSoundEnabled(!store.soundEnabled)">
            <Icon name="volume-off" :size="20" /><span>{{ t('sound') }} {{ store.soundEnabled ? t('enabledShort') : t('disabledShort') }}</span>
          </Button>
        </div>

        <component :is="settingsTabComponent" v-bind="settingsTabProps" />
      </div>
    </div>
  </div>
</template>

<style scoped src="@/components/StatusPanel.css"></style>
