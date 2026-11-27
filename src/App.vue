<script setup lang="ts">
import { defineAsyncComponent, onMounted, onUnmounted, ref, watch } from 'vue'
import { useAgentStore } from '@/stores/agentStore'
import DesktopPet from '@/components/DesktopPet.vue'
import GrowthCelebration from '@/components/growth/GrowthCelebration.vue'
import ToastHost from '@/components/ui/ToastHost.vue'
import type { SoundCue } from '@/types/sound'
import { playCue, setSoundVolume } from '@/utils/sound'
import { shouldPlayCue } from '@/utils/sound-policy'
import type { DesktopPreferences } from '@/types/desktop'
import type { AchievementSnapshot, AchievementUnlock } from '@/types/achievement'
import { setLocale as applyLocale } from '@/i18n'
import { STORAGE_KEYS } from '@/utils/storage-keys'
import { listenStorageSync, syncOn } from '@/utils/local-storage'
import { EDGE_HOVER_EXPAND_MS } from '@/utils/pet-edge'
import { HIT_DILATE_PX, decidePassthrough, hasOpaquePixel } from '@/utils/pet-hit-test'
import { PET_CELL_WIDTH } from '@/types/pet-atlas'

const StatusPanel = defineAsyncComponent(() => import('@/components/StatusPanel.vue'))
const SetupWizard = defineAsyncComponent(() => import('@/components/SetupWizard.vue'))
const ProjectMcpPanel = defineAsyncComponent(() => import('@/components/ProjectMcpPanel.vue'))

const store = useAgentStore()
const isPanelWindow = window.location.hash === '#panel'

const onboardingFirstRun = ref(false)

function closeWizard() {
  onboardingFirstRun.value = false
  store.closeSetupWizard()
}

async function maybeStartOnboarding(): Promise<boolean> {
  const api = window.electronAPI
  if (!api?.getOnboardingState) return false
  try {
    const state = await api.getOnboardingState()
    if (!state || state.completedAt !== undefined || state.skippedAt !== undefined) return false
    const status = await api.checkIntegration()
    if (status?.adapters.some(adapter => adapter.installable && adapter.installed)) {
      void api.updateOnboardingState('completed')
      return false
    }
    return true
  } catch {
    return false
  }
}

let cleanupListener: (() => void) | null = null
let cleanupPanelOpened: (() => void) | null = null
let cleanupPanelOpenSettings: (() => void) | null = null
let cleanupDesktopPreferences: (() => void) | null = null
let cleanupPetWindowMode: (() => void) | null = null
let cleanupProgression: (() => void) | null = null
let cleanupProgressionAwarded: (() => void) | null = null
let cleanupAchievements: (() => void) | null = null
let cleanupAchievementUnlock: (() => void) | null = null
let cleanupQuotaUpdated: (() => void) | null = null
let cleanupPermissionRequests: (() => void) | null = null
let cleanupPresentationIntent: (() => void) | null = null
let cleanupPluginFeedItem: (() => void) | null = null
let cleanupPluginFeedUnreadCount: (() => void) | null = null
let cleanupPluginSkinsChanged: (() => void) | null = null
let cleanupStorageSync: (() => void) | null = null
let staleTimer: ReturnType<typeof setInterval> | null = null
let successTimer: ReturnType<typeof setInterval> | null = null
let quotaTimer: ReturnType<typeof setInterval> | null = null
let quotaSettleTimer: ReturnType<typeof setTimeout> | null = null
let lastSettleRefreshAt = 0
let petMousePassthrough = false

function stopRecurringTimers(): void {
  if (staleTimer) clearInterval(staleTimer)
  if (successTimer) clearInterval(successTimer)
  if (quotaTimer) clearInterval(quotaTimer)
  if (quotaSettleTimer) clearTimeout(quotaSettleTimer)
  staleTimer = null
  successTimer = null
  quotaTimer = null
  quotaSettleTimer = null
}

function syncRecurringTimers(): void {
  if (document.hidden) {
    stopRecurringTimers()
    return
  }
  if (!staleTimer) {
    staleTimer = setInterval(() => store.cleanupStale(), 60_000)
  }
  if (!isPanelWindow && store.hasQuotaCapableSessions && !quotaTimer) {
    quotaTimer = setInterval(() => { void store.refreshQuota() }, store.quotaRefreshMs)
  }
  if (store.hasSuccessSessions && !successTimer) {
    successTimer = setInterval(() => store.handleSuccessTimeout(), 1_000)
  }
}

