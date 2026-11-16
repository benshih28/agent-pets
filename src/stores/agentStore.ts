import { defineStore } from 'pinia'
import { reactive, ref } from 'vue'
import type { AgentSession } from '@/types/agent'
import { AGENT_FAMILY_REGISTRY, isAgentFamilyKey } from '@/types/agent'
import type { PetWindowMode, PetWindowModeState } from '@/types/pet-window'
import { normalizePetWindowModeState } from '@/types/pet-window'
import type { PresentationStatusUpdate } from '@/types/presentation'
import { DEFAULT_PET_ID } from '@/utils/storage-keys'
import { useDesktopPreferences } from '@/stores/agent/desktop-preferences'
import { moodLabel, usePetMood } from '@/stores/agent/mood'
import { usePanelNavigation } from '@/stores/agent/panel-navigation'
import { usePermissionUi } from '@/stores/agent/permission-ui'
import { usePetDisplayPreferences } from '@/stores/agent/pet-display-preferences'
import { usePets } from '@/stores/agent/pets'
import { usePluginFeed } from '@/stores/agent/plugin-feed'
import { usePresentationQueue } from '@/stores/agent/presentation'
import { useProgression } from '@/stores/agent/progression'
import { useProjectPets } from '@/stores/agent/project-pets'
import { QUOTA_REFRESH_MS, QUOTA_SETTLE_DELAY_MS, QUOTA_SETTLE_MIN_INTERVAL_MS, useQuota } from '@/stores/agent/quota'
import { useSessionViews } from '@/stores/agent/session-views'
import { useSessions } from '@/stores/agent/sessions'
import { useToastQueue } from '@/stores/agent/toast'
import { useUnreadAlerts } from '@/stores/agent/unread-alerts'

export type { PetEntry } from '@/stores/agent/pets'

