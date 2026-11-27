<script setup lang="ts">
import { computed } from 'vue'
import { FILLED_ICONS, ICON_PATHS as paths } from '@/components/ui/icons'

const props = withDefaults(defineProps<{
  name: string
  size?: number
}>(), {
  size: 16,
})

// 填色圖示不能吃 svg 層級的 1.4 線條，否則會被描粗。
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
