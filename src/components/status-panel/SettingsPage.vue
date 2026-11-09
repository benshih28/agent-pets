<script setup lang="ts">
import { openPanelThemeSettings, settingsSectionRequest } from '@/utils/settings-navigation'
import { panelThemeSettingsTarget } from '@/utils/panel-theme-css'
import { panelThemeState } from '@/composables/usePanelTheme'
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { t } from '@/i18n'
import { useAgentStore } from '@/stores/agentStore'
import Button from '@/components/ui/Button.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Icon from '@/components/ui/Icon.vue'
import SegmentedControl, { type SegmentedOption } from '@/components/ui/SegmentedControl.vue'
import TextField from '@/components/ui/TextField.vue'
import {
  SETTINGS_GROUPS,
  groupOfSection,
  searchSettings,
  type SettingsEntry,
  type SettingsGroupId,
  type SettingsSectionId,
} from '@/utils/settingsRegistry'

const props = defineProps<{ requestedPluginId: string; requestedPluginNonce?: number }>()
const group = defineModel<SettingsGroupId>('group', { required: true })
const store = useAgentStore()

const sectionComponents: Record<SettingsSectionId, ReturnType<typeof defineAsyncComponent>> = {
  language: defineAsyncComponent(() => import('@/components/status-panel/SettingsLanguage.vue')),
  appearance: defineAsyncComponent(() => import('@/components/status-panel/SettingsAppearance.vue')),
  pets: defineAsyncComponent(() => import('@/components/status-panel/SettingsPets.vue')),
  growth: defineAsyncComponent(() => import('@/components/status-panel/SettingsGrowth.vue')),
  notifications: defineAsyncComponent(() => import('@/components/status-panel/SettingsNotifications.vue')),
  desktop: defineAsyncComponent(() => import('@/components/status-panel/SettingsDesktop.vue')),
  advanced: defineAsyncComponent(() => import('@/components/status-panel/SettingsAdvanced.vue')),
  plugins: defineAsyncComponent(() => import('@/components/status-panel/SettingsPlugins.vue')),
}

const query = ref('')
const searchField = ref<InstanceType<typeof TextField> | null>(null)
const searching = computed(() => query.value.trim().length > 0)
const results = computed(() => searchSettings(query.value, key => t(key)))
const scroller = ref<HTMLElement | null>(null)
const flashSection = ref<SettingsSectionId | null>(null)
const moreAbove = ref(false)
const moreBelow = ref(false)
const scrollMemory = new Map<SettingsGroupId, number>()
let flashTimer: ReturnType<typeof setTimeout> | null = null

const groupOptions = computed<SegmentedOption[]>(() => SETTINGS_GROUPS.map(item => ({
  value: item.id,
  label: t(item.labelKey),
  attention: item.id === 'plugins' && store.pluginFeedUnreadCount > 0,
})))
const activeGroup = computed(() => SETTINGS_GROUPS.find(item => item.id === group.value) ?? SETTINGS_GROUPS[0])

function sectionProps(id: SettingsSectionId): Record<string, unknown> {
  return id === 'plugins' ? { requestedPluginId: props.requestedPluginId, requestNonce: props.requestedPluginNonce ?? 0 } : {}
}

function updateScrollHints(): void {
  const el = scroller.value
  moreAbove.value = !!el && el.scrollTop > 4
  moreBelow.value = !!el && el.scrollTop + el.clientHeight < el.scrollHeight - 4
}

function scrollToSection(section: SettingsSectionId): void {
  const el = scroller.value?.querySelector<HTMLElement>(`[data-settings-section="${section}"]`)
  if (!el) return
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' })
  if (flashTimer) clearTimeout(flashTimer)
  flashSection.value = section
  flashTimer = setTimeout(() => { flashSection.value = null }, reduceMotion ? 0 : 1400)
}

async function openResult(section: SettingsSectionId): Promise<void> {
  query.value = ''
  group.value = groupOfSection(section)
  await nextTick()
  await nextTick()
  scrollToSection(section)
}

// 有可用的主題插件時，"Panel theme" 會跳到所屬插件的 Panel themes 區塊，
// 否則跳到 Appearance 狀態卡片。
function openHit(entry: SettingsEntry): void {
  if (entry.id === 'panelThemeStyle') {
    const pluginId = panelThemeSettingsTarget(panelThemeState.value)
    if (pluginId) {
      query.value = ''
      openPanelThemeSettings(pluginId)
      return
    }
  }
  void openResult(entry.section)
}

