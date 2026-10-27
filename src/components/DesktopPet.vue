<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useAgentStore } from '@/stores/agentStore'
import { STATE_LABELS_SHORT, STATE_COLORS } from '@/types/agent'
import { locale, t, type TranslationKey } from '@/i18n'
import type { AchievementUnlock } from '@/types/achievement'
import type { PluginBadgeView } from '@/types/plugin'
import {
  canRunAutonomousBehavior,
  ShimejiScheduler,
  SHIMEJI_IDLE_DELAY_MS,
  type PetAutonomousBehavior,
  type ShimejiContext,
} from '@/types/pet'
import { quotaWindowLabel, roundQuotaPercent } from '@/utils/format'
import { selectBubble } from '@/utils/feed-arbiter'
import { summarizePluginBadgesForPet } from '@/utils/plugin-badges'
import PetAnimation from '@/components/PetAnimation.vue'

const store = useAgentStore()
const dragOffset = ref({ x: 0, y: 0 })
const hasMoved = ref(false)
let mouseDownTime = 0
const petAnimRef = ref<InstanceType<typeof PetAnimation> | null>(null)
const multiPetRefs = ref<InstanceType<typeof PetAnimation>[]>([])
const multiPetItemElements = ref<HTMLElement[]>([])
const pluginBadges = ref<PluginBadgeView[]>([])
const petDocumentVisible = ref(true)
let cleanupPluginBadgeListener: (() => void) | null = null
let pluginBadgeRevision = 0

// --- Shimeji 行為排程 -------------------------------------------------------

const shimejiBehavior = ref<PetAutonomousBehavior>('idle')
const shimejiScheduler = new ShimejiScheduler()
const shimejiReducedMotion = ref(false)
const shimejiPowerSave = ref(false)
let shimejiTimer: ReturnType<typeof setTimeout> | null = null
let shimejiIdleSince = Date.now()
let shimejiMediaQuery: MediaQueryList | null = null
let cleanupShimejiPowerSave: (() => void) | null = null
interface ShimejiBattery {
  charging: boolean
  level: number
  addEventListener: (type: string, listener: () => void) => void
  removeEventListener: (type: string, listener: () => void) => void
}
let shimejiBattery: ShimejiBattery | null = null

function updateShimejiPowerSave(): void {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  shimejiPowerSave.value = Boolean(
    connection?.saveData
    || (shimejiBattery && !shimejiBattery.charging && shimejiBattery.level <= 0.2),
  )
}

const shimejiManifestCapabilities = computed(() => {
  const multiPetActive = store.multiPetEnabled && store.familyLines.length > 1
  const petIds = multiPetActive
    ? store.familyLines.map(line => line.petId)
    : [store.activePetId]
  const entries = petIds
    .map(id => store.pets.find(pet => pet.id === id))
    .filter((pet): pet is NonNullable<typeof pet> => Boolean(pet))
  return {
    canWalk: entries.length > 0 && entries.every(pet => Boolean(pet.behaviorManifest?.walk)),
    canSleep: entries.length > 0 && entries.every(pet => Boolean(pet.behaviorManifest?.sleep)),
  }
})

function shimejiContext(random?: number): ShimejiContext {
  return {
    enabled: store.shimejiEnabled,
    reactionsEnabled: store.reactionsEnabled,
    dndEnabled: store.dndEnabled,
    reducedMotion: shimejiReducedMotion.value,
    powerSave: shimejiPowerSave.value,
    documentVisible: document.visibilityState === 'visible',
    isDragging: store.isDragging,
    windowMode: store.petWindowMode.mode,
    currentState: store.currentState,
    activeSessionCount: store.activeSessions.length,
    pendingPermission: store.permissionRequests.length > 0,
    canWalk: shimejiManifestCapabilities.value.canWalk,
    canSleep: shimejiManifestCapabilities.value.canSleep,
    idleMs: Math.max(0, Date.now() - shimejiIdleSince),
    ...(random === undefined ? {} : { random }),
  }
}

function stopShimejiTimer(): void {
  if (shimejiTimer) clearTimeout(shimejiTimer)
  shimejiTimer = null
}

function scheduleShimeji(delayMs: number = SHIMEJI_IDLE_DELAY_MS): void {
  stopShimejiTimer()
  if (!store.shimejiEnabled || !canRunAutonomousBehavior(shimejiContext())) return
  shimejiTimer = setTimeout(runShimejiTick, Math.max(1_500, delayMs))
}

