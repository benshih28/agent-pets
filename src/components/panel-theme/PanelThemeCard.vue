<script setup lang="ts">
import { computed } from 'vue'
import { locale, t, type TranslationKey } from '@/i18n'
import Button from '@/components/ui/Button.vue'
import Chip from '@/components/ui/Chip.vue'
import PanelThemePreview from '@/components/panel-theme/PanelThemePreview.vue'
import PanelThemeImageControls from '@/components/panel-theme/PanelThemeImageControls.vue'
import { panelThemeMedia, panelThemeState } from '@/composables/usePanelTheme'
import { activePanelThemeModes } from '@/utils/panel-theme-css'
import { PANEL_THEME_MODES, type PanelThemeCatalogEntry, type PanelThemeMode } from '@/types/panel-theme'

// 一個目錄主題（插件主題或我的主題）的卡片：名稱、使用中徽章、淺色／深色預覽、
// 「用於淺色／深色／兩種模式」，以及使用中模式的背景圖控制。插件詳情、主題插件分頁與
// 「我的主題」共用，額外的動作放在 #actions 插槽。

const props = defineProps<{
  entry: PanelThemeCatalogEntry
  title: string
  /** 預覽只在卡片可見時才渲染（由父層的 IntersectionObserver 決定）。 */
  visible: boolean
  busy: boolean
}>()
const emit = defineEmits<{ apply: [modes: readonly PanelThemeMode[]] }>()

const MODE_SHORT: Record<PanelThemeMode, TranslationKey> = { light: 'design.panelTheme.modeShortLight', dark: 'design.panelTheme.modeShortDark' }
const MODE_NAME: Record<PanelThemeMode, TranslationKey> = { light: 'design.panelTheme.modeLight', dark: 'design.panelTheme.modeDark' }

const modes = computed(() => PANEL_THEME_MODES.filter(mode => props.entry.modes[mode]))
const activeModes = computed(() => activePanelThemeModes(panelThemeState.value, props.entry.ref))
const testId = computed(() => props.entry.ref.themeId)

function previewLabel(mode: PanelThemeMode): string {
  return t('design.panelTheme.preview', { theme: props.title, mode: t(MODE_NAME[mode]) })
}
</script>

<template>
  <article class="theme" :data-testid="`panel-theme-${testId}`">
    <header class="theme-header">
      <div class="theme-title-group">
        <strong class="theme-title">{{ title }}</strong>
        <span v-if="entry.description" class="theme-description">{{ entry.description[locale] }}</span>
      </div>
      <ul class="theme-badges">
        <li v-for="mode in activeModes" :key="mode">
          <Chip tone="success" icon="check">{{ t('design.panelTheme.activeBadge', { mode: t(MODE_SHORT[mode]) }) }}</Chip>
        </li>
        <li v-if="modes.length === 1">
          <Chip tone="neutral">{{ t(modes[0] === 'light' ? 'design.panelTheme.lightOnly' : 'design.panelTheme.darkOnly') }}</Chip>
        </li>
      </ul>
    </header>
    <div v-if="visible" class="theme-previews">
      <PanelThemePreview
        v-for="mode in modes"
        :key="mode"
        :entry="entry"
        :mode="mode"
        :builtin="null"
        :label="previewLabel(mode)"
        :forced-colors="panelThemeMedia.forcedColors"
      />
    </div>
    <div class="theme-actions">
      <Button
        v-for="mode in modes"
        :key="mode"
        size="sm"
        variant="secondary"
        :disabled="busy || activeModes.includes(mode)"
        :data-testid="`panel-theme-use-${testId}-${mode}`"
        @click="emit('apply', [mode])"
      >
        {{ t(mode === 'light' ? 'design.panelTheme.useLight' : 'design.panelTheme.useDark') }}
      </Button>
      <Button
        v-if="modes.length === 2"
        size="sm"
        variant="primary"
        :disabled="busy || activeModes.length === 2"
        :data-testid="`panel-theme-use-${testId}-both`"
        @click="emit('apply', PANEL_THEME_MODES)"
      >
        {{ t('design.panelTheme.useForBoth') }}
      </Button>
      <slot name="actions" />
    </div>
    <template v-for="mode in activeModes" :key="`image-${mode}`">
      <PanelThemeImageControls v-if="entry.modes[mode]?.userImage" :theme-ref="entry.ref" :mode="mode" :user-image="entry.modes[mode]!.userImage!" />
    </template>
  </article>
</template>

<style scoped>
.theme {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
}

.theme-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-2);
}

.theme-title-group {
  display: flex;
  min-width: 0;
  flex: 1 1 12em;
  flex-direction: column;
  gap: 2px;
}

.theme-title {
  overflow: hidden;
  color: var(--text-primary);
  font-size: var(--font-md);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.theme-description {
  color: var(--text-muted);
  font-size: var(--font-xs);
  line-height: var(--leading-normal);
}

.theme-badges {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.theme-previews {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2);
}

.theme-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
</style>