function onDocumentVisibilityChange(): void {
  if (document.hidden) {
    stopRecurringTimers()
    return
  }
  store.cleanupStale()
  store.handleSuccessTimeout()
  if (!isPanelWindow && store.hasQuotaCapableSessions) void store.refreshQuota()
  syncRecurringTimers()
}

// getImageData is a synchronous GPU->CPU readback; cache the verdict briefly while the cursor rests.
const HIT_CACHE_TTL_MS = 100
let hitCache: { canvas: HTMLCanvasElement, x: number, y: number, at: number, hit: boolean } | null = null

function isOpaqueCanvasPoint(canvas: HTMLCanvasElement, clientX: number, clientY: number): boolean {
  const rect = canvas.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return false

  const x = Math.floor((clientX - rect.left) * canvas.width / rect.width)
  const y = Math.floor((clientY - rect.top) * canvas.height / rect.height)
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return false

  const now = performance.now()
  if (hitCache && hitCache.canvas === canvas && hitCache.x === x && hitCache.y === y && now - hitCache.at < HIT_CACHE_TTL_MS) {
    return hitCache.hit
  }
  const hit = sampleOpaqueNeighbourhood(canvas, rect, x, y)
  hitCache = { canvas, x, y, at: now, hit }
  return hit
}

function sampleOpaqueNeighbourhood(canvas: HTMLCanvasElement, rect: DOMRect, x: number, y: number): boolean {
  try {
    // Sample a neighbourhood, not one pixel, so gaps between legs and arms do not make the pet ungrabbable.
    const radius = Math.max(1, Math.round(HIT_DILATE_PX * canvas.width / rect.width))
    const left = Math.max(0, x - radius)
    const top = Math.max(0, y - radius)
    const right = Math.min(canvas.width, x + radius + 1)
    const bottom = Math.min(canvas.height, y + radius + 1)
    const block = canvas.getContext('2d')?.getImageData(left, top, right - left, bottom - top).data
    return block ? hasOpaquePixel(block) : false
  } catch {
    // A custom file URL can make a canvas unreadable on some platforms; stay clickable.
    return true
  }
}

function isPetHitTarget(clientX: number, clientY: number): boolean {
  const target = document.elementFromPoint(clientX, clientY)
  if (!(target instanceof Element)) return false
  if (target.closest('[data-pet-hit-target="solid"]')) return true

  const canvas = target.closest('canvas.pet-canvas')
  return canvas instanceof HTMLCanvasElement && isOpaqueCanvasPoint(canvas, clientX, clientY)
}

let lastPointer: { x: number; y: number } | null = null
let lastPointerAt = 0
let passthroughSentAt = 0
let reevaluateFrame: number | null = null
let pointerFrame: number | null = null
let layoutObserver: ResizeObserver | null = null
let layoutMutationObserver: MutationObserver | null = null
const POINTER_FRESH_MS = 4_000

function sendPassthrough(ignore: boolean): void {
  const decision = decidePassthrough(ignore, petMousePassthrough, passthroughSentAt, performance.now())
  if (!decision.send) return
  petMousePassthrough = decision.next
  passthroughSentAt = performance.now()
  window.electronAPI?.setMousePassthrough(ignore)
}

function evaluatePointer(clientX: number, clientY: number): void {
  if (store.petWindowMode.mode === 'edge') {
    sendPassthrough(false)
    return
  }
  sendPassthrough(!store.isDragging && !isPetHitTarget(clientX, clientY))
}

function handlePetMouseMove(event: MouseEvent) {
  lastPointer = { x: event.clientX, y: event.clientY }
  lastPointerAt = performance.now()
  if (pointerFrame !== null) return
  pointerFrame = requestAnimationFrame(() => {
    pointerFrame = null
    if (lastPointer) evaluatePointer(lastPointer.x, lastPointer.y)
  })
}

// Expand only when the cursor lingers, so sweeping past does not pop the pet out.
let edgeHoverTimer: ReturnType<typeof setTimeout> | null = null

function cancelEdgeHover(): void {
  if (edgeHoverTimer) clearTimeout(edgeHoverTimer)
  edgeHoverTimer = null
}

function handleEdgeHoverEnter(): void {
  if (store.petWindowMode.mode !== 'edge' || edgeHoverTimer) return
  edgeHoverTimer = setTimeout(() => {
    edgeHoverTimer = null
    if (store.petWindowMode.mode === 'edge') window.electronAPI?.notifyPetHover()
  }, EDGE_HOVER_EXPAND_MS)
}

function scheduleReevaluate(): void {
  if (reevaluateFrame !== null || !lastPointer) return
  if (performance.now() - lastPointerAt > POINTER_FRESH_MS) return
  reevaluateFrame = requestAnimationFrame(() => {
    reevaluateFrame = null
    if (!lastPointer || store.petWindowMode.mode === 'edge') return
    evaluatePointer(lastPointer.x, lastPointer.y)
  })
}