function runShimejiTick(): void {
  shimejiTimer = null
  const tick = shimejiScheduler.next(shimejiContext(Math.random()))
  shimejiBehavior.value = tick.behavior
  if (tick.walkDeltaX !== undefined && tick.behavior === 'walk') {
    window.electronAPI?.shimejiWalkStep(tick.walkDeltaX)
  }
  scheduleShimeji(tick.delayMs)
}

function restartShimeji(): void {
  stopShimejiTimer()
  shimejiScheduler.reset()
  shimejiBehavior.value = 'idle'
  shimejiIdleSince = Date.now()
  scheduleShimeji()
}

const shimejiGate = computed(() => [
  store.shimejiEnabled,
  store.reactionsEnabled,
  store.dndEnabled,
  store.currentState,
  store.activeSessions.length,
  store.permissionRequests.length,
  store.petWindowMode.mode,
  store.isDragging,
  store.petsLoaded,
  shimejiManifestCapabilities.value.canWalk,
  shimejiManifestCapabilities.value.canSleep,
  shimejiReducedMotion.value,
  shimejiPowerSave.value,
  document.visibilityState,
].join('|'))

watch(shimejiGate, restartShimeji)

function onShimejiVisibilityChange(): void {
  restartShimeji()
}

async function initializeShimejiEnvironment(): Promise<void> {
  shimejiMediaQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null
  if (shimejiMediaQuery) {
    shimejiReducedMotion.value = shimejiMediaQuery.matches
    shimejiMediaQuery.addEventListener?.('change', restartShimeji)
  }
  document.addEventListener('visibilitychange', onShimejiVisibilityChange)

  if (window.electronAPI?.getPowerSaveState) {
    try {
      shimejiPowerSave.value = await window.electronAPI.getPowerSaveState()
    } catch {}
  }
  cleanupShimejiPowerSave = window.electronAPI?.onPowerSaveStateUpdated?.((powerSave) => {
    shimejiPowerSave.value = powerSave
  }) ?? null

  const getBattery = (navigator as Navigator & {
    getBattery?: () => Promise<ShimejiBattery>
  }).getBattery
  if (getBattery) {
    try {
      shimejiBattery = await getBattery()
      shimejiBattery.addEventListener('chargingchange', updateShimejiPowerSave)
      shimejiBattery.addEventListener('levelchange', updateShimejiPowerSave)
      updateShimejiPowerSave()
    } catch {
      // Battery API 在 Electron 中可能不存在；仍保留 Reduced Motion 與 DND 閘門。
    }
  }
}

function disposeShimejiEnvironment(): void {
  stopShimejiTimer()
  document.removeEventListener('visibilitychange', onShimejiVisibilityChange)
  shimejiMediaQuery?.removeEventListener?.('change', restartShimeji)
  cleanupShimejiPowerSave?.()
  cleanupShimejiPowerSave = null
  shimejiBattery?.removeEventListener('chargingchange', updateShimejiPowerSave)
  shimejiBattery?.removeEventListener('levelchange', updateShimejiPowerSave)
  shimejiMediaQuery = null
  shimejiBattery = null
}

// --- 狀態列與 Quota 顯示 ---------------------------------------------------

// Up to one line per active tool family; when nothing is active, fall back
// to a single line showing the pet's overall (idle/offline) state.
const displayLines = computed(() => {
  if (store.familyLines.length > 0) return store.familyLines
  return [{ key: 'overall', label: '', variants: [], state: store.currentState, project: undefined, count: 0, since: undefined, petId: store.activePetId }]
})

// With only one active family, one pet reflects it (and the status lines
// below carry the detail). With more than one — and the opt-in Settings
// toggle on — showing a single pet forces picking a "winner", so instead
// show one small pet per family, side by side.
const isMultiPet = computed(() => store.isMultiPet)
const petAnimationFrozen = computed(() => shimejiReducedMotion.value || store.petWindowMode.mode === 'mini')

