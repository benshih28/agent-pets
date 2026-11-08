<script setup lang="ts">
import { computed, nextTick, provide, ref, watch } from 'vue'
import { t } from '@/i18n'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import ActionMenu from '@/components/ui/ActionMenu.vue'
import PluginToastStack from '@/components/plugin-panel/PluginToastStack.vue'
import SegmentedTabs from '@/components/ui/SegmentedTabs.vue'
import ToggleRow from '@/components/ui/ToggleRow.vue'
import PluginAdvanced from '@/components/plugin-panel/PluginAdvanced.vue'
import PluginDetail from '@/components/plugin-panel/PluginDetail.vue'
import PluginCatalog from '@/components/plugin-panel/PluginCatalog.vue'
import PluginInstalledList from '@/components/plugin-panel/PluginInstalledList.vue'
import PluginNotificationInbox from '@/components/plugin-panel/PluginNotificationInbox.vue'
import PluginInstallSheet from '@/components/plugin-panel/PluginInstallSheet.vue'
import PluginPanelDialogs from '@/components/plugin-panel/PluginPanelDialogs.vue'
import PluginPanelFrame from '@/components/plugin-panel/PluginPanelFrame.vue'
import { PLUGIN_PANEL_CONTROLLER } from '@/composables/plugin/context'
import { usePluginPanelController } from '@/composables/usePluginPanelController'

const props = defineProps<{ requestedPluginId?: string; requestNonce?: number }>()
const controller = usePluginPanelController(props)
provide(PLUGIN_PANEL_CONTROLLER, controller)
const {
  snapshot, visibleNotifications, plugins, catalogItems, busy, loading, toasts, dismissToast, runToastAction,
  detailPlugin, panelViewPlugin, panelViewFrame, panelViewContent, pendingRemove, pendingSecretConsentKey,
  pendingReportPluginId, confirmReport, keepData, enabledGlobally, pluginName, refreshPanel, selectArchive, selectDeveloperFolder,
  updateGlobalPreferences, confirmRemove, confirmSecretConsent,
} = controller

type PluginTab = 'installed' | 'explore' | 'notifications' | 'advanced'
const activeTab = ref<PluginTab>('installed')

const reportPlugin = computed(() => plugins.value.find(plugin => plugin.id === pendingReportPluginId.value) ?? null)
const enabledCount = computed(() => plugins.value.filter(plugin => plugin.preference.enabled).length)
const updateCount = computed(() => catalogItems.value.filter(item => item.updateAvailable).length)
const showTabs = computed(() => enabledGlobally.value || plugins.value.length > 0)
const unreadCount = computed(() => visibleNotifications.value.filter(record => !record.read).length)
const developerMode = computed(() => snapshot.value?.preferences.developerMode ?? false)
const tabs = computed(() => [
  { id: 'installed', label: t('plugins.tabInstalled'), badge: plugins.value.length },
  { id: 'explore', label: t('plugins.tabExplore'), badge: updateCount.value },
  { id: 'notifications', label: t('plugins.tabNotifications'), badge: unreadCount.value },
  { id: 'advanced', label: t('plugins.tabAdvanced') },
])
const installMenuItems = computed(() => [
  { id: 'archive', label: t('plugins.installFromFile') },
  { id: 'folder', label: t('pluginDeveloperLoadFolder') },
])

function onInstallMenu(id: string): void {
  if (id === 'folder') void selectDeveloperFolder()
  else void selectArchive()
}

// 進入詳情頁前記住設定頁的捲動位置，返回時還原，並把捲動軸歸零顯示詳情頁頂端。
const shell = ref<HTMLElement | null>(null)
let savedScrollTop = 0
watch(() => detailPlugin.value?.id ?? '', async (id, previousId) => {
  const container = shell.value?.closest<HTMLElement>('.settings-content') ?? null
  if (!container) return
  if (id && !previousId) {
    savedScrollTop = container.scrollTop
    container.scrollTop = 0
  } else if (!id && previousId) {
    await nextTick()
    container.scrollTop = savedScrollTop
  }
})

function showTab(tab: PluginTab): void {
  activeTab.value = tab
}
</script>