// Mode changes make main reset mouse handling to "interactive".
watch(() => store.petWindowMode.mode, () => {
  petMousePassthrough = false
  passthroughSentAt = 0
  scheduleReevaluate()
})

function startLayoutWatch(): void {
  const root = document.querySelector('.app-container')
  if (!root) return
  layoutObserver = new ResizeObserver(scheduleReevaluate)
  layoutObserver.observe(root)
  layoutMutationObserver = new MutationObserver(scheduleReevaluate)
  layoutMutationObserver.observe(root, { childList: true, subtree: true })
}

function stopLayoutWatch(): void {
  layoutObserver?.disconnect()
  layoutMutationObserver?.disconnect()
  layoutObserver = null
  layoutMutationObserver = null
  if (reevaluateFrame !== null) cancelAnimationFrame(reevaluateFrame)
  reevaluateFrame = null
  if (pointerFrame !== null) cancelAnimationFrame(pointerFrame)
  pointerFrame = null
}

// 寵物、大小、心情與語言只在新值非空時才更新（key 被移除時不動）。
function listenPreferenceSync(): () => void {
  return listenStorageSync([
    syncOn(STORAGE_KEYS.petScale, (scale, raw) => { if (raw) store.petScale = scale }),
    syncOn(STORAGE_KEYS.petId, (petId, raw) => {
      if (!raw) return
      void store.loadPets().then(() => {
        store.selectedPet = petId
        void store.setProgressionPet(petId)
      })
    }),
    syncOn(STORAGE_KEYS.familyPetIds, map => store.syncFamilyPetIds(map)),
    syncOn(STORAGE_KEYS.sound, enabled => { store.soundEnabled = enabled }),
    syncOn(STORAGE_KEYS.multiPet, enabled => { store.multiPetEnabled = enabled }),
    syncOn(STORAGE_KEYS.reactions, enabled => { store.reactionsEnabled = enabled }),
    syncOn(STORAGE_KEYS.bubble, enabled => { store.bubbleEnabled = enabled }),
    syncOn(STORAGE_KEYS.ambient, enabled => { store.ambientEnabled = enabled }),
    syncOn(STORAGE_KEYS.activityBubble, enabled => { store.activityBubbleEnabled = enabled }),
    syncOn(STORAGE_KEYS.mood, (mood, raw) => { if (raw) store.mood = mood }),
    syncOn(STORAGE_KEYS.moodVisuals, enabled => { store.moodVisualsEnabled = enabled }),
    syncOn(STORAGE_KEYS.locale, (locale, raw) => { if (raw) applyLocale(locale) }),
  ])
}

function soundGate() {
  return {
    soundEnabled: store.soundEnabled,
    dndEnabled: store.dndEnabled,
    soundOnPermission: store.soundOnPermission,
    soundOnError: store.soundOnError,
    soundOnSuccess: store.soundOnSuccess,
    petVisible: document.visibilityState === 'visible',
  }
}

watch(() => store.soundVolume, setSoundVolume, { immediate: true })

// A broker request can arrive without a status event, so the permission cue also follows new requests.
watch(() => store.permissionRequests.map(request => request.requestId).join(','), (ids, previous) => {
  if (isPanelWindow || !store.desktopPreferencesReady || !ids) return
  const known = new Set((previous ?? '').split(','))
  if (ids.split(',').some(id => !known.has(id))) {
    playCueIfAllowed('waiting-permission')
  }
})

// Both windows process every event; only the pet window plays audio or it would sound twice.
function playCueIfAllowed(cue: SoundCue): void {
  if (!isPanelWindow && store.desktopPreferencesReady && shouldPlayCue(cue, soundGate())) {
    playCue(cue)
  }
}

