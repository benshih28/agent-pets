<script setup lang="ts">
import { t } from '@/i18n'

// 預覽裡的寵物狀態膠囊（寵物視窗唯一會被 petStatus 覆寫的介面）。讀取所在 .panel-theme-preview
// 元素上的 --pet-status-*（沒有時退回由色盤衍生的膠囊色）；設定頁預覽與主題編輯器共用。
defineProps<{ themed: boolean }>()
</script>

<template>
  <div class="preview-pill" :class="{ themed }">
    <span class="preview-pill-dot" />
    <span class="preview-pill-text">{{ t('design.panelTheme.previewPillAgent') }}<span class="preview-pill-sep">·</span>{{ t('design.panelTheme.previewPillState') }}</span>
    <span class="preview-pill-percent">62%</span>
    <span class="preview-pill-track"><span class="preview-pill-fill" /></span>
  </div>
</template>

<style scoped>
.preview-pill {
  position: relative;
  display: flex;
  align-items: center;
  align-self: center;
  gap: var(--space-1);
  max-width: 100%;
  overflow: hidden;
  padding: var(--space-0-5) var(--space-2) 5px;
  border: 1px solid var(--pet-status-border, var(--organic-status-border));
  border-radius: var(--organic-status-radius);
  background:
    linear-gradient(160deg, var(--pet-gloss) 0%, transparent 55%),
    var(--pet-status-background, var(--organic-status-surface-fallback));
  box-shadow: var(--organic-status-shadow), var(--organic-status-highlight);
  color: var(--pet-status-text, var(--organic-status-text));
  text-shadow: var(--text-shadow-panel);
  font-size: var(--font-xs);
  white-space: nowrap;
}

.preview-pill.themed {
  text-shadow: none;
}

.preview-pill-dot {
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: var(--radius-pill);
  background: var(--state-success);
}

.preview-pill-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.preview-pill-sep {
  margin: 0 var(--space-0-5);
  color: var(--pet-status-text-muted, var(--organic-status-text));
}

.preview-pill-percent {
  flex: none;
  color: var(--pet-status-quota-fill, var(--organic-quota-sage));
}

.preview-pill-track {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 3px;
  background: var(--pet-status-quota-track, var(--organic-status-track));
}

.preview-pill-fill {
  display: block;
  width: 62%;
  height: 100%;
  background: var(--pet-status-quota-fill, var(--organic-quota-sage));
}
</style>
