<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { locale, t } from '@/i18n'
import Button from '@/components/ui/Button.vue'
import Chip from '@/components/ui/Chip.vue'
import Icon from '@/components/ui/Icon.vue'
import Spinner from '@/components/ui/Spinner.vue'
import { usePluginController } from '@/composables/plugin/context'

const {
  panelViewPlugin, panelViewMaximized, panelViewError, panelViewOpenToken, pluginName, pluginIconUrl, hidePluginIcon,
  localizedError, togglePluginPanelViewMaximized, closePluginPanelView, reloadPluginPanelView,
  openPluginDetailFromPanel, requestReport,
} = usePluginController()
const emit = defineEmits<{ frame: [el: HTMLElement | null]; content: [el: HTMLElement | null] }>()

const SLOW_LOAD_MS = 5000
const headingRef = ref<HTMLElement | null>(null)
const slow = ref(false)
let slowTimer: ReturnType<typeof setTimeout> | null = null

const name = computed(() => (panelViewPlugin.value ? pluginName(panelViewPlugin.value) : ''))
// 外框標題優先使用 manifest 的 panelView.title，副標才是插件名稱與版本。
const title = computed(() => panelViewPlugin.value?.manifest?.contributes.panelView?.title[locale.value] || name.value)
const maximizeLabel = computed(() => t(panelViewMaximized.value ? 'pluginPanelRestore' : 'pluginPanelMaximize'))
const maximizeTitle = computed(() => (panelViewMaximized.value ? `${maximizeLabel.value} (Esc)` : maximizeLabel.value))

// 原生面板檢視在內容繪製前是透明的，這裡的載入提示會顯示在它底下；超過 5 秒提示可取消。
function resetSlowTimer(): void {
  slow.value = false
  if (slowTimer) clearTimeout(slowTimer)
  slowTimer = null
  if (!panelViewError.value) slowTimer = setTimeout(() => { slow.value = true }, SLOW_LOAD_MS)
}

watch([() => panelViewPlugin.value?.id, panelViewOpenToken, panelViewError], resetSlowTimer, { immediate: true })
watch(() => panelViewPlugin.value?.id, async id => {
  if (!id) return
  await nextTick()
  headingRef.value?.focus()
}, { immediate: true, flush: 'post' })
onBeforeUnmount(() => { if (slowTimer) clearTimeout(slowTimer) })
</script>

<template>
  <section
    v-if="panelViewPlugin"
    :ref="(el) => emit('frame', el as HTMLElement | null)"
    class="plugin-panel-view-frame"
    :class="{ 'is-maximized': panelViewMaximized }"
    role="region"
    :aria-label="title"
    data-testid="plugin-panel-view-frame"
  >
    <header class="plugin-panel-view-chrome" @dblclick="togglePluginPanelViewMaximized">
      <Button variant="ghost" size="sm" class="plugin-panel-view-back" :title="`${t('plugins.backToList')} (Esc)`" @click="closePluginPanelView">
        <Icon name="back" :size="14" />
        {{ t('plugins.backToList') }}
      </Button>
      <img v-if="pluginIconUrl(panelViewPlugin)" :src="pluginIconUrl(panelViewPlugin) ?? ''" alt="" @error="hidePluginIcon(panelViewPlugin.id)" />
      <span v-else class="plugin-panel-view-icon" aria-hidden="true"><Icon name="plugin" :size="16" /></span>
      <div class="plugin-panel-view-title">
        <strong ref="headingRef" tabindex="-1">{{ title }}</strong>
        <span>
          {{ name }} · {{ t('pluginVersion', { version: panelViewPlugin.currentVersion }) }}
        </span>
      </div>
      <Chip v-if="panelViewPlugin.development" tone="warn" icon="warning">{{ t('pluginSignatureDeveloperUnverified') }}</Chip>
        <Chip v-else-if="panelViewPlugin.signatureStatus === 'unverified'" tone="warn" icon="warning">{{ t('plugins.sigUnverified') }}</Chip>
      <Chip v-else-if="panelViewPlugin.signatureStatus === 'valid'" tone="success" icon="shield">{{ t('pluginSignatureVerified') }}</Chip>
      <Chip v-else tone="neutral" icon="info">{{ t('pluginSignatureUnsigned') }}</Chip>
      <Button
        variant="ghost"
        icon-only
        class="plugin-panel-view-control"
        :aria-label="t('plugins.reloadPanel')"
        :title="t('plugins.reloadPanel')"
        @click="reloadPluginPanelView"
      >
        <Icon name="refresh" :size="18" />
      </Button>
      <Button
        variant="ghost"
        icon-only
        class="plugin-panel-view-control"
        :aria-label="t('plugins.panelPermissions', { name })"
        :title="t('plugins.panelPermissions', { name })"
        @click="openPluginDetailFromPanel"
      >
        <Icon name="settings" :size="18" />
      </Button>
      <Button
        variant="ghost"
        icon-only
        class="plugin-panel-view-control"
        :aria-label="maximizeLabel"
        :title="maximizeTitle"
        :aria-pressed="panelViewMaximized"
        @click="togglePluginPanelViewMaximized"
      >
        <Icon :name="panelViewMaximized ? 'restore' : 'maximize'" :size="18" />
      </Button>
    </header>
    <div :ref="(el) => emit('content', el as HTMLElement | null)" class="plugin-panel-view-content" data-testid="plugin-panel-view-content">
      <div v-if="panelViewError" class="plugin-panel-view-state" role="alert">
        <Icon name="warning" :size="24" />
        <p class="state-title">{{ t('plugins.panelFailedTitle', { name }) }}</p>
        <p class="state-body">{{ localizedError(panelViewError) }}</p>
        <div class="state-actions">
          <Button variant="primary" size="sm" @click="reloadPluginPanelView">{{ t('plugins.reloadPanel') }}</Button>
          <Button variant="secondary" size="sm" @click="closePluginPanelView">{{ t('plugins.backToList') }}</Button>
          <Button variant="ghost" size="sm" @click="requestReport(panelViewPlugin.id)">{{ t('pluginReportIssue') }}</Button>
        </div>
      </div>
      <div v-else class="plugin-panel-view-state" role="status">
        <Spinner :size="20" />
        <p class="state-body">{{ slow ? t('plugins.panelStillLoading', { name }) : t('plugins.panelLoading', { name }) }}</p>
        <Button v-if="slow" variant="secondary" size="sm" @click="closePluginPanelView">{{ t('plugins.cancelLoading') }}</Button>
      </div>
    </div>
  </section>
</template>

<style scoped src="./PluginPanelFrame.css"></style>
