<script setup lang="ts">
import { computed } from 'vue'
import { t } from '@/i18n'
import type { PanelThemeCatalogEntry, PanelThemeColorProperty, PanelThemeMode } from '@/types/panel-theme'
import { panelThemePreviewStyle } from '@/utils/panel-theme-css'
import { panelThemePreviewBackdrop } from '@/composables/usePanelTheme'
import PanelThemeBackdrop from '@/components/PanelThemeBackdrop.vue'
import PanelThemePreviewPill from '@/components/panel-theme/PanelThemePreviewPill.vue'

// 面板的靜態模擬，將單一主題模式以 inline 套用到
// .panel-theme-preview 元素上（與面板使用相同的已驗證屬性對應表）。
// 內建預覽使用主機該模式的內建色盤。

const props = defineProps<{
  entry: PanelThemeCatalogEntry | null
  mode: PanelThemeMode
  builtin: Record<PanelThemeColorProperty, string> | null
  label: string
  forcedColors: boolean
}>()

const style = computed(() => panelThemePreviewStyle(props.entry, props.mode, props.builtin, props.forcedColors))
// 套用 petStatus 的膠囊在寵物視窗不畫文字陰影（DesktopPet.css），預覽照做。
const themedPill = computed(() => !props.forcedColors && Boolean(props.entry?.modes[props.mode]?.petStatus))
const backdrop = computed(() => panelThemePreviewBackdrop(props.entry, props.mode, props.forcedColors))
</script>

<template>
  <!-- data-mode：陰影與高光強度依「被預覽的模式」解析（tokens.css），不是面板目前的模式。 -->
  <div class="panel-theme-preview" role="img" :aria-label="label" :data-mode="mode" :style="style">
    <PanelThemeBackdrop :backdrop="backdrop" />
    <div class="preview-content" inert aria-hidden="true">
      <div class="preview-header">{{ t('design.panelTheme.previewTitle') }}</div>
      <div class="preview-card">
        <span class="preview-text">{{ t('design.panelTheme.previewBody') }}</span>
        <span class="preview-secondary">{{ t('design.panelTheme.previewSecondary') }}</span>
        <span class="preview-muted">{{ t('design.panelTheme.previewMuted') }}</span>
        <span class="preview-states">
          <span class="preview-danger">{{ t('design.panelTheme.previewDanger') }}</span>
          <span class="preview-success">{{ t('design.panelTheme.previewSuccess') }}</span>
        </span>
        <span class="preview-button">{{ t('design.panelTheme.previewButton') }}</span>
      </div>
      <!-- 寵物的狀態膠囊（寵物唯一可套主題的介面）。 -->
      <PanelThemePreviewPill :themed="themedPill" />
    </div>
  </div>
</template>

<style scoped>
.panel-theme-preview {
  /* 絕不繼承即時面板的漸層；漸層預覽會以 inline 設定。 */
  --panel-theme-background: initial;

  position: relative;
  min-width: 0;
  overflow: hidden;
  isolation: isolate;
  border: 1px solid var(--organic-border);
  border-radius: var(--organic-radius-md);
  background: var(--panel-theme-background, var(--organic-bg));
  color: var(--organic-text);
  font-family: var(--organic-font-body);
}

.preview-content {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
}

.preview-header {
  overflow: hidden;
  font-family: var(--organic-font-heading);
  font-size: var(--organic-font-heading-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-2);
  border: 1px solid var(--organic-border-soft);
  border-radius: var(--organic-radius-sm);
  background: var(--organic-surface);
  box-shadow: var(--organic-card-shadow);
  font-size: var(--organic-font-body-sm);
}

.preview-text,
.preview-secondary,
.preview-muted {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-secondary {
  color: var(--organic-text-secondary);
}

.preview-muted {
  color: var(--organic-text-muted);
}

.preview-states {
  display: flex;
  gap: var(--space-2);
}

.preview-danger {
  color: var(--organic-danger-text);
}

.preview-success {
  color: var(--organic-success-text);
}

.preview-button {
  align-self: flex-start;
  padding: 2px var(--space-2);
  border-radius: var(--organic-radius-sm);
  background: var(--organic-accent-hover);
  color: var(--organic-accent-contrast);
}
</style>
