<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useAgentStore } from '@/stores/agentStore'
import { t, tPlural } from '@/i18n'
import type { AchievementUnlock } from '@/types/achievement'
import { selectBubble } from '@/utils/feed-arbiter'
import { stateAriaLabel } from '@/utils/state-aria'
import { AGENT_STATE_PRESENTATION } from '@/utils/agent-state-presentation'
import PetAnimation from '@/components/PetAnimation.vue'
import PetBubbleStack from '@/components/desktop-pet/PetBubbleStack.vue'
import PetEdgePeekHandle from '@/components/desktop-pet/PetEdgePeekHandle.vue'
import PetStatusLine from '@/components/desktop-pet/PetStatusLine.vue'
import { useKeyedRefs, usePetBubbleAnchor } from '@/composables/usePetBubbleAnchor'
import Icon from '@/components/ui/Icon.vue'
import { usePetTheme } from '@/composables/usePetTheme'
import { usePetCoachMark } from '@/composables/usePetCoachMark'
import { usePetPluginBadges } from '@/composables/usePetPluginBadges'
import { usePetPointerInteractions } from '@/composables/usePetPointerInteractions'
import { EMPTY_STATUS_LINE_VIEW, usePetStatusLines } from '@/composables/usePetStatusLines'
import { useShimejiBehavior } from '@/composables/useShimejiBehavior'
import { PET_CELL_HEIGHT } from '@/types/pet-atlas'

const store = useAgentStore()
const clickAreaRef = ref<HTMLElement | null>(null)
const petAnimRef = ref<InstanceType<typeof PetAnimation> | null>(null)
const { items: multiPetInstances, setRef: setMultiPetRef } = useKeyedRefs<InstanceType<typeof PetAnimation>>()
const { items: multiPetItemElements, setRef: setMultiPetItem } = useKeyedRefs<HTMLElement>()

usePetTheme()

const {
  behavior: shimejiBehavior,
  facing: shimejiFacing,
  reducedMotion: shimejiReducedMotion,
  onPointerEnter: onPetPointerEnter,
  onPointerLeave: onPetPointerLeave,
} = useShimejiBehavior()

// Up to one line per active tool family; when nothing is active, fall back
// to a single line showing the pet's overall (idle/offline) state.
const displayLines = computed(() => {
  if (store.familyLines.length > 0) return store.familyLines
  return [{ key: 'overall', label: '', variants: [], state: store.currentState, project: undefined, since: undefined, petId: store.activePetId, sessionKey: '' }]
})

// With only one active family, one pet reflects it (and the status lines
// below carry the detail). With more than one — and the opt-in Settings
// toggle on — showing a single pet forces picking a "winner", so instead
// show one small pet per family, side by side.
const isMultiPet = computed(() => store.isMultiPet)
// Reduced motion degrades the pet instead of freezing it: states that carry
// information (working, waiting, failed) keep stepping at a very low rate, and
// only a resting pet is held still.
const petAnimationFrozen = computed(() => (
  shimejiReducedMotion.value && (store.currentState === 'idle' || store.currentState === 'offline')
))
const petLowFps = computed(() => store.petWindowMode.mode === 'mini' || shimejiReducedMotion.value)

const petAriaLabel = computed(() => t('pet.ariaLabel', { state: stateAriaLabel(store.currentState) }))
// Spoken when the visible state changes, not on every session update.
const stateAnnouncement = ref('')
watch(() => store.currentState, (state, previous) => {
  if (state === previous) return
  stateAnnouncement.value = stateAriaLabel(state)
})

// Mini mode shrinks the sprite to fit the fixed small window, whatever the pet size.
const MINI_FIT_PX = 88
const miniScale = computed(() => Math.min(0.42, MINI_FIT_PX / (PET_CELL_HEIGHT * store.petScale)))
const miniStatus = computed(() => {
  const { icon, labelKey } = AGENT_STATE_PRESENTATION[store.currentState].mini
  return { icon, label: t(labelKey) }
})

const bubbleSelection = computed(() => {
  const permissionRequest = Boolean(store.permissionBubbleActive && (store.permissionRequest || store.permissionOutcome))
  const permissionNotice = Boolean(store.permissionBubbleActive && store.permissionNotice)
  const agentBubbleEnabled = !store.permissionRequest && !store.permissionOutcome && !store.permissionNotice && store.bubbleActive
  const pluginFeed = store.pluginFeedItem

  return selectBubble({
    permissionRequest,
    permissionNotice,
    agentToast: Boolean(agentBubbleEnabled && store.toast),
    presentationSay: Boolean(store.presentationSay),
    activity: Boolean(store.activityBubbleActive && agentBubbleEnabled && !store.toast && !isMultiPet.value && store.activityText),
    pluginFeed: pluginFeed ? {
      priority: pluginFeed.priority,
      controls: {
        pluginsEnabled: true,
        enabled: true,
        muted: false,
        dnd: store.dndEnabled,
        visible: store.petWindowMode.mode === 'normal' && document.visibilityState === 'visible',
      },
    } : null,
  })
})

