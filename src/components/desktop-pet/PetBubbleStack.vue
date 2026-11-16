<script setup lang="ts">
// 寵物上方的泡泡：依 feed-arbiter 選出的種類顯示權限請求、通知、pet_say、工作 toast／活動、
// 插件訊息或首次引導；同一時間只有一個。選擇邏輯留在 DesktopPet（coach mark 也要看它），這裡只渲染。
// data-pet-hit-target 是點擊穿透命中測試的依據，每個可點擊泡泡都要保留。
import { computed } from 'vue'
import { locale, t, type TranslationKey } from '@/i18n'
import { useAgentStore } from '@/stores/agentStore'
import type { BubbleKind } from '@/utils/feed-arbiter'
import { describeTool } from '@/utils/pet-toast'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import PermissionBubble from '@/components/permission/PermissionBubble.vue'
import PermissionNoticeBubble from '@/components/permission/PermissionNoticeBubble.vue'

defineProps<{
  bubbleSelection: BubbleKind | null
  isMultiPet: boolean
  coachShown: boolean
  stateAnnouncement: string
  sayTargetStyle: Record<string, string>
  pluginFeedTargetStyle: Record<string, string>
  pluginFeedTargetPetId: string
}>()

const emit = defineEmits<{
  'dismiss-coach': []
}>()

const store = useAgentStore()

const activityLabel = computed(() => {
  const raw = store.activityText
  if (!raw) return ''
  const description = describeTool(raw)
  return t(description.key as TranslationKey, description.params)
})

const toastIconName = computed(() => {
  switch (store.toast?.tone) {
    case 'error': return 'warning'
    case 'waiting': return 'bell'
    default: return 'check'
  }
})

const toastAutoCloseSeconds = computed(() => (
  store.toast ? Math.max(1, Math.round(store.toast.countdown.durationMs / 1000)) : 0
))

function openFromToast(): void {
  store.markPetInteraction()
  store.clearUnreadResults()
  store.dismissToast()
  store.togglePanel()
}

function openPluginFeedLink(itemId: string): void {
  store.openPluginFeedLink(itemId)
}

function openPluginPanelFromFeed(pluginId: string): void {
  void window.electronAPI?.openPluginPanelFromPet(pluginId)
}
</script>