const bubbleSelection = computed(() => {
  const permissionRequest = Boolean(store.permissionBubbleActive && store.permissionRequest)
  const permissionNotice = Boolean(store.permissionBubbleActive && store.permissionNotice)
  const agentBubbleEnabled = !store.permissionRequest && !store.permissionNotice && store.bubbleActive
  const pluginFeed = store.pluginFeedItem

  return selectBubble({
    permissionRequest,
    permissionNotice,
    agentToast: Boolean(agentBubbleEnabled && store.toast),
    presentationSay: Boolean(store.presentationSay),
    activity: Boolean(agentBubbleEnabled && !store.toast && !isMultiPet.value && store.activityText),
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

function openPluginFeedLink(itemId: string): void {
  store.openPluginFeedLink(itemId)
}

function openPluginPanelFromFeed(pluginId: string): void {
  void window.electronAPI?.openPluginPanelFromPet(pluginId)
}

const pluginFeedTargetPetId = computed(() => {
  const targetPetId = store.pluginFeedItem?.targetPetId
  if (targetPetId) return targetPetId
  return isMultiPet.value ? store.familyLines[0]?.petId ?? store.activePetId : store.activePetId
})

const pluginBadgesVisible = computed(() => petDocumentVisible.value && store.petWindowMode.mode === 'normal')

function pluginBadgeSummary(petId: string) {
  if (!pluginBadgesVisible.value) return { badges: [], hiddenCount: 0 }
  return summarizePluginBadgesForPet(pluginBadges.value, petId, pluginFeedTargetPetId.value)
}

function pluginBadgeTooltip(badge: PluginBadgeView): string {
  return t('pluginBadgeTooltip', { plugin: badge.pluginName[locale.value], text: badge.text })
}

function onPetDocumentVisibilityChange(): void {
  petDocumentVisible.value = document.visibilityState === 'visible'
}

const pluginFeedTargetStyle = computed<Record<string, string>>(() => {
  if (!isMultiPet.value || !store.pluginFeedItem) return {} as Record<string, string>
  const clickArea = clickAreaRef.value
  if (!clickArea) return {} as Record<string, string>
  const targetIndex = store.familyLines.findIndex(line => line.petId === pluginFeedTargetPetId.value)
  const target = targetIndex >= 0 ? multiPetItemElements.value[targetIndex] : undefined
  if (!target) return {} as Record<string, string>
  const targetBounds = target.getBoundingClientRect()
  const areaBounds = clickArea.getBoundingClientRect()
  return { left: `${targetBounds.left - areaBounds.left + targetBounds.width / 2}px` }
})

function quotaColor(familyKey: string): string {
  const quota = store.quotaByFamily[familyKey]
  if (!quota) return 'transparent'
  if (quota.remainingPercent < 20) return 'var(--organic-quota-error)'
  if (quota.remainingPercent < 50) return 'var(--organic-quota-warning)'
  return familyKey === 'claude' ? 'var(--organic-accent)' : 'var(--organic-quota-sage)'
}

function quotaLineStyle(familyKey: string): Record<string, string> {
  return { '--quota-color': quotaColor(familyKey) }
}

function quotaFillStyle(familyKey: string): Record<string, string> {
  const quota = store.quotaByFamily[familyKey]
  if (!quota) return {}
  return {
    width: `${quota.remainingPercent}%`,
  }
}

function quotaPercent(familyKey: string): string {
  const remaining = store.quotaByFamily[familyKey]?.remainingPercent
  if (remaining === undefined) return ''
  return String(roundQuotaPercent(remaining))
}

function quotaDetails(familyKey: string) {
  const provider = store.quotaUsage?.providers.find((candidate) => candidate.id === familyKey)
  if (!provider) return []
  const primaryWindows = provider.windows.filter((window) => {
    const identity = `${window.id} ${window.label}`.toLowerCase()
    return identity.includes('session')
      || identity.includes('weekly')
      || identity.includes('five_hour')
      || identity.includes('seven_day')
  })
  return (primaryWindows.length > 0 ? primaryWindows : provider.windows).slice(0, 4)
}

function quotaDetailPercent(remainingPercent: number): string {
  return String(roundQuotaPercent(remainingPercent))
}

function quotaResetLabel(resetsAt?: string): string {
  if (!resetsAt) return t('resetTimeUnavailable')
  const reset = new Date(resetsAt)
  if (!Number.isFinite(reset.getTime())) return t('resetTimeUnavailable')
  // No year: the longest quota window is 7 days out, so it carries no
  // information and is the single widest chunk of the tooltip.
  return t('resetAt', { time: reset.toLocaleString(locale.value, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }) })
}

// --- Quota 下降時的閃爍動畫 -------------------------------------------------

// A quota drop is the pet "taking damage" — flash the meter for a moment so
// a change that happened while you weren't looking still registers. Driven
// by a class toggle (not a CSS transition) so consecutive drops re-run the
// animation from the start instead of being swallowed mid-flight.
const draining = ref<Record<string, boolean>>({})
const drainTimers: Record<string, number> = {}
const lastRemaining: Record<string, number> = {}

function flashDrain(familyKey: string) {
  window.clearTimeout(drainTimers[familyKey])
  draining.value = { ...draining.value, [familyKey]: false }
  requestAnimationFrame(() => {
    draining.value = { ...draining.value, [familyKey]: true }
    drainTimers[familyKey] = window.setTimeout(() => {
      draining.value = { ...draining.value, [familyKey]: false }
    }, 700)
  })
}

watch(() => store.quotaByFamily, (quotas) => {
  for (const [familyKey, quota] of Object.entries(quotas)) {
    const previous = lastRemaining[familyKey]
    lastRemaining[familyKey] = quota.remainingPercent
    // Only a meaningful drop counts: refreshes that report the same number
    // (or a reset that refills the bar) shouldn't strobe the meter.
    if (previous !== undefined && quota.remainingPercent < previous - 0.05) {
      flashDrain(familyKey)
    }
  }
}, { deep: true })

onBeforeUnmount(() => {
  Object.values(drainTimers).forEach((timer) => window.clearTimeout(timer))
})

function quotaTitle(familyKey: string): string | undefined {
  const details = quotaDetails(familyKey)
  if (details.length === 0) return undefined
  return details.map((quota) => (
    `${quotaWindowLabel(quota.id, quota.label)}：${t('percentRemaining', { value: quotaDetailPercent(quota.remainingPercent) })} · ${quotaResetLabel(quota.resetsAt)}`
  )).join('\n')
}

// --- Permission 泡泡 --------------------------------------------------------

const PERMISSION_RISK_LABEL_KEYS: Record<string, TranslationKey> = {
  high: 'permissionRiskHigh',
  medium: 'permissionRiskMedium',
  low: 'permissionRiskLow',
}

function permissionRiskLabel(risk: string): string {
  return t(PERMISSION_RISK_LABEL_KEYS[risk] ?? 'permissionRiskUnknown')
}

function decidePermission(decision: 'allow_once' | 'deny'): void {
  const request = store.permissionRequest
  if (!request || request.status !== 'pending') return
  void store.decidePermission(request.requestId, decision)
}

// --- 視窗高度回報（ResizeObserver）------------------------------------------

// The sprite is bottom-anchored inside a window that reserves fixed
// transparent headroom above it for the quota tooltip, so how much of the
// window is actually painted varies with pet size and status-line count.
// Main can't derive that, and it's what the status panel anchors to, so
// measure it here and report every change.
const clickAreaRef = ref<HTMLElement | null>(null)
let contentObserver: ResizeObserver | null = null

onMounted(() => {
  store.loadPets()
  void initializeShimejiEnvironment()
  petDocumentVisible.value = document.visibilityState === 'visible'
  document.addEventListener('visibilitychange', onPetDocumentVisibilityChange)
  cleanupPluginBadgeListener = window.electronAPI?.onPluginBadgesChanged?.((badges) => {
    pluginBadgeRevision += 1
    pluginBadges.value = badges
  }) ?? null
  const getPluginBadges = window.electronAPI?.getPluginBadges
  if (getPluginBadges) {
    const revision = pluginBadgeRevision
    void getPluginBadges().then((badges) => {
      if (pluginBadgeRevision === revision) pluginBadges.value = badges
    }).catch(() => {})
  }

  if (!clickAreaRef.value || !window.electronAPI?.reportContentHeight) return
  contentObserver = new ResizeObserver(([entry]) => {
    window.electronAPI?.reportContentHeight(Math.ceil(entry.contentRect.height))
  })
  contentObserver.observe(clickAreaRef.value)
})

onBeforeUnmount(() => {
  contentObserver?.disconnect()
  contentObserver = null
  cleanupPluginBadgeListener?.()
  cleanupPluginBadgeListener = null
  document.removeEventListener('visibilitychange', onPetDocumentVisibilityChange)
  disposeShimejiEnvironment()
})

// --- 拖曳與點擊 --------------------------------------------------------------

let lastCursorLookAt = 0
let lastCursorLookDirection: -1 | 0 | 1 = 0
function onPetMouseMove(e: MouseEvent): void {
  if (!store.shimejiEnabled || !store.reactionsActive || store.currentState !== 'idle') return
  if (store.petWindowMode.mode !== 'normal' || store.isDragging) return
  const area = clickAreaRef.value
  if (!area) return
  const rect = area.getBoundingClientRect()
  const offset = e.clientX - (rect.left + rect.width / 2)
  const direction: -1 | 0 | 1 = offset < -12 ? -1 : offset > 12 ? 1 : 0
  if (direction === 0 || direction === lastCursorLookDirection) return
  const now = Date.now()
  if (now - lastCursorLookAt < 350) return
  lastCursorLookAt = now
  lastCursorLookDirection = direction
  if (isMultiPet.value) {
    multiPetRefs.value.forEach(anim => anim?.playCursorLook(direction))
  } else {
    petAnimRef.value?.playCursorLook(direction)
  }
}

function onMouseDown(e: MouseEvent) {
  if (e.button !== 0) return
  hasMoved.value = false
  mouseDownTime = Date.now()
  store.isDragging = true
  dragOffset.value = { x: e.screenX, y: e.screenY }

  // Actual window movement is driven entirely by the main process polling
  // screen.getCursorScreenPoint() (see electron/main.ts's 'pet-drag-start'
  // handler) rather than by accumulating deltas between renderer mousemove
  // events. On Windows, moving a frameless window under the cursor makes
  // the OS resend a synthetic mousemove for the new window position; a
  // delta-from-previous-event approach picks that up as extra "movement"
  // and re-moves the window again, which re-triggers another synthetic
  // event — a feedback loop that reads as the pet continuously drifting
  // down for as long as the button is held, even with the mouse stationary.
  // Polling the OS cursor position directly sidesteps that loop entirely.
  window.electronAPI?.startDrag()

  const onMove = (moveEvent: MouseEvent) => {
    const dx = moveEvent.screenX - dragOffset.value.x
    const dy = moveEvent.screenY - dragOffset.value.y

    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      hasMoved.value = true
    }
  }

  const onUp = () => {
    store.isDragging = false
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    // Must fire unconditionally, even on a plain click with no movement:
    // 'pet-drag-start' unconditionally started a cursor-poll loop in the
    // main process (see electron/main.ts), and this is the only signal
    // that tells it to stop. Gating it on hasMoved (as the old "did we
    // actually move, so is there anything worth writing to disk" check
    // did) left that poll loop running after a plain click, so the pet
    // kept chasing the cursor around indefinitely after the button was
    // released, right up until the next mousedown replaced it.
    window.electronAPI?.notifyDragEnd(hasMoved.value)
  }

  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

function onEdgeMouseDown(e: MouseEvent): void {
  if (e.button !== 0) return
  e.stopPropagation()
  // The main process restores the saved Normal bounds before starting its
  // cursor poll. Calling the same drag path keeps mouse and keyboard entry
  // points consistent without letting the renderer choose native bounds.
  onMouseDown(e)
}

function onClick(e: MouseEvent) {
  if (e.button !== 0) return
  if (hasMoved.value) return
  if (isMultiPet.value) {
    multiPetRefs.value.forEach((anim) => anim?.playReaction())
  } else {
    petAnimRef.value?.playReaction()
  }
  store.togglePanel()
}

function onPetContextMenu(e: MouseEvent): void {
  if (!store.rightClickHideEnabled) return
  const target = e.target instanceof Element ? e.target : null
  if (!target) return
  // Only the actual sprite and its compact Edge representation are hide
  // targets. Permission cards, status lines, toasts, and other controls do not
  // inherit this shortcut.
  const isPetSurface = Boolean(target.closest('[data-pet-context-target="hide"]'))
  if (!isPetSurface) return
  window.electronAPI?.requestPetHide()
}

// --- Presentation 與成就回饋動畫 ---------------------------------------------

watch(() => store.presentationReaction, (reaction) => {
  if (!reaction || !store.reactionsActive) return
  if (isMultiPet.value) {
    if (reaction.petId) {
      const index = store.familyLines.findIndex(line => line.petId === reaction.petId)
      if (index >= 0) multiPetRefs.value[index]?.playReaction()
    } else {
      multiPetRefs.value.forEach(anim => anim?.playReaction())
    }
    return
  }
  if (!reaction.petId || reaction.petId === store.activePetId) {
    petAnimRef.value?.playReaction()
  }
}, { deep: true })

function playAchievementReward(unlock: AchievementUnlock): void {
  if (!store.reactionsActive) return
  if (isMultiPet.value) {
    const index = store.familyLines.findIndex(line => line.petId === unlock.petId)
    if (index >= 0) {
      multiPetRefs.value[index]?.playReward()
      return
    }
    multiPetRefs.value.forEach(anim => anim?.playReward())
    return
  }
  if (unlock.petId === store.activePetId) petAnimRef.value?.playReward()
}

watch(() => store.achievementUnlock, (unlock) => {
  if (unlock) playAchievementReward(unlock)
})
</script>

<template>
  <div
    class="desktop-pet"
    :class="[`mode-${store.petWindowMode.mode}`, store.petWindowMode.edge ? `edge-${store.petWindowMode.edge}` : '']"
    :data-pet-mode="store.petWindowMode.mode"
  >
    <div
      ref="clickAreaRef"
      class="pet-click-area"
      :class="{ dragging: store.isDragging }"
      @mousedown="onMouseDown"
      @mousemove="onPetMouseMove"
      @click="onClick"
      @contextmenu.prevent="onPetContextMenu"
    >
      <div
        v-if="store.petWindowMode.mode === 'edge'"
        class="edge-peek-handle"
        role="button"
        tabindex="0"
        :aria-label="t('expandFromEdge')"
        data-pet-hit-target="solid"
        data-pet-context-target="hide"
        @mousedown.stop="onEdgeMouseDown"
        @click.stop="store.setPetMode('normal')"
        @keydown.enter.prevent="store.setPetMode('normal')"
        @keydown.space.prevent="store.setPetMode('normal')"
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
            :freeze="petAnimationFrozen"
          />
        </span>
        <span class="edge-peek-grip" aria-hidden="true" />
        <span
          v-if="store.pluginFeedUnreadCount > 0"
          class="edge-peek-unread-badge"
          :aria-label="t('pluginFeedUnreadNotifications', { count: store.pluginFeedUnreadCount })"
        >
          {{ store.pluginFeedUnreadCount > 99 ? '99+' : store.pluginFeedUnreadCount }}
        </span>
      </div>

      <template v-else>
      <Transition v-if="bubbleSelection === 'permission-request' && store.permissionBubbleActive && store.permissionRequest" name="toast" mode="out-in">
        <section
          :key="`permission-${store.permissionRequest.requestId}`"
          class="permission-request"
          :class="[`risk-${store.permissionRequest.risk}`, { deciding: store.permissionRequest.status === 'deciding' }]"
          role="alertdialog"
          aria-labelledby="permission-request-title"
          aria-describedby="permission-request-description"
          data-pet-hit-target="solid"
          @mousedown.stop
          @click.stop
        >
          <header class="permission-request-header">
            <span class="permission-request-icon" aria-hidden="true">!</span>
            <span class="permission-request-heading">
              <strong id="permission-request-title">{{ store.permissionRequest.action }}</strong>
              <span>{{ permissionRiskLabel(store.permissionRequest.risk) }}</span>
            </span>
            <span class="permission-request-queue">
              {{ store.permissionRequest.queuePosition }}/{{ store.permissionRequest.queueSize }}
            </span>
          </header>
          <p id="permission-request-description" class="permission-request-description">
            {{ store.permissionRequest.description }}
          </p>
          <p v-if="store.permissionRequest.truncated" class="permission-request-warning">
            {{ t('permissionWarning') }}
          </p>
          <div class="permission-request-actions">
            <button
              type="button"
              class="permission-button deny"
              :disabled="store.permissionRequest.status !== 'pending'"
              @mousedown.stop
              @click.stop="decidePermission('deny')"
            >
              Deny
              <kbd v-if="store.permissionRequest.hotkeyEligible">Ctrl Shift N</kbd>
            </button>
            <button
              type="button"
              class="permission-button allow"
              :disabled="store.permissionRequest.status !== 'pending'"
              @mousedown.stop
              @click.stop="decidePermission('allow_once')"
            >
              {{ store.permissionRequest.status === 'deciding' ? t('sending') : 'Allow once' }}
              <kbd v-if="store.permissionRequest.hotkeyEligible">Ctrl Shift Y</kbd>
            </button>
          </div>
        </section>
      </Transition>

      <Transition v-else-if="bubbleSelection === 'permission-notice' && store.permissionBubbleActive && store.permissionNotice" name="toast" mode="out-in">
        <div
          key="permission"
          class="pet-toast permission-notice"
          role="status"
          aria-live="polite"
          data-pet-hit-target="solid"
        >
          <span class="permission-notice-icon" aria-hidden="true">!</span>
          <span class="permission-notice-copy">
            <strong>{{ store.permissionNotice.title }}</strong>
            <span>{{ store.permissionNotice.detail }}</span>
          </span>
        </div>
      </Transition>

      <Transition v-else-if="bubbleSelection === 'presentation-say' && store.presentationSay" name="toast" mode="out-in">
        <div
          key="presentation-say"
          class="pet-toast presentation-say"
          role="status"
          aria-live="polite"
          data-pet-hit-target="solid"
        >
          <span class="presentation-say-icon" aria-hidden="true">✦</span>
          <span>{{ store.presentationSay.message }}</span>
        </div>
      </Transition>

      <Transition v-else-if="bubbleSelection === 'agent-toast' || bubbleSelection === 'activity'" name="toast" mode="out-in">
        <div
          v-if="store.toast"
          :key="`toast-${store.toast.id}`"
          class="pet-toast timed-toast"
          :class="store.toast.tone"
          role="status"
          aria-live="polite"
          data-pet-hit-target="solid"
        >
          <span class="timed-toast-copy">{{ store.toast.text }}</span>
          <span
            class="toast-countdown-track"
            aria-hidden="true"
          >
            <span
              class="toast-countdown-fill"
              :style="{ '--toast-duration': `${store.toast.countdown.durationMs}ms` }"
            />
          </span>
          <span class="sr-only">{{ t('permissionCountdown') }}</span>
        </div>
        <div v-else-if="!isMultiPet && store.activityText" key="activity" class="pet-toast activity" data-pet-hit-target="solid">
          🔧 {{ store.activityText }}
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
            <button
              v-if="store.pluginFeedItem.panelViewAvailable"
              type="button"
              class="plugin-feed-open-panel"
              @mousedown.stop
              @click.stop="openPluginPanelFromFeed(store.pluginFeedItem.pluginId)"
            >
              {{ t('pluginOpenPanel') }}
            </button>
          </div>
          <button
            type="button"
            class="plugin-feed-close"
            :aria-label="t('close')"
            @mousedown.stop
            @click.stop="store.completePluginFeed(store.pluginFeedItem.id)"
          >
            ×
          </button>
        </article>
      </Transition>

      <template v-if="isMultiPet">
        <div class="multi-pet-row">
          <div v-for="line in store.familyLines" :key="line.key" ref="multiPetItemElements" class="multi-pet-item">
            <PetAnimation
              ref="multiPetRefs"
              :state="line.state"
              :pet-id="line.petId"
              :since="line.since"
              :mood="store.moodVisualsEnabled ? store.mood : undefined"
              :autonomous-behavior="shimejiBehavior"
              :freeze="petAnimationFrozen"
            />
            <div
              class="status-line multi-pet-status-line"
              :class="{
                'has-quota': store.quotaByFamily[line.key],
                'quota-motion': store.reactionsActive,
                'quota-critical': store.reactionsActive && (store.quotaByFamily[line.key]?.remainingPercent ?? 100) < 10,
                'quota-drain': store.reactionsActive && draining[line.key],
              }"
              :style="quotaLineStyle(line.key)"
              :aria-label="quotaTitle(line.key)"
              :tabindex="store.quotaByFamily[line.key] ? 0 : undefined"
              data-pet-hit-target="solid"
            >
              <span class="line-dot" :style="{ background: STATE_COLORS[line.state], color: STATE_COLORS[line.state] }" />
              <span class="line-text">
                <span class="line-label">{{ line.label }}<span v-if="line.variants.length" class="line-variants">&nbsp;({{ line.variants.join('+') }})</span></span>
                <span class="line-sep">·</span>{{ STATE_LABELS_SHORT[line.state] }}
              </span>
              <span v-if="pluginBadgesVisible" class="plugin-status-badges">
                <template v-for="badge in pluginBadgeSummary(line.petId).badges" :key="badge.pluginId">
                  <span class="plugin-badge-anchor" tabindex="0" :aria-label="pluginBadgeTooltip(badge)">
                    <span class="plugin-badge-pill" :class="`tone-${badge.tone}`">{{ badge.text }}</span>
                    <span class="plugin-badge-tooltip" role="tooltip">{{ pluginBadgeTooltip(badge) }}</span>
                  </span>
                </template>
                <span
                  v-if="pluginBadgeSummary(line.petId).hiddenCount > 0"
                  class="plugin-badge-pill plugin-badge-overflow"
                  :aria-label="t('pluginBadgeOverflow', { count: pluginBadgeSummary(line.petId).hiddenCount })"
                >+{{ pluginBadgeSummary(line.petId).hiddenCount }}</span>
              </span>
              <span v-if="store.quotaByFamily[line.key]" class="quota-readout">
                {{ quotaPercent(line.key) }}%
              </span>
              <span v-if="store.quotaByFamily[line.key]" class="quota-tooltip" role="tooltip">
                <span
                  v-for="quota in quotaDetails(line.key)"
                  :key="quota.id"
                  class="quota-tooltip-row"
                >
                  <span class="quota-tooltip-summary">
                    <strong>{{ quotaWindowLabel(quota.id, quota.label) }}</strong>
                    <strong class="quota-tooltip-percent">{{ t('percentRemaining', { value: quotaDetailPercent(quota.remainingPercent) }) }}</strong>
                  </span>
                  <span class="quota-tooltip-reset">{{ quotaResetLabel(quota.resetsAt) }}</span>
                </span>
              </span>
              <span
                v-if="store.quotaByFamily[line.key]"
                class="quota-meter"
                role="progressbar"
                :aria-label="t('quotaRemainingAria', { provider: line.label, quota: store.quotaByFamily[line.key].label })"
                aria-valuemin="0"
                aria-valuemax="100"
                :aria-valuenow="store.quotaByFamily[line.key].remainingPercent"
              >
                <span class="quota-meter-fill" :style="quotaFillStyle(line.key)" />
              </span>
            </div>
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
        />
        <TransitionGroup tag="div" name="status-line" class="status-lines">
          <div
            v-for="line in displayLines"
            :key="line.key"
            class="status-line"
            :class="{
              'has-quota': store.quotaByFamily[line.key],
              'quota-motion': store.reactionsActive,
              'quota-critical': store.reactionsActive && (store.quotaByFamily[line.key]?.remainingPercent ?? 100) < 10,
              'quota-drain': store.reactionsActive && draining[line.key],
            }"
            :style="quotaLineStyle(line.key)"
            :aria-label="quotaTitle(line.key)"
            :tabindex="store.quotaByFamily[line.key] ? 0 : undefined"
            data-pet-hit-target="solid"
          >
            <span class="line-dot" :style="{ background: STATE_COLORS[line.state], color: STATE_COLORS[line.state] }" />
            <span class="line-text">
              <template v-if="line.label">
                <span class="line-label">{{ line.label }}<span v-if="line.variants.length" class="line-variants">&nbsp;({{ line.variants.join('+') }})</span></span>
                <span class="line-sep">·</span>
              </template>{{ STATE_LABELS_SHORT[line.state] }}
            </span>
            <span v-if="pluginBadgesVisible" class="plugin-status-badges">
              <template v-for="badge in pluginBadgeSummary(line.petId).badges" :key="badge.pluginId">
                <span class="plugin-badge-anchor" tabindex="0" :aria-label="pluginBadgeTooltip(badge)">
                  <span class="plugin-badge-pill" :class="`tone-${badge.tone}`">{{ badge.text }}</span>
                  <span class="plugin-badge-tooltip" role="tooltip">{{ pluginBadgeTooltip(badge) }}</span>
                </span>
              </template>
              <span
                v-if="pluginBadgeSummary(line.petId).hiddenCount > 0"
                class="plugin-badge-pill plugin-badge-overflow"
                :aria-label="t('pluginBadgeOverflow', { count: pluginBadgeSummary(line.petId).hiddenCount })"
              >+{{ pluginBadgeSummary(line.petId).hiddenCount }}</span>
            </span>
            <span v-if="store.quotaByFamily[line.key]" class="quota-readout">
              {{ quotaPercent(line.key) }}%
            </span>
            <span v-if="store.quotaByFamily[line.key]" class="quota-tooltip" role="tooltip">
              <span
                v-for="quota in quotaDetails(line.key)"
                :key="quota.id"
                class="quota-tooltip-row"
              >
                <span class="quota-tooltip-summary">
                  <strong>{{ quotaWindowLabel(quota.id, quota.label) }}</strong>
                  <strong class="quota-tooltip-percent">{{ t('percentRemaining', { value: quotaDetailPercent(quota.remainingPercent) }) }}</strong>
                </span>
                <span class="quota-tooltip-reset">{{ quotaResetLabel(quota.resetsAt) }}</span>
              </span>
            </span>
            <span
              v-if="store.quotaByFamily[line.key]"
              class="quota-meter"
              role="progressbar"
              :aria-label="t('quotaRemainingAria', { provider: line.label, quota: store.quotaByFamily[line.key].label })"
              aria-valuemin="0"
              aria-valuemax="100"
              :aria-valuenow="store.quotaByFamily[line.key].remainingPercent"
            >
              <span class="quota-meter-fill" :style="quotaFillStyle(line.key)" />
            </span>
          </div>
        </TransitionGroup>
      </template>
      </template>
    </div>
  </div>
</template>

<style scoped src="@/components/DesktopPet.css"></style>