const { shown: coachShown, dismiss: dismissCoach } = usePetCoachMark(() => bubbleSelection.value)

const pluginFeedTargetPetId = computed(() => {
  const targetPetId = store.pluginFeedItem?.targetPetId
  if (targetPetId) return targetPetId
  return isMultiPet.value ? store.familyLines[0]?.petId ?? store.activePetId : store.activePetId
})

const pluginBadges = usePetPluginBadges(() => pluginFeedTargetPetId.value)

const pluginFeedTargetStyle = usePetBubbleAnchor(
  clickAreaRef,
  multiPetItemElements,
  () => store.familyLines,
  () => isMultiPet.value && Boolean(store.pluginFeedItem),
  () => pluginFeedTargetPetId.value,
)

// pet_say bubbles follow the pet they were addressed to when several are shown.
const sayTargetStyle = usePetBubbleAnchor(
  clickAreaRef,
  multiPetItemElements,
  () => store.familyLines,
  () => isMultiPet.value && Boolean(store.presentationSay?.petId),
  () => store.presentationSay?.petId,
)

const { views: statusLineViews, draining } = usePetStatusLines({
  lines: () => (isMultiPet.value ? store.familyLines : displayLines.value),
  isMultiPet: () => isMultiPet.value,
  badgeSummaryFor: pluginBadges.summaryFor,
  badgeTooltip: pluginBadges.tooltip,
})

function lineView(key: string) {
  return statusLineViews.value[key] ?? EMPTY_STATUS_LINE_VIEW
}

// 單寵物只有一個動畫實例，多寵物每個家族一個；表情／注視／獎勵一律對目前顯示的全部實例播放。
function activeAnimations(): InstanceType<typeof PetAnimation>[] {
  if (isMultiPet.value) return [...multiPetInstances.values()]
  return petAnimRef.value ? [petAnimRef.value] : []
}

function multiPetAnimationForPet(petId: string): InstanceType<typeof PetAnimation> | undefined {
  const line = store.familyLines.find(candidate => candidate.petId === petId)
  return line ? multiPetInstances.get(line.key) : undefined
}

const { dragLift, onKeydown: onPetKeydown, onMouseMove: onPetMouseMove, onMouseDown, onDoubleClick, onClick, onContextMenu: onPetContextMenu } = usePetPointerInteractions({
  clickAreaRef,
  animations: activeAnimations,
  dismissCoach,
})

// --- 視窗高度回報（ResizeObserver）------------------------------------------

// The sprite is bottom-anchored inside a window that reserves fixed
// transparent headroom above it for the quota tooltip, so how much of the
// window is actually painted varies with pet size and status-line count.
// Main can't derive that, and it's what the status panel anchors to, so
// measure it here and report every change.
let contentObserver: ResizeObserver | null = null

onMounted(() => {
  store.loadPets()
  if (!clickAreaRef.value || !window.electronAPI?.reportContentHeight) return
  contentObserver = new ResizeObserver(([entry]) => {
    window.electronAPI?.reportContentHeight(Math.ceil(entry.contentRect.height))
  })
  contentObserver.observe(clickAreaRef.value)
})

onBeforeUnmount(() => {
  contentObserver?.disconnect()
  contentObserver = null
})

// --- Presentation 與成就回饋動畫 ---------------------------------------------

watch(() => store.presentationReaction, (reaction) => {
  // An explicit MCP request is always shown: with motion effects off the pet
  // still gets its icon mark, just without the movement.
  if (!reaction) return
  const kind = reaction.reaction
  if (isMultiPet.value) {
    if (reaction.petId) {
      multiPetAnimationForPet(reaction.petId)?.playReaction(kind)
    } else {
      activeAnimations().forEach(anim => anim.playReaction(kind))
    }
    return
  }
  if (!reaction.petId || reaction.petId === store.activePetId) {
    petAnimRef.value?.playReaction(kind)
  }
}, { deep: true })

function playAchievementReward(unlock: AchievementUnlock): void {
  if (!store.reactionsActive) return
  if (isMultiPet.value) {
    const target = multiPetAnimationForPet(unlock.petId)
    if (target) {
      target.playReward()
      return
    }
    activeAnimations().forEach(anim => anim.playReward())
    return
  }
  if (unlock.petId === store.activePetId) petAnimRef.value?.playReward()
}

watch(() => store.achievementUnlock, (unlock) => {
  if (unlock) playAchievementReward(unlock)
})

// Level-up / evolution reuses the reward animation (growth stream).
watch(() => store.levelUpEvent, (event) => {
  if (event && store.reactionsActive) petAnimRef.value?.playReward()
})
</script>