<template>
  <Transition v-if="bubbleSelection === 'permission-request'" name="toast" mode="out-in">
    <PermissionBubble :key="store.permissionRequest ? `permission-${store.permissionRequest.requestId}` : `permission-outcome-${store.permissionOutcome?.requestId}`" />
  </Transition>

  <Transition v-else-if="bubbleSelection === 'permission-notice' && store.permissionBubbleActive && store.permissionNotice" name="toast" mode="out-in">
    <PermissionNoticeBubble key="permission-notice" />
  </Transition>

  <Transition v-else-if="bubbleSelection === 'presentation-say' && store.presentationSay" name="toast" mode="out-in">
    <div
      key="presentation-say"
      class="pet-toast presentation-say"
      :style="sayTargetStyle"
      role="status"
      aria-live="polite"
      data-pet-hit-target="solid"
    >
      <Icon class="presentation-say-icon" name="pets" :size="14" />
      <span class="presentation-say-text">{{ store.presentationSay.message }}</span>
    </div>
  </Transition>

  <Transition v-else-if="bubbleSelection === 'agent-toast' || bubbleSelection === 'activity'" name="toast" mode="out-in">
    <div
      v-if="store.toast"
      :key="`toast-${store.toast.id}`"
      class="pet-toast timed-toast"
      :class="[store.toast.tone, { paused: store.toastPaused }]"
      role="status"
      aria-live="polite"
      data-pet-hit-target="solid"
      @mousedown.stop
      @mouseenter="store.pauseToast()"
      @mouseleave="store.resumeToast()"
      @focusin="store.pauseToast()"
      @focusout="store.resumeToast()"
      @click.stop="openFromToast"
    >
      <span class="timed-toast-head">
        <Icon class="timed-toast-icon" :name="toastIconName" :size="14" />
        <strong class="timed-toast-title">{{ store.toast.title }}</strong>
        <span v-if="store.toast.meta" class="timed-toast-meta">{{ store.toast.meta }}</span>
      </span>
      <span v-if="store.toast.detail" class="timed-toast-detail">{{ store.toast.detail }}</span>
      <Button variant="ghost" size="sm" class="timed-toast-action" @mousedown.stop @click.stop="openFromToast">
        {{ t('pet.toastOpen') }}
      </Button>
      <span
        class="toast-countdown-track"
        aria-hidden="true"
      >
        <span
          class="toast-countdown-fill"
          :style="{ '--toast-duration': `${store.toast.countdown.durationMs}ms` }"
        />
      </span>
      <span class="sr-only">{{ t('pet.toastAutoClose', { seconds: toastAutoCloseSeconds }) }}</span>
    </div>
    <div v-else-if="!isMultiPet && store.activityText" key="activity" class="pet-toast activity" data-pet-hit-target="solid">
      <Icon class="activity-icon" name="settings" :size="14" />
      <span class="activity-text">{{ activityLabel }}</span>
    </div>
  </Transition>

  <Transition v-else-if="bubbleSelection === 'plugin-feed-normal' || bubbleSelection === 'plugin-feed-low'" name="toast" mode="out-in">
    <article
      v-if="store.pluginFeedItem"
      :key="`plugin-feed-${store.pluginFeedItem.id}`"
      class="pet-toast plugin-feed-toast"
      :style="pluginFeedTargetStyle"
      :data-target-pet-id="pluginFeedTargetPetId"
      role="status"
      aria-live="polite"
      data-pet-hit-target="solid"
      @mousedown.stop
      @click.stop
    >
      <img v-if="store.pluginFeedItem.iconUrl" class="plugin-feed-icon" :src="store.pluginFeedItem.iconUrl" alt="" />
      <div class="plugin-feed-copy">
        <span class="plugin-feed-source">{{ store.pluginFeedItem.pluginName[locale] }}</span>
        <!-- raw-control: 整則插件訊息（標題＋內文）都是連結；Button 是單行置中的動作按鈕，沒有多行內容的版型 -->
        <button
          v-if="store.pluginFeedItem.link"
          type="button"
          class="plugin-feed-message plugin-feed-link"
          :aria-label="t('pluginFeedOpenLink')"
          @click.stop="openPluginFeedLink(store.pluginFeedItem.id)"
        >
          <strong>{{ store.pluginFeedItem.title }}</strong>
          <span>{{ store.pluginFeedItem.body }}</span>
        </button>
        <div v-else class="plugin-feed-message">
          <strong>{{ store.pluginFeedItem.title }}</strong>
          <span>{{ store.pluginFeedItem.body }}</span>
        </div>
        <Button
          v-if="store.pluginFeedItem.panelViewAvailable"
          variant="secondary"
          size="sm"
          class="plugin-feed-open-panel"
          @mousedown.stop
          @click.stop="openPluginPanelFromFeed(store.pluginFeedItem.pluginId)"
        >
          {{ t('pluginOpenPanel') }}
        </Button>
      </div>
      <Button
        variant="ghost"
        size="sm"
        icon-only
        class="plugin-feed-close"
        :aria-label="t('close')"
        @mousedown.stop
        @click.stop="store.completePluginFeed(store.pluginFeedItem.id)"
      >
        <Icon name="close" :size="12" />
      </Button>
    </article>
  </Transition>

  <Transition v-else-if="coachShown" name="toast">
    <div
      key="coach"
      class="pet-toast coach-mark"
      role="status"
      aria-live="polite"
      data-pet-hit-target="solid"
      @mousedown.stop
      @click.stop
    >
      <span class="coach-copy">{{ t('pet.coachText') }}</span>
      <Button size="sm" variant="secondary" @mousedown.stop @click.stop="emit('dismiss-coach')">{{ t('pet.coachDismiss') }}</Button>
    </div>
  </Transition>

  <span class="sr-only" role="status" aria-live="polite">{{ stateAnnouncement }}</span>
</template>

<style scoped src="@/components/DesktopPetBubbles.css"></style>