// 這個檔只負責組裝：每個領域的事件輸入、計時器、storage 與跨視窗同步寫在 src/stores/agent/ 各模組的檔頭，
// 計時器都在 store 的 effect scope 結束時清掉。模組之間的依賴以參數注入，晚建立的以函式延後解析（只在呼叫時才讀）。
// 對元件的成員名稱與型別由 tests/agent-store-characterization.test.mts 固定。
export const useAgentStore = defineStore('agent', () => {
  // 不能是 shallowRef／不能換成別的結構：sessions 模組與 computed 都直接讀寫這個 reactive Map。
  const sessionsByKey = reactive(new Map<string, AgentSession>())

  const toastQueue = useToastQueue()
  const { showToast } = toastQueue
  const pluginFeed = usePluginFeed()
  const petMood = usePetMood()
  const { mood } = petMood
  const displayPreferences = usePetDisplayPreferences()
  const panelNavigation = usePanelNavigation()

  const pets = usePets({
    onPetSelected: (petId) => { void progressionModule.setProgressionPet(petId) },
    refreshProjectPets: () => projectPetModule.refreshProjectPets(),
    routedPetId: () => views.highestPrioritySession.value?.routedPetId,
  })
  const progressionModule = useProgression(pets.selectedPet)
  const projectPetModule = useProjectPets()
  const quota = useQuota()
  const unreadAlerts = useUnreadAlerts({
    sessionByKey: (key) => sessionsByKey.get(key),
    showToast,
    completionMarkersEnabled: () => prefs.completionMarkersEnabled.value,
  })
  const prefs = useDesktopPreferences({
    reactionsEnabled: displayPreferences.reactionsEnabled,
    bubbleEnabled: displayPreferences.bubbleEnabled,
    ambientEnabled: displayPreferences.ambientEnabled,
    activityBubbleEnabled: displayPreferences.activityBubbleEnabled,
    clearUnreadResults: () => unreadAlerts.clearUnreadResults(),
    clearPresentation: () => presentation.clearPresentation(),
    clearMcpPresentation: () => presentation.clearMcpPresentation(),
  })
  const views = useSessionViews({
    sessionsByKey,
    selectedPet: pets.selectedPet,
    petsById: pets.petsById,
    multiPetEnabled: displayPreferences.multiPetEnabled,
    petScale: displayPreferences.petScale,
    getPetForFamily: pets.getPetForFamily,
  })
  const presentation = usePresentationQueue({
    ready: () => prefs.desktopPreferencesReady.value,
    mcpEnabled: () => prefs.presentationMcpEnabled.value,
    dnd: () => prefs.dndEnabled.value,
    currentState: () => views.currentState.value,
    visiblePetIds: () => [views.activePetId.value, ...views.familyLines.value.map(line => line.petId)],
  })
  const sessionModule = useSessions({
    sessionsByKey,
    petMood,
    showToast,
    unreadAlerts,
    clearPresentation: () => presentation.clearPresentation(),
    markQuotaStale: () => { quota.quotaStaleSignal.value += 1 },
    forgetDismissedNotice: views.forgetDismissedNotice,
    hasPendingPermission: () => permissionUi.permissionRequests.value.length > 0,
  })
  const permissionUi = usePermissionUi(sessionModule.settleWaitingPermission)

  // --- 寵物視窗模式與拖曳 -------------------------------------------------------

  const isDragging = ref(false)
  const petWindowMode = ref<PetWindowModeState>({ mode: 'normal' })

  function setPetWindowModeState(value: unknown): void {
    petWindowMode.value = normalizePetWindowModeState(value)
  }

  async function setPetMode(mode: PetWindowMode): Promise<void> {
    try {
      const state = await window.electronAPI?.setPetWindowMode(mode)
      if (state) setPetWindowModeState(state)
    } catch {
      // Main remains authoritative; the next mode broadcast restores state.
    }
  }

  async function initializePetWindowMode(): Promise<void> {
    try {
      const state = await window.electronAPI?.initializePetWindowMode()
      if (state) setPetWindowModeState(state)
    } catch {
      petWindowMode.value = { mode: 'normal' }
    }
  }

  function getPresentationStatus(): PresentationStatusUpdate {
    const { familyLines } = views
    const lines = familyLines.value.length > 0
      ? familyLines.value
      : [{ key: '', petId: views.activePetId.value, state: views.currentState.value }]
    const activePets = lines.slice(0, 16).map(line => ({
      petId: line.petId,
      name: pets.petsById.value.get(line.petId)?.displayName ?? line.petId,
      agentFamily: isAgentFamilyKey(line.key) ? AGENT_FAMILY_REGISTRY[line.key].adapterId : null,
      mood: moodLabel(mood.value),
      level: progressionModule.progression.value?.level ?? 1,
      visibleState: line.state,
    }))
    return {
      activePets,
      dnd: prefs.dndEnabled.value,
      enabled: prefs.presentationMcpEnabled.value,
    }
  }

  return {
    // 全部成員都對外的領域模組
    ...displayPreferences,
    ...panelNavigation,
    ...pluginFeed,
    ...permissionUi,
    ...prefs,
    ...progressionModule,
    ...projectPetModule,
    ...quota,
    // 只有部分成員對外的領域模組（其餘是給 handleEvent 等內部流程用的）
    toast: toastQueue.toast,
    toastRemainingMs: toastQueue.toastRemainingMs,
    toastPaused: toastQueue.toastPaused,
    pauseToast: toastQueue.pauseToast,
    resumeToast: toastQueue.resumeToast,
    dismissToast: toastQueue.dismissToast,
    mood,
    moodVisualsEnabled: petMood.moodVisualsEnabled,
    resetMood: petMood.resetMood,
    setMoodVisualsEnabled: petMood.setMoodVisualsEnabled,
    patPet: petMood.patPet,
    presentationSay: presentation.presentationSay,
    presentationReaction: presentation.presentationReaction,
    handlePresentationIntent: presentation.handlePresentationIntent,
    clearPresentation: presentation.clearPresentation,
    selectedPet: pets.selectedPet,
    pets: pets.pets,
    visiblePets: pets.visiblePets,
    familyPetIds: pets.familyPetIds,
    petsLoaded: pets.petsLoaded,
    setPet: pets.setPet,
    setFamilyPet: pets.setFamilyPet,
    syncFamilyPetIds: pets.syncFamilyPetIds,
    getPetForFamily: pets.getPetForFamily,
    loadPets: pets.loadPets,
    renamePet: pets.renamePet,
    removePet: pets.removePet,
    handlePluginSkinsChanged: pets.handlePluginSkinsChanged,
    unreadResults: unreadAlerts.unreadResults,
    markPetInteraction: unreadAlerts.markPetInteraction,
    clearUnreadResults: unreadAlerts.clearUnreadResults,
    setCueSink: unreadAlerts.setCueSink,
    sessions: views.sessions,
    sessionList: views.sessionList,
    activeSessions: views.activeSessions,
    hasQuotaCapableSessions: views.hasQuotaCapableSessions,
    hasSuccessSessions: views.hasSuccessSessions,
    familyLines: views.familyLines,
    isMultiPet: views.isMultiPet,
    scaledW: views.scaledW,
    scaledH: views.scaledH,
    highestPrioritySession: views.highestPrioritySession,
    currentState: views.currentState,
    currentSource: views.currentSource,
    currentFamilyKey: views.currentFamilyKey,
    activePetId: views.activePetId,
    activityText: views.activityText,
    permissionNotice: views.permissionNotice,
    dismissPermissionNotice: views.dismissPermissionNotice,
    resizePetWindow: views.resizePetWindow,
    handleEvent: sessionModule.handleEvent,
    cleanupStale: sessionModule.cleanupStale,
    restoreSessionSnapshot: sessionModule.restoreSessionSnapshot,
    handleSuccessTimeout: sessionModule.handleSuccessTimeout,
    removeSession: sessionModule.removeSession,
    clearOfflineSessions: sessionModule.clearOfflineSessions,
    sessionByKey: sessionModule.sessionByKey,
    runSessionJump: sessionModule.runSessionJump,
    // 仍在本檔
    isDragging,
    petWindowMode,
    setPetWindowModeState,
    setPetMode,
    initializePetWindowMode,
    getPresentationStatus,
    quotaRefreshMs: QUOTA_REFRESH_MS,
    quotaSettleDelayMs: QUOTA_SETTLE_DELAY_MS,
    quotaSettleMinIntervalMs: QUOTA_SETTLE_MIN_INTERVAL_MS,
    defaultPetId: DEFAULT_PET_ID,
  }
})