<template>
  <div
    class="desktop-pet"
    :class="[`mode-${store.petWindowMode.mode}`, store.petWindowMode.edge ? `edge-${store.petWindowMode.edge}` : '']"
    :data-pet-mode="store.petWindowMode.mode"
    :style="{ '--mini-scale': miniScale }"
  >
    <div
      ref="clickAreaRef"
      class="pet-click-area"
      :class="{ dragging: dragLift }"
      :role="store.petWindowMode.mode === 'edge' ? undefined : 'button'"
      :tabindex="store.petWindowMode.mode === 'edge' ? undefined : 0"
      :aria-label="store.petWindowMode.mode === 'edge' ? undefined : petAriaLabel"
      @keydown="onPetKeydown"
      @dblclick="onDoubleClick"
      @mousedown="onMouseDown"
      @mouseenter="onPetPointerEnter"
      @mouseleave="onPetPointerLeave"
      @mousemove="onPetMouseMove"
      @click="onClick"
      @contextmenu.prevent="onPetContextMenu"
    >
      <PetEdgePeekHandle
        v-if="store.petWindowMode.mode === 'edge'"
        :freeze="petAnimationFrozen"
        :low-fps="petLowFps"
        :facing="shimejiFacing"
        @press="onMouseDown"
      />

      <template v-else>
        <PetBubbleStack
          :bubble-selection="bubbleSelection"
          :is-multi-pet="isMultiPet"
          :coach-shown="coachShown"
          :state-announcement="stateAnnouncement"
          :say-target-style="sayTargetStyle"
          :plugin-feed-target-style="pluginFeedTargetStyle"
          :plugin-feed-target-pet-id="pluginFeedTargetPetId"
          @dismiss-coach="dismissCoach"
        />

    <span
      v-if="store.petWindowMode.mode === 'mini'"
      class="mini-status"
      role="status"
      :aria-label="miniStatus.label"
      :title="miniStatus.label"
      :style="{ '--mini-ring': AGENT_STATE_PRESENTATION[store.currentState].color }"
    >
      <span class="mini-status-badge" :class="{ pulse: store.currentState !== 'idle' && store.currentState !== 'offline' }">
        <Icon v-if="miniStatus.icon" :name="miniStatus.icon" :size="11" />
        <span v-else class="mini-status-dot" />
      </span>
      <span v-if="store.completionMarkersEnabled && store.unreadResults.count > 0" class="mini-status-count">{{ store.unreadResults.count }}</span>
    </span>

    <span
      v-if="store.completionMarkersEnabled && store.unreadResults.count > 0"
      class="unread-badge"
      :class="{ error: store.unreadResults.hasError }"
      role="status"
      :aria-label="tPlural('pet.unreadResultsAria', store.unreadResults.count)"
      data-pet-hit-target="solid"
      @mousedown.stop
      @click.stop="store.clearUnreadResults()"
    >
      <Icon :name="store.unreadResults.hasError ? 'warning' : 'check'" :size="11" />
      {{ store.unreadResults.count }}
    </span>

        <template v-if="isMultiPet">
          <div class="multi-pet-row">
            <div v-for="line in store.familyLines" :key="line.key" :ref="(el) => setMultiPetItem(line.key, el)" class="multi-pet-item">
              <PetAnimation
                :ref="(el) => setMultiPetRef(line.key, el)"
                :state="line.state"
                :pet-id="line.petId"
                :since="line.since"
                :mood="store.moodVisualsEnabled ? store.mood : undefined"
                :autonomous-behavior="shimejiBehavior"
                :freeze="petAnimationFrozen"
                :low-fps="petLowFps"
                :facing="shimejiFacing"
              />
              <PetStatusLine
                class="multi-pet-status-line"
                :line="line"
                :view="lineView(line.key)"
                :badges-visible="pluginBadges.visible.value"
                :motion="store.reactionsActive"
                :draining="Boolean(draining[line.key])"
                :badge-tooltip="pluginBadges.tooltip"
              />
            </div>
          </div>
        </template>

        <template v-else>
          <PetAnimation
            ref="petAnimRef"
            :state="store.currentState"
            :pet-id="store.activePetId"
            :since="store.highestPrioritySession?.lastSeenAt"
            :mood="store.moodVisualsEnabled ? store.mood : undefined"
            :autonomous-behavior="shimejiBehavior"
            :freeze="petAnimationFrozen"
            :low-fps="petLowFps"
            :facing="shimejiFacing"
          />
          <TransitionGroup tag="div" name="status-line" class="status-lines">
            <PetStatusLine
              v-for="line in displayLines"
              :key="line.key"
              :line="line"
              :view="lineView(line.key)"
              :badges-visible="pluginBadges.visible.value"
              :motion="store.reactionsActive"
              :draining="Boolean(draining[line.key])"
              :badge-tooltip="pluginBadges.tooltip"
            />
          </TransitionGroup>
        </template>
      </template>
    </div>
  </div>
</template>

<style scoped src="@/components/DesktopPet.css"></style>