onMounted(() => {
  store.setCueSink(playCueIfAllowed)
  document.documentElement.style.setProperty('--pet-scale', String(store.petScale))
  document.documentElement.style.setProperty('--pet-w', store.scaledW + 'px')
  document.documentElement.style.setProperty('--pet-cell-w', `${PET_CELL_WIDTH}px`)

  const electronAPI = window.electronAPI
  if (electronAPI?.onAgentStatusEvent) {
    cleanupListener = electronAPI.onAgentStatusEvent((event) => {
      const cue = store.handleEvent(event)
      if (cue) playCueIfAllowed(cue)
    })
  }
  void electronAPI?.getSessionSnapshot?.()
    .then((entries: unknown) => { store.restoreSessionSnapshot(entries) })
    .catch(() => {})
  if (electronAPI?.onPresentationIntent) {
    cleanupPresentationIntent = electronAPI.onPresentationIntent((intent: unknown) => {
      store.handlePresentationIntent(intent)
    })
  }
  if (electronAPI?.onPluginFeedItem) {
    cleanupPluginFeedItem = electronAPI.onPluginFeedItem((item: unknown) => {
      store.handlePluginFeedItem(item)
    })
  }
  if (electronAPI?.onPluginFeedUnreadCount) {
    cleanupPluginFeedUnreadCount = electronAPI.onPluginFeedUnreadCount((count: unknown) => {
      store.setPluginFeedUnreadCount(count)
    })
  }
  if (electronAPI?.onPluginSkinsChanged) {
    cleanupPluginSkinsChanged = electronAPI.onPluginSkinsChanged((removedPetIds: unknown) => {
      void store.handlePluginSkinsChanged(removedPetIds)
    })
  }
  if (electronAPI?.getPluginFeedUnreadCount) {
    void electronAPI.getPluginFeedUnreadCount()
      .then((count: unknown) => store.setPluginFeedUnreadCount(count))
      .catch(() => {})
  }
  if (electronAPI?.getOnboardingState) {
    void maybeStartOnboarding().then((needed) => {
      if (!needed) return
      if (isPanelWindow) {
        onboardingFirstRun.value = true
        store.openSetupWizard()
      } else {
        window.setTimeout(() => window.electronAPI?.togglePanel(), 1500)
      }
    })
  }
  if (isPanelWindow && electronAPI?.onPanelOpened) {
    cleanupPanelOpened = electronAPI.onPanelOpened((options: { restore: boolean }) => {
      store.handlePanelOpened(options)
    })
  }
  if (isPanelWindow && electronAPI?.onPanelOpenSettings) {
    cleanupPanelOpenSettings = electronAPI.onPanelOpenSettings(() => {
      store.openSettings()
    })
  }
  if (electronAPI?.onDesktopPreferencesUpdated) {
    cleanupDesktopPreferences = electronAPI.onDesktopPreferencesUpdated((preferences: DesktopPreferences) => {
      store.applyDesktopPreferences(preferences)
    })
  }
  if (electronAPI?.onPetWindowModeUpdated) {
    cleanupPetWindowMode = electronAPI.onPetWindowModeUpdated((state: unknown) => {
      store.setPetWindowModeState(state)
    })
  }
  if (electronAPI?.onProgressionUpdated) {
    cleanupProgression = electronAPI.onProgressionUpdated((snapshot: unknown) => {
      store.setProgressionSnapshot(snapshot)
    })
  }
  if (electronAPI?.onProgressionAwarded) {
    cleanupProgressionAwarded = electronAPI.onProgressionAwarded((event: unknown) => {
      store.handleProgressionAwarded(event)
    })
  }
  if (electronAPI?.onAchievementsUpdated) {
    cleanupAchievements = electronAPI.onAchievementsUpdated((snapshot: AchievementSnapshot) => {
      store.setAchievementsSnapshot(snapshot)
    })
  }
  if (electronAPI?.onAchievementUnlocked) {
    cleanupAchievementUnlock = electronAPI.onAchievementUnlocked((unlock: AchievementUnlock) => {
      store.handleAchievementUnlocked(unlock)
    })
  }
  if (electronAPI?.onPermissionRequestsUpdated) {
    cleanupPermissionRequests = electronAPI.onPermissionRequestsUpdated((requests: unknown) => {
      store.setPermissionRequests(requests)
    })
  }
  void store.initializePermissionRequests()
  void store.initializeDesktopPreferences()
  void store.initializePetWindowMode()
  void store.initializeProgression()
  void store.initializeAchievements()
  if (electronAPI?.onQuotaUsageUpdated) {
    cleanupQuotaUpdated = electronAPI.onQuotaUsageUpdated((usage: unknown) => {
      store.setQuotaUsage(usage)
    })
  }
  if (!isPanelWindow && electronAPI?.setMousePassthrough) {
    window.addEventListener('mousemove', handlePetMouseMove, true)
    startLayoutWatch()
    document.documentElement.addEventListener('mouseenter', handleEdgeHoverEnter)
    document.documentElement.addEventListener('mouseleave', cancelEdgeHover)
  }

  cleanupStorageSync = listenPreferenceSync()

  document.addEventListener('visibilitychange', onDocumentVisibilityChange)
  syncRecurringTimers()
})

watch(() => store.petScale, (v) => {
  document.documentElement.style.setProperty('--pet-scale', String(v))
})

