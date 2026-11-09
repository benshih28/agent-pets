<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { te } from '@/utils/theme-editor-i18n'
import type { PanelThemeCatalogEntry, PanelThemeMode } from '@/types/panel-theme'
import { panelThemePreviewStyle } from '@/utils/panel-theme-css'
import { panelThemePreviewBackdrop } from '@/composables/usePanelTheme'
import Icon from '@/components/ui/Icon.vue'
import PanelThemeBackdrop from '@/components/PanelThemeBackdrop.vue'
import PanelThemePreviewPill from '@/components/panel-theme/PanelThemePreviewPill.vue'
import PermissionRiskBadge from '@/components/permission/PermissionRiskBadge.vue'

// 主題編輯器的即時預覽：與設定頁預覽相同的做法（同一組已驗證屬性 inline 套在
// .panel-theme-preview 上，語意層在該元素重新解析），內容涵蓋面板卡片、按鈕的各種狀態、
// 選單、通知、對話框、內嵌權限卡與高風險徽章，以及寵物狀態列。內容是靜態的（inert）。
//
// 版面是固定寬度（STAGE_WIDTH）的縮圖，以 CSS zoom 整體縮放到欄寬與高度上限內，所以內容永遠
// 完整顯示、沒有內層捲動。高度上限由父層以 max-height 給在 .ep-slot 上（none = 不限高度，
// 只依欄寬縮放）；zoom 會影響版面，外框自然跟著縮放後的大小。

const props = defineProps<{
  entry: PanelThemeCatalogEntry
  mode: PanelThemeMode
  label: string
  forcedColors: boolean
}>()

/** 縮圖的設計寬度（px）：兩欄排版，約為面板寬度。 */
const STAGE_WIDTH = 340
/** 小於這個差距不更新，避免 ResizeObserver 因四捨五入反覆觸發。 */
const SCALE_EPSILON = 0.005
/** 外框左右（上下）各 1px 的邊框。 */
const FRAME_BORDER = 2

const style = computed(() => panelThemePreviewStyle(props.entry, props.mode, null, props.forcedColors))
const themedPill = computed(() => !props.forcedColors && Boolean(props.entry.modes[props.mode]?.petStatus))
const backdrop = computed(() => panelThemePreviewBackdrop(props.entry, props.mode, props.forcedColors))

const slotRef = ref<HTMLElement | null>(null)
const stageRef = ref<HTMLElement | null>(null)
const scale = ref(1)
const stageStyle = computed(() => ({ width: `${STAGE_WIDTH}px`, zoom: String(scale.value) }))

function fit(): void {
  const slot = slotRef.value
  const stage = stageRef.value
  if (!slot || !stage) return
  const available = slot.clientWidth - FRAME_BORDER
  if (available <= 0) return
  // 目前的高度已經乘上 zoom：除回去得到設計尺寸下的高度。
  const naturalHeight = stage.getBoundingClientRect().height / scale.value
  const maxHeight = Number.parseFloat(getComputedStyle(slot).maxHeight)
  const byWidth = available / STAGE_WIDTH
  const byHeight = Number.isFinite(maxHeight) && naturalHeight > 0 ? (maxHeight - FRAME_BORDER) / naturalHeight : Infinity
  const next = Math.min(1, byWidth, byHeight)
  if (next > 0 && Math.abs(next - scale.value) > SCALE_EPSILON) scale.value = next
}

let observer: ResizeObserver | null = null

onMounted(() => {
  observer = new ResizeObserver(() => fit())
  if (slotRef.value) observer.observe(slotRef.value)
  if (stageRef.value) observer.observe(stageRef.value)
  // 高度上限是 vh：視窗變高或變矮時欄寬可能不變，要另外聽。
  window.addEventListener('resize', fit)
  fit()
})

onBeforeUnmount(() => {
  observer?.disconnect()
  window.removeEventListener('resize', fit)
})
</script>

<template>
  <div ref="slotRef" class="ep-slot">
    <div class="panel-theme-preview editor-preview" role="img" :aria-label="label" :data-mode="mode" :style="style" :data-testid="`editor-preview-${mode}`">
      <PanelThemeBackdrop :backdrop="backdrop" />
      <div ref="stageRef" class="ep-content" :style="stageStyle" inert aria-hidden="true">
        <div class="ep-column">
          <div class="ep-card">
            <div class="ep-heading">{{ te('themeEditor.mock.panelTitle') }}</div>
            <div class="ep-row">
              <span class="ep-dot" />
              <span class="ep-text">{{ te('themeEditor.mock.row') }}</span>
            </div>
            <span class="ep-muted">{{ te('themeEditor.mock.rowMeta') }}</span>
            <span class="ep-states">
              <span class="ep-chip ep-success">{{ te('themeEditor.mock.success') }}</span>
              <span class="ep-chip ep-warn">{{ te('themeEditor.mock.warn') }}</span>
            </span>
            <span class="ep-info">{{ te('themeEditor.mock.info') }}</span>
            <span class="ep-link">{{ te('themeEditor.mock.link') }}</span>
          </div>

          <div class="ep-buttons">
            <span class="ep-button ep-primary">{{ te('themeEditor.mock.primary') }}</span>
            <span class="ep-button ep-primary ep-hover">{{ te('themeEditor.mock.hover') }}</span>
            <span class="ep-button ep-secondary">{{ te('themeEditor.mock.secondary') }}</span>
            <span class="ep-button ep-secondary ep-focus">{{ te('themeEditor.mock.focus') }}</span>
            <span class="ep-button ep-secondary ep-disabled">{{ te('themeEditor.mock.disabled') }}</span>
          </div>

          <div class="ep-scrim">
            <div class="ep-dialog">
              <strong class="ep-dialog-title">{{ te('themeEditor.mock.dialogTitle') }}</strong>
              <span class="ep-muted">{{ te('themeEditor.mock.dialogBody') }}</span>
            </div>
          </div>
        </div>

        <div class="ep-column">
          <ul class="ep-menu">
            <li class="ep-menu-item">{{ te('themeEditor.mock.menuOpen') }}</li>
            <li class="ep-menu-item ep-menu-hover">{{ te('themeEditor.mock.menuRename') }}</li>
            <li class="ep-menu-item ep-menu-danger">{{ te('themeEditor.mock.menuDelete') }}</li>
          </ul>
          <div class="ep-toast">
            <Icon name="check" :size="12" />
            <span>{{ te('themeEditor.mock.toast') }}</span>
          </div>

          <div class="ep-permission">
            <div class="ep-permission-head">
              <span class="ep-text">{{ te('themeEditor.mock.permissionTitle') }}</span>
              <PermissionRiskBadge risk="high" />
            </div>
            <code class="ep-command">{{ te('themeEditor.mock.permissionCommand') }}</code>
            <div class="ep-permission-actions">
              <span class="ep-button ep-secondary ep-deny">{{ te('themeEditor.mock.deny') }}</span>
              <span class="ep-button ep-primary">{{ te('themeEditor.mock.allow') }}</span>
            </div>
          </div>

          <PanelThemePreviewPill :themed="themedPill" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped src="@/components/panel-theme/PanelThemeEditorPreview.css"></style>
