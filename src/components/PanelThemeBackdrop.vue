<script setup lang="ts">
import { computed, ref, watch, type CSSProperties } from 'vue'
import type { PanelThemeBackdropView } from '@/composables/usePanelTheme'
import { isPanelThemeAssetUrl, panelThemePositionCss } from '@/utils/panel-theme-css'

// 插件面板背景圖片 + 調暗覆蓋層（spec §4.1）。位於面板內容後方
// （在 isolated 的 .status-panel 中為 z-index -1），不接收指標事件，
// 也對輔助技術隱藏。純色 bg 仍畫在底下，
// 圖片載入失敗時顯示的就是它。

const props = defineProps<{ backdrop: PanelThemeBackdropView | null }>()

// 實際顯示的 URL；只在下一張圖片解碼完成後才切換。
const shownUrl = ref<string | null>(null)
let request = 0

watch(() => props.backdrop?.url ?? null, async url => {
  const current = ++request
  if (!url || !isPanelThemeAssetUrl(url)) {
    shownUrl.value = null
    return
  }
  const image = new Image()
  image.decoding = 'async'
  image.src = url
  try {
    await image.decode()
    if (current === request) shownUrl.value = url
  } catch {
    if (current === request) shownUrl.value = null
  }
}, { immediate: true })

const tile = computed(() => props.backdrop?.fit === 'tile')
const imageStyle = computed<CSSProperties>(() => {
  const backdrop = props.backdrop
  if (!backdrop) return {}
  const blur = Number.isInteger(backdrop.blur) && backdrop.blur > 0 && backdrop.blur <= 24 ? backdrop.blur : 0
  return {
    opacity: String(backdrop.opacity),
    objectFit: backdrop.fit === 'contain' ? 'contain' : 'cover',
    objectPosition: panelThemePositionCss(backdrop.position),
    filter: blur ? `blur(${blur}px)` : undefined,
    transform: blur ? 'scale(1.04)' : undefined,
  }
})
const tileStyle = computed<CSSProperties>(() => {
  const backdrop = props.backdrop
  if (!backdrop || !shownUrl.value) return {}
  const blur = Number.isInteger(backdrop.blur) && backdrop.blur > 0 && backdrop.blur <= 24 ? backdrop.blur : 0
  return {
    opacity: String(backdrop.opacity),
    // shownUrl 已符合 ^agent-pets://panel-theme/[0-9a-f]{32}$，所以無法跳出 url("")。
    backgroundImage: `url("${shownUrl.value}")`,
    backgroundPosition: panelThemePositionCss(backdrop.position),
    filter: blur ? `blur(${blur}px)` : undefined,
    transform: blur ? 'scale(1.04)' : undefined,
  }
})
const overlayStyle = computed(() => ({
  background: props.backdrop?.overlayColor,
  opacity: String(props.backdrop?.overlayOpacity ?? 1),
}))

function onError(): void {
  shownUrl.value = null
}
</script>

<template>
  <div v-if="backdrop && shownUrl" class="panel-theme-backdrop" aria-hidden="true">
    <div v-if="tile" class="panel-theme-backdrop-tile" :style="tileStyle" />
    <img v-else class="panel-theme-backdrop-image" :src="shownUrl" decoding="async" alt="" :style="imageStyle" @error="onError">
    <div class="panel-theme-backdrop-overlay" :style="overlayStyle" />
  </div>
</template>

<style scoped>
.panel-theme-backdrop {
  position: absolute;
  z-index: -1;
  overflow: hidden;
  border-radius: inherit;
  inset: 0;
  pointer-events: none;
}

.panel-theme-backdrop-image,
.panel-theme-backdrop-tile,
.panel-theme-backdrop-overlay {
  position: absolute;
  width: 100%;
  height: 100%;
  inset: 0;
}

.panel-theme-backdrop-tile {
  background-repeat: repeat;
}

@media (prefers-reduced-transparency: reduce), (forced-colors: active) {
  .panel-theme-backdrop {
    display: none;
  }
}
</style>