// Only the pet renderer publishes (the panel must not become a second source of truth);
// the getter returns a fresh object per heartbeat, so compare a content signature before IPC.
if (!isPanelWindow) {
  let lastPresentationKey = ''
  watch(
    () => {
      const snapshot = store.getPresentationStatus()
      return { snapshot, key: JSON.stringify(snapshot) }
    },
    ({ snapshot, key }) => {
      if (key === lastPresentationKey) return
      lastPresentationKey = key
      window.electronAPI?.publishPresentationStatus(snapshot)
    },
    { immediate: true },
  )
}

watch(() => store.hasQuotaCapableSessions, (active) => {
  if (quotaTimer) {
    clearInterval(quotaTimer)
    quotaTimer = null
  }
  if (!active || isPanelWindow) return
  void store.refreshQuota()
  syncRecurringTimers()
}, { immediate: true })

// Forced to bypass the renderer throttle; main's force cooldown still collapses a burst into one request.
watch(() => store.quotaStaleSignal, () => {
  if (isPanelWindow || document.hidden || quotaSettleTimer) return
  const sinceLast = Date.now() - lastSettleRefreshAt
  const delay = Math.max(
    store.quotaSettleDelayMs,
    store.quotaSettleMinIntervalMs - sinceLast,
  )
  quotaSettleTimer = setTimeout(() => {
    quotaSettleTimer = null
    if (!store.hasQuotaCapableSessions) return
    lastSettleRefreshAt = Date.now()
    void store.refreshQuota(true)
  }, delay)
})

watch(() => store.scaledW, (w) => {
  document.documentElement.style.setProperty('--pet-w', w + 'px')
})

watch(() => store.hasSuccessSessions, (active) => {
  if (!active && successTimer) {
    clearInterval(successTimer)
    successTimer = null
  }
  syncRecurringTimers()
}, { immediate: true })

onUnmounted(() => {
  store.setCueSink(null)
  cleanupListener?.()
  cleanupPanelOpened?.()
  cleanupPanelOpenSettings?.()
  cleanupDesktopPreferences?.()
  cleanupPetWindowMode?.()
  cleanupProgression?.()
  cleanupProgressionAwarded?.()
  cleanupAchievements?.()
  cleanupAchievementUnlock?.()
  cleanupQuotaUpdated?.()
  cleanupPermissionRequests?.()
  cleanupPresentationIntent?.()
  cleanupPluginFeedItem?.()
  cleanupPluginFeedUnreadCount?.()
  cleanupPluginSkinsChanged?.()
  window.removeEventListener('mousemove', handlePetMouseMove, true)
  stopLayoutWatch()
  cancelEdgeHover()
  document.documentElement.removeEventListener('mouseenter', handleEdgeHoverEnter)
  document.documentElement.removeEventListener('mouseleave', cancelEdgeHover)
  cleanupStorageSync?.()
  cleanupStorageSync = null
  document.removeEventListener('visibilitychange', onDocumentVisibilityChange)
  stopRecurringTimers()
})
</script>

<template>
  <div class="app-container">
    <template v-if="isPanelWindow">
      <StatusPanel />
      <Transition name="wizard">
        <SetupWizard v-if="store.showWizard" :first-run="onboardingFirstRun" @close="closeWizard" />
      </Transition>
      <Transition name="wizard">
        <ProjectMcpPanel v-if="store.showProjectMcpPanel" @close="store.closeProjectMcpPanel()" />
      </Transition>
    </template>
    <template v-else>
      <DesktopPet />
      <GrowthCelebration />
    </template>
    <ToastHost />
  </div>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

/* Avoid standard scrollbar properties: Chromium on Windows then falls back to the native track and arrow buttons. */
*::-webkit-scrollbar {
  width: 6px;
  height: 6px;
  background: transparent;
}

*::-webkit-scrollbar-track,
*::-webkit-scrollbar-corner {
  background: transparent;
}

*::-webkit-scrollbar-thumb {
  min-height: 28px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: var(--scrollbar-thumb);
  background-clip: padding-box;
}

*::-webkit-scrollbar-thumb:hover {
  background: var(--scrollbar-thumb-hover);
  background-clip: padding-box;
}

*::-webkit-scrollbar-button {
  -webkit-appearance: none;
  display: none;
  width: 0;
  height: 0;
  background: transparent;
}

html, body, #app {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: transparent;
  user-select: none;
  -webkit-app-region: no-drag;
}

.app-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
}

.wizard-enter-active,
.wizard-leave-active {
  transition: all var(--transition-base);
}

.wizard-enter-from,
.wizard-leave-to {
  opacity: 0;
  transform: translateY(10px);
}
</style>
