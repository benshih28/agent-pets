<script setup lang="ts">
// 貼邊（edge-peek）迷你模式：只露出一個小把手，內含縮小的寵物頭像與未讀徽章。
// 拖曳交給父層（沿用同一條拖曳路徑，讓滑鼠與鍵盤入口一致），這裡只回報按下與展開。
import { tPlural, t } from '@/i18n'
import { useAgentStore } from '@/stores/agentStore'
import PetAnimation from '@/components/PetAnimation.vue'

defineProps<{
  freeze: boolean
  lowFps: boolean
  facing: -1 | 1
}>()

const emit = defineEmits<{
  press: [event: MouseEvent]
}>()

const store = useAgentStore()

function onMouseDown(event: MouseEvent): void {
  if (event.button !== 0) return
  event.stopPropagation()
  emit('press', event)
}

function expand(): void {
  store.setPetMode('normal')
}
</script>

<template>
  <div
    class="edge-peek-handle"
    role="button"
    tabindex="0"
    :aria-label="t('expandFromEdge')"
    data-pet-hit-target="solid"
    data-pet-context-target="hide"
    @mousedown.stop="onMouseDown"
    @click.stop="expand"
    @keydown.enter.prevent="expand"
    @keydown.space.prevent="expand"
  >
    <span
      class="edge-peek-avatar"
      aria-hidden="true"
      :style="{ '--edge-peek-avatar-scale': 0.5 / store.petScale }"
    >
      <PetAnimation
        :state="store.currentState"
        :pet-id="store.activePetId"
        :since="store.highestPrioritySession?.lastSeenAt"
        autonomous-behavior="idle"
        :freeze="freeze"
        :low-fps="lowFps"
        :facing="facing"
      />
    </span>
    <span class="edge-peek-grip" aria-hidden="true" />
    <span
      v-if="store.completionMarkersEnabled && store.unreadResults.count > 0"
      class="edge-peek-result-badge"
      :class="{ error: store.unreadResults.hasError }"
      :aria-label="tPlural('pet.unreadResultsAria', store.unreadResults.count)"
    >
      {{ store.unreadResults.count }}
    </span>
    <span
      v-if="store.pluginFeedUnreadCount > 0"
      class="edge-peek-unread-badge"
      :aria-label="tPlural('pluginFeedUnreadNotifications', store.pluginFeedUnreadCount)"
    >
      {{ store.pluginFeedUnreadCount > 99 ? '99+' : store.pluginFeedUnreadCount }}
    </span>
  </div>
</template>

<style scoped src="@/components/desktop-pet/PetEdgePeekHandle.css"></style>
