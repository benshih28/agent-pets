<script setup lang="ts">
import { computed } from 'vue'
import { t, type TranslationKey } from '@/i18n'
import Button from '@/components/ui/Button.vue'
import Select from '@/components/ui/Select.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import { usePanelThemeActions } from '@/composables/usePanelThemeActions'
import {
  PANEL_THEME_FITS,
  PANEL_THEME_POSITIONS,
  PANEL_THEME_USER_BLURS,
  type PanelThemeFit,
  type PanelThemeMode,
  type PanelThemePosition,
  type PanelThemeRef,
  type PanelThemeUserImageOptions,
  type PanelThemeUserImageState,
} from '@/types/panel-theme'

// 單一啟用中（theme, mode）插槽的使用者背景圖片控制項。檔案在主程序的
// 原生對話框中選取；渲染端永遠看不到它的路徑。

const props = defineProps<{ themeRef: PanelThemeRef; mode: PanelThemeMode; userImage: PanelThemeUserImageState }>()
const { busy, status, error, importImage, clearImage, setImageOptions } = usePanelThemeActions()

const MODE_LABEL: Record<PanelThemeMode, TranslationKey> = { light: 'design.panelTheme.lightSlot', dark: 'design.panelTheme.darkSlot' }
const FIT_LABEL: Record<PanelThemeFit, TranslationKey> = {
  cover: 'design.panelTheme.image.fitCover', contain: 'design.panelTheme.image.fitContain', tile: 'design.panelTheme.image.fitTile',
}
const POSITION_LABEL: Record<PanelThemePosition, TranslationKey> = {
  center: 'design.panelTheme.image.positionCenter', top: 'design.panelTheme.image.positionTop', bottom: 'design.panelTheme.image.positionBottom',
  left: 'design.panelTheme.image.positionLeft', right: 'design.panelTheme.image.positionRight',
  'top-left': 'design.panelTheme.image.positionTopLeft', 'top-right': 'design.panelTheme.image.positionTopRight',
  'bottom-left': 'design.panelTheme.image.positionBottomLeft', 'bottom-right': 'design.panelTheme.image.positionBottomRight',
}

const current = computed(() => props.userImage.current ?? null)
const fitOptions = computed(() => PANEL_THEME_FITS.map(fit => ({ value: fit, label: t(FIT_LABEL[fit]) })))
const positionOptions = computed(() => PANEL_THEME_POSITIONS.map(position => ({ value: position, label: t(POSITION_LABEL[position]) })))
const blurOptions = computed(() => PANEL_THEME_USER_BLURS.map(blur => ({ value: String(blur), label: blur === 0 ? t('design.panelTheme.image.blurNone') : String(blur) })))
/** 預設選項：計算出的最小值、+0.05、+0.10 與 0.95（絕不低於最小值）。 */
const dimOptions = computed(() => {
  const minimum = props.userImage.minDim
  const values = [...new Set([minimum, minimum + 0.05, minimum + 0.1, 0.95].map(value => Math.min(0.95, Math.round(value * 100) / 100)))]
  return values.map(value => ({ value: String(value), label: t('design.panelTheme.image.dimValue', { percent: Math.round(value * 100) }) }))
})

function update(patch: Partial<PanelThemeUserImageOptions>): void {
  const image = current.value
  if (!image) return
  void setImageOptions(props.themeRef, props.mode, { fit: image.fit, position: image.position, dim: image.dim, blur: image.blur, ...patch })
}
</script>

<template>
  <div class="image-controls">
    <div class="image-heading">
      <span class="image-title">{{ t('design.panelTheme.image.forMode', { mode: t(MODE_LABEL[mode]) }) }}</span>
      <div class="image-actions">
        <Button size="sm" variant="secondary" :disabled="busy" :data-testid="`panel-theme-image-choose-${mode}`" @click="importImage(themeRef, mode)">{{ t('design.panelTheme.image.choose') }}</Button>
        <Button v-if="current" size="sm" variant="ghost" :disabled="busy" @click="clearImage(themeRef, mode)">{{ t('design.panelTheme.image.remove') }}</Button>
      </div>
    </div>
    <template v-if="current">
      <div class="image-row">
        <span class="image-label">{{ t('design.panelTheme.image.fit') }}</span>
        <Select :model-value="current.fit" size="sm" :aria-label="t('design.panelTheme.image.fit')" :disabled="busy" @update:model-value="update({ fit: $event as PanelThemeFit })">
          <option v-for="option in fitOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </Select>
      </div>
      <div class="image-row">
        <span class="image-label">{{ t('design.panelTheme.image.position') }}</span>
        <Select :model-value="current.position" size="sm" :aria-label="t('design.panelTheme.image.position')" :disabled="busy" @update:model-value="update({ position: $event as PanelThemePosition })">
          <option v-for="option in positionOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </Select>
      </div>
      <div class="image-row image-row-wrap">
        <span class="image-label">{{ t('design.panelTheme.image.dim') }}</span>
        <SegmentedControl
          :model-value="String(current.dim)"
          :options="dimOptions"
          :ariaLabel="t('design.panelTheme.image.dim')"
          semantics="radio"
          size="sm"
          :id-prefix="`panel-theme-dim-${themeRef.themeId}-${mode}-`"
          @update:model-value="update({ dim: Number($event) })"
        />
      </div>
      <div class="image-row image-row-wrap">
        <span class="image-label">{{ t('design.panelTheme.image.blur') }}</span>
        <SegmentedControl
          :model-value="String(current.blur)"
          :options="blurOptions"
          :ariaLabel="t('design.panelTheme.image.blur')"
          semantics="radio"
          size="sm"
          :id-prefix="`panel-theme-blur-${themeRef.themeId}-${mode}-`"
          @update:model-value="update({ blur: Number($event) as PanelThemeUserImageOptions['blur'] })"
        />
      </div>
    </template>
    <p class="image-live" role="status">{{ status }}</p>
    <p v-if="error" class="image-error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.image-controls {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding-top: var(--space-3);
  border-top: 1px solid var(--border-subtle);
}

.image-heading,
.image-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.image-heading {
  flex-wrap: wrap;
}

.image-row-wrap {
  flex-wrap: wrap;
}

.image-title {
  min-width: 0;
  color: var(--text-primary);
  font-size: var(--font-sm);
  font-weight: var(--weight-medium);
}

.image-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.image-label {
  flex: 0 0 auto;
  color: var(--text-secondary);
  font-size: var(--font-sm);
}

.image-live {
  min-height: 1em;
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-xs);
}

.image-error {
  margin: 0;
  color: var(--text-danger);
  font-size: var(--font-xs);
}
</style>