watch(settingsSectionRequest, request => {
  if (request) void openResult(request.section)
})

// Section heights change as async sections load; keep the scroll hints honest.
let resizeObserver: ResizeObserver | null = null
function observeContent(): void {
  resizeObserver?.disconnect()
  const el = scroller.value
  if (!el || typeof ResizeObserver === 'undefined') return
  resizeObserver ??= new ResizeObserver(() => updateScrollHints())
  resizeObserver.observe(el)
  for (const child of Array.from(el.children)) resizeObserver.observe(child)
  updateScrollHints()
}

// "/" or Cmd/Ctrl+F jumps to the search box unless the user is already typing.
function onSearchShortcut(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null
  const typing = !!target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  const isFind = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f'
  if (event.defaultPrevented || (!isFind && (event.key !== '/' || typing))) return
  event.preventDefault()
  searchField.value?.focus()
  searchField.value?.select()
}

onMounted(() => {
  window.addEventListener('keydown', onSearchShortcut)
  void nextTick(observeContent)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onSearchShortcut)
  resizeObserver?.disconnect()
  if (flashTimer) clearTimeout(flashTimer)
})
watch([searching], () => { void nextTick(observeContent) })

// Per-group scroll memory: leaving a group remembers where you were.
watch(group, (_next, previous) => {
  if (previous && scroller.value) scrollMemory.set(previous, scroller.value.scrollTop)
  void nextTick(() => {
    if (scroller.value) scroller.value.scrollTop = scrollMemory.get(group.value) ?? 0
    observeContent()
  })
}, { flush: 'pre' })

watch(() => [props.requestedPluginId, props.requestedPluginNonce] as const, ([id]) => {
  if (id) void openResult('plugins')
})

defineExpose({ scrollToSection })
</script>

<template>
  <div class="settings-layout">
    <div class="settings-toolbar">
      <TextField
        ref="searchField"
        v-model="query"
        class="settings-search"
        type="search"
        search
        consume-escape
        :aria-label="t('panel.searchLabel')"
        :placeholder="`${t('panel.searchPlaceholder')} (/)`"
        :clear-label="t('panel.searchClear')"
        size="sm"
        @escape="query = ''"
      />
      <SegmentedControl
        v-if="!searching"
        v-model="group"
        :options="groupOptions"
        :ariaLabel="t('settingsSections')"
        id-prefix="settings-tab-"
        panel-id="settings-panel"
        size="sm"
        fill
      />
    </div>

    <div class="settings-scroll-frame" :class="{ 'more-above': moreAbove, 'more-below': moreBelow }">
      <div v-if="searching" ref="scroller" class="settings-content settings-results" role="region" :aria-label="t('panel.searchResults')" @scroll.passive="updateScrollHints">
        <p class="sr-only" role="status" aria-live="polite">{{ t('panel.searchCount', { count: results.length }) }}</p>
        <ul v-if="results.length > 0" class="settings-result-list">
          <li v-for="hit in results" :key="hit.entry.id">
            <button type="button" class="settings-result" @click="openHit(hit.entry)">
              <span class="settings-result-copy">
                <span class="settings-result-label">{{ hit.label }}</span>
                <span v-if="hit.help" class="settings-result-help">{{ hit.help }}</span>
              </span>
              <span class="settings-result-path">{{ t(SETTINGS_GROUPS.find(item => item.id === groupOfSection(hit.entry.section))!.labelKey) }}<Icon name="chevron-right" :size="12" /></span>
            </button>
          </li>
        </ul>
        <EmptyState v-else icon="search" :title="t('panel.searchNoResults', { query: query.trim() })">
          <Button variant="secondary" size="sm" @click="query = ''">{{ t('panel.searchClear') }}</Button>
        </EmptyState>
      </div>

      <div
        v-else
        id="settings-panel"
        ref="scroller"
        class="settings-content"
        role="tabpanel"
        tabindex="0"
        :aria-labelledby="`settings-tab-${group}`"
        @scroll.passive="updateScrollHints"
      >
        <section
          v-for="section in activeGroup.sections"
          :key="section"
          class="settings-section"
          :class="{ flash: flashSection === section }"
          :data-settings-section="section"
        >
          <component :is="sectionComponents[section]" v-bind="sectionProps(section)" />
        </section>
      </div>
    </div>
  </div>
</template>
