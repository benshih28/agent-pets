<script setup lang="ts">
// Replaces the settings nav's text glyphs (文 ◈ ⌘ ✦ ↗ ⋯). Those rendered
// through the system font, so their weight and alignment differed between
// Windows and macOS, and no CSS could correct it — 文 is CJK and picked up
// different font metrics from the Latin glyphs beside it, while ⌘ carries a
// real meaning on macOS (the Command key) that has nothing to do with the
// "Desktop" section it labelled.
//
// Inline SVG renders identically on both platforms and inherits currentColor.
import { computed } from 'vue'
import { FILLED_ICONS, ICON_PATHS as paths } from '@/components/ui/icons'

const props = withDefaults(defineProps<{
  name: string
  size?: number
}>(), {
  size: 16,
})

// 填色圖示以實心繪製；否則 svg 層級的 1.4 線條會把它描粗。
const filled = computed(() => FILLED_ICONS.has(props.name))
</script>

<template>
  <svg
    class="icon"
    :width="size"
    :height="size"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.4"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path
      :d="paths[name] ?? ''"
      :fill="filled ? 'currentColor' : undefined"
      :stroke="filled ? 'none' : undefined"
    />
  </svg>
</template>

<style scoped>
.icon {
  display: block;
  flex: 0 0 auto;
}
</style>