<template>
  <PluginPanelFrame
    v-if="panelViewPlugin"
    @frame="panelViewFrame = $event"
    @content="panelViewContent = $event"
  />

  <div v-show="!panelViewPlugin" ref="shell" class="plugin-panel">
    <PluginDetail v-if="detailPlugin" />
    <div v-show="!detailPlugin" class="plugin-main">
    <header class="plugin-header">
      <div class="plugin-header-copy">
        <h2>{{ t('plugins') }}</h2>
        <p class="plugin-summary">
          <Button variant="ghost" size="sm" @click="showTab('installed')">
            {{ t('plugins.summaryEnabled', { enabled: enabledCount, total: plugins.length }) }}
          </Button>
          <Button v-if="updateCount" variant="ghost" size="sm" @click="showTab('explore')">
            {{ t('plugins.summaryUpdates', { count: updateCount }) }}
          </Button>
          <Button v-if="unreadCount" variant="ghost" size="sm" @click="showTab('notifications')">
            {{ t('plugins.summaryUnread', { count: unreadCount }) }}
          </Button>
        </p>
      </div>
      <div class="plugin-header-actions">
        <ActionMenu
          v-if="developerMode"
          :items="installMenuItems"
          :aria-label="t('pluginInstallButton')"
          variant="primary"
          size="sm"
          :disabled="busy"
          @select="onInstallMenu"
        >
          {{ t('pluginInstallButton') }}
        </ActionMenu>
        <Button v-else variant="primary" size="sm" :disabled="busy" @click="selectArchive">
          {{ t('pluginInstallButton') }}
        </Button>
        <Button variant="secondary" size="sm" :disabled="loading || busy" @click="refreshPanel()">
          {{ loading ? t('checking') : t('refresh') }}
        </Button>
      </div>
    </header>

    <Card v-if="enabledGlobally" class="plugin-global">
      <ToggleRow
        :model-value="enabledGlobally"
        :label="t('pluginGlobalEnabled')"
        :help="t('pluginGlobalEnabledHelp')"
        :disabled="busy"
        @update:model-value="updateGlobalPreferences({ pluginsEnabled: $event })"
      />
    </Card>
    <Card v-else class="plugin-global off">
      <EmptyState
        compact
        icon="plugin"
        :title="t('plugins.offTitle')"
        :description="t('plugins.globalOffBanner')"
      >
        <Button variant="primary" size="sm" :disabled="busy" @click="updateGlobalPreferences({ pluginsEnabled: true })">
          {{ t('plugins.enablePlugins') }}
        </Button>
      </EmptyState>
    </Card>

    <SegmentedTabs v-if="showTabs" v-model="activeTab" :tabs="tabs" :aria-label="t('plugins.tabsLabel')" id-prefix="plugin" />

    <template v-if="showTabs">
    <div
      v-show="activeTab === 'installed'"
      id="plugin-panel-installed"
      class="plugin-tab-panel"
      role="tabpanel"
      aria-labelledby="plugin-tab-installed"
    >
      <PluginInstalledList @explore="showTab('explore')" />
    </div>
    <div
      v-show="activeTab === 'explore'"
      id="plugin-panel-explore"
      class="plugin-tab-panel"
      role="tabpanel"
      aria-labelledby="plugin-tab-explore"
    >
      <PluginCatalog :active="activeTab === 'explore'" />
    </div>
    <div
      v-show="activeTab === 'notifications'"
      id="plugin-panel-notifications"
      class="plugin-tab-panel"
      role="tabpanel"
      aria-labelledby="plugin-tab-notifications"
    >
      <PluginNotificationInbox />
    </div>
    <div
      v-show="activeTab === 'advanced'"
      id="plugin-panel-advanced"
      class="plugin-tab-panel"
      role="tabpanel"
      aria-labelledby="plugin-tab-advanced"
    >
      <PluginAdvanced />
    </div>

    </template>
    </div>

    <PluginInstallSheet />
    <PluginPanelDialogs
      :remove-name="pendingRemove ? pluginName(pendingRemove) : ''"
      :report-name="reportPlugin ? pluginName(reportPlugin) : ''"
      :keep-data="keepData"
      :secret-consent-open="pendingSecretConsentKey !== ''"
      @confirm-report="confirmReport"
      @cancel-report="pendingReportPluginId = ''"
      @confirm-remove="confirmRemove"
      @cancel-remove="pendingRemove = null"
      @update-keep-data="keepData = $event"
      @confirm-secret-consent="confirmSecretConsent"
      @cancel-secret-consent="pendingSecretConsentKey = ''"
    />
  </div>

  <PluginToastStack :toasts="toasts" @dismiss="dismissToast" @action="runToastAction" />
</template>

<style scoped src="./PluginPanel.css"></style>
