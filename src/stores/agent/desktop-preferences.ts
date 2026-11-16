// 桌面偏好設定：主程序是唯一的真相（Tray 與兩個視窗才會一致），renderer 保存鏡像並在改動時送 patch。
//
// - 事件輸入：App.vue 啟動時 `initializeDesktopPreferences()`，主程序的廣播進 `applyDesktopPreferences()`；
//   設定面板與 Tray 的選項經各個 `setXxx()` 先樂觀更新再送 `updateDesktopPreferences(patch)`，失敗就重新初始化。
// - 計時器：無。
// - storage：`STORAGE_KEYS.sound` 只當主程序偏好送達前的聲音開關快取（啟動時當初值傳給主程序，之後以主程序為準）。
// - 跨視窗同步：主程序廣播的偏好設定由每個視窗各自 `applyDesktopPreferences()`；不走 storage 事件。
import { computed, ref, type Ref } from 'vue'
import { setLocale as applyLocale } from '@/i18n'
import type { AgentSession } from '@/types/agent'
import type { DesktopPreferences, DesktopPreferencesPatch, LaunchAtStartupStatus } from '@/types/desktop'
import type { DesktopVisibilityCapabilities } from '@/types/desktop-visibility'
import type { AppLocale } from '@/types/locale'
import { CLAUDE_PERMISSION_WAIT_DEFAULT_SECONDS } from '@/types/permission'
import { SOUND_DEFAULTS } from '@/types/sound'
import { isDesktopEffectActive } from '@/utils/desktop-effects'
import { readStored, writeStored } from '@/utils/local-storage'
import { STORAGE_KEYS } from '@/utils/storage-keys'

export interface DesktopPreferencesDeps {
  /** 寵物顯示偏好（localStorage）；與 DND／就緒狀態合成實際生效的 `xxxActive`。 */
  reactionsEnabled: Ref<boolean>
  bubbleEnabled: Ref<boolean>
  ambientEnabled: Ref<boolean>
  activityBubbleEnabled: Ref<boolean>
  /** 以下三個模組在偏好設定之後才建立，用函式延後到呼叫時才解析。 */
  clearUnreadResults: () => void
  clearPresentation: () => void
  clearMcpPresentation: () => void
}

export function useDesktopPreferences(deps: DesktopPreferencesDeps) {
  const { reactionsEnabled, bubbleEnabled, ambientEnabled, activityBubbleEnabled } = deps

  // 主程序的偏好設定送到之前先用 localStorage 快取；只有 '1' 算開，沒有快取時跟 SOUND_DEFAULTS.soundEnabled 一樣是關。
  const soundEnabled = ref(readStored(STORAGE_KEYS.sound))
  const soundVolume = ref(SOUND_DEFAULTS.soundVolume)
  const soundOnPermission = ref(SOUND_DEFAULTS.soundOnPermission)
  const soundOnError = ref(SOUND_DEFAULTS.soundOnError)
  const soundOnSuccess = ref(SOUND_DEFAULTS.soundOnSuccess)

  // Desktop-wide preferences are owned by the Electron main process so the
  // Tray and both renderer windows always agree. Sound is initialized from
  // the legacy localStorage value once, preserving existing user choice.
  const dndEnabled = ref(false)
  const notificationsEnabled = ref(true)
  const permissionBubbleEnabled = ref(true)
  const claudePermissionRespondEnabled = ref(false)
  const claudePermissionWaitSeconds = ref(CLAUDE_PERMISSION_WAIT_DEFAULT_SECONDS)
  const presentationMcpEnabled = ref(true)
  const achievementsEnabled = ref(true)
  const edgeModeEnabled = ref(false)
  const shimejiEnabled = ref(false)
  const captureExclusionEnabled = ref(false)
  const fullscreenAutoHideEnabled = ref(false)
  const rightClickHideEnabled = ref(false)
  const completionMarkersEnabled = ref(true)
  const sessionJumpEnabled = ref(true)
  const sessionJumpSwitchAppEnabled = ref(true)
  const desktopVisibilityCapabilities = ref<DesktopVisibilityCapabilities>({
    captureExclusion: { supported: false, mode: 'unsupported' },
    fullscreenAutoHide: { supported: false, mode: 'unsupported' },
  })
  const launchAtStartup = ref(false)
  const launchAtStartupSupported = ref(false)
  const launchAtStartupStatus = ref<LaunchAtStartupStatus>('unsupported')
  const desktopPreferencesReady = ref(false)
  const reactionsActive = computed(() => isDesktopEffectActive(
    desktopPreferencesReady.value,
    dndEnabled.value,
    reactionsEnabled.value,
  ))
  const bubbleActive = computed(() => isDesktopEffectActive(
    desktopPreferencesReady.value,
    dndEnabled.value,
    bubbleEnabled.value,
  ))
  const ambientActive = computed(() => isDesktopEffectActive(
    desktopPreferencesReady.value,
    dndEnabled.value,
    ambientEnabled.value,
  ))
  const activityBubbleActive = computed(() => bubbleActive.value && activityBubbleEnabled.value)
  // Presentation-only preference; it never changes Broker or adapter state.
  const permissionBubbleActive = computed(() => (
    desktopPreferencesReady.value && permissionBubbleEnabled.value
  ))

  function setSoundEnabled(enabled: boolean) {
    soundEnabled.value = enabled
    writeStored(STORAGE_KEYS.sound, enabled)
    updateDesktopPreferences({ soundEnabled: enabled })
  }

  function setSoundOption(patch: Pick<DesktopPreferencesPatch, 'soundVolume' | 'soundOnPermission' | 'soundOnError' | 'soundOnSuccess'>) {
    updateDesktopPreferences(patch)
  }

  // --- 桌面偏好設定（同步自 Electron 主行程） -------------------------------

  function applyDesktopPreferences(preferences: DesktopPreferences) {
    applyLocale(preferences.locale)
    dndEnabled.value = preferences.dndEnabled
    notificationsEnabled.value = preferences.notificationsEnabled
    permissionBubbleEnabled.value = preferences.permissionBubbleEnabled
    claudePermissionRespondEnabled.value = preferences.claudePermissionRespondEnabled
    claudePermissionWaitSeconds.value = preferences.claudePermissionWaitSeconds
    presentationMcpEnabled.value = preferences.presentationMcpEnabled
    achievementsEnabled.value = preferences.achievementsEnabled
    edgeModeEnabled.value = preferences.edgeModeEnabled
    shimejiEnabled.value = preferences.shimejiEnabled
    captureExclusionEnabled.value = preferences.captureExclusionEnabled
    fullscreenAutoHideEnabled.value = preferences.fullscreenAutoHideEnabled
    rightClickHideEnabled.value = preferences.rightClickHideEnabled
    completionMarkersEnabled.value = preferences.completionMarkersEnabled !== false
    if (!completionMarkersEnabled.value) deps.clearUnreadResults()
    sessionJumpEnabled.value = preferences.sessionJumpEnabled !== false
    sessionJumpSwitchAppEnabled.value = preferences.sessionJumpSwitchAppEnabled !== false
    desktopVisibilityCapabilities.value = preferences.visibilityCapabilities
    soundEnabled.value = preferences.soundEnabled
    soundVolume.value = preferences.soundVolume
    soundOnPermission.value = preferences.soundOnPermission
    soundOnError.value = preferences.soundOnError
    soundOnSuccess.value = preferences.soundOnSuccess
    launchAtStartup.value = preferences.launchAtStartup
    launchAtStartupSupported.value = preferences.launchAtStartupSupported
    launchAtStartupStatus.value = preferences.launchAtStartupStatus ?? 'unsupported'
    desktopPreferencesReady.value = true
    writeStored(STORAGE_KEYS.sound, preferences.soundEnabled)
    if (preferences.dndEnabled) deps.clearPresentation()
    else if (!preferences.presentationMcpEnabled) deps.clearMcpPresentation()
  }

  async function initializeDesktopPreferences() {
    if (!window.electronAPI?.initializeDesktopPreferences) {
      desktopPreferencesReady.value = true
      return
    }
    try {
      applyDesktopPreferences(
        await window.electronAPI.initializeDesktopPreferences(soundEnabled.value),
      )
    } catch {
      console.error('Failed to initialize desktop preferences')
    }
  }

  function updateDesktopPreferences(patch: DesktopPreferencesPatch) {
    if (!window.electronAPI?.setDesktopPreferences) return
    void window.electronAPI.setDesktopPreferences(patch)
      .then(applyDesktopPreferences)
      .catch(() => {
        console.error('Failed to update desktop preferences')
        void initializeDesktopPreferences()
      })
  }

  function setDndEnabled(enabled: boolean) {
    dndEnabled.value = enabled
    updateDesktopPreferences({ dndEnabled: enabled })
  }

  function setNotificationsEnabled(enabled: boolean) {
    notificationsEnabled.value = enabled
    updateDesktopPreferences({ notificationsEnabled: enabled })
  }

  function setPermissionBubbleEnabled(enabled: boolean) {
    permissionBubbleEnabled.value = enabled
    updateDesktopPreferences({ permissionBubbleEnabled: enabled })
  }

  function setClaudePermissionRespondEnabled(enabled: boolean) {
    claudePermissionRespondEnabled.value = enabled
    updateDesktopPreferences({ claudePermissionRespondEnabled: enabled })
  }

  function setClaudePermissionWaitSeconds(seconds: number) {
    claudePermissionWaitSeconds.value = seconds
    updateDesktopPreferences({ claudePermissionWaitSeconds: seconds })
  }

  function setPresentationMcpEnabled(enabled: boolean) {
    presentationMcpEnabled.value = enabled
    if (!enabled) deps.clearMcpPresentation()
    updateDesktopPreferences({ presentationMcpEnabled: enabled })
  }

  function setAchievementsEnabled(enabled: boolean) {
    achievementsEnabled.value = enabled
    updateDesktopPreferences({ achievementsEnabled: enabled })
  }

  function setEdgeModeEnabled(enabled: boolean) {
    edgeModeEnabled.value = enabled
    updateDesktopPreferences({ edgeModeEnabled: enabled })
  }

  function setShimejiEnabled(enabled: boolean) {
    shimejiEnabled.value = enabled
    updateDesktopPreferences({ shimejiEnabled: enabled })
  }

  function setCaptureExclusionEnabled(enabled: boolean) {
    if (!desktopVisibilityCapabilities.value.captureExclusion.supported) return
    captureExclusionEnabled.value = enabled
    updateDesktopPreferences({ captureExclusionEnabled: enabled })
  }

  function setFullscreenAutoHideEnabled(enabled: boolean) {
    if (!desktopVisibilityCapabilities.value.fullscreenAutoHide.supported) return
    fullscreenAutoHideEnabled.value = enabled
    updateDesktopPreferences({ fullscreenAutoHideEnabled: enabled })
  }

  function setRightClickHideEnabled(enabled: boolean) {
    rightClickHideEnabled.value = enabled
    updateDesktopPreferences({ rightClickHideEnabled: enabled })
  }

  function setCompletionMarkersEnabled(enabled: boolean) {
    completionMarkersEnabled.value = enabled
    if (!enabled) deps.clearUnreadResults()
    updateDesktopPreferences({ completionMarkersEnabled: enabled })
  }

  function setSessionJumpEnabled(enabled: boolean) {
    sessionJumpEnabled.value = enabled
    updateDesktopPreferences({ sessionJumpEnabled: enabled })
  }

  function setSessionJumpSwitchAppEnabled(enabled: boolean) {
    sessionJumpSwitchAppEnabled.value = enabled
    updateDesktopPreferences({ sessionJumpSwitchAppEnabled: enabled })
  }

  // "Switch to app" is offered only when main said this session's app can be activated
  // (macOS, allowlisted app, not an explicit generic-http event) and the user has it turned on.
  function canSwitchToSessionApp(session: Pick<AgentSession, 'host'> | undefined): boolean {
    return Boolean(sessionJumpEnabled.value && sessionJumpSwitchAppEnabled.value && session?.host?.switchable)
  }

  function setLocalePreference(next: AppLocale) {
    const applied = applyLocale(next)
    updateDesktopPreferences({ locale: applied })
  }

  function setLaunchAtStartup(enabled: boolean) {
    if (!launchAtStartupSupported.value) return
    launchAtStartup.value = enabled
    updateDesktopPreferences({ launchAtStartup: enabled })
  }

  function openLoginItemsSettings() {
    void window.electronAPI?.openLoginItemsSettings?.().catch(() => {})
  }

  return {
    soundEnabled,
    soundVolume,
    soundOnPermission,
    soundOnError,
    soundOnSuccess,
    dndEnabled,
    notificationsEnabled,
    permissionBubbleEnabled,
    claudePermissionRespondEnabled,
    claudePermissionWaitSeconds,
    presentationMcpEnabled,
    achievementsEnabled,
    edgeModeEnabled,
    shimejiEnabled,
    captureExclusionEnabled,
    fullscreenAutoHideEnabled,
    rightClickHideEnabled,
    completionMarkersEnabled,
    sessionJumpEnabled,
    sessionJumpSwitchAppEnabled,
    desktopVisibilityCapabilities,
    launchAtStartup,
    launchAtStartupSupported,
    launchAtStartupStatus,
    desktopPreferencesReady,
    reactionsActive,
    bubbleActive,
    ambientActive,
    activityBubbleActive,
    permissionBubbleActive,
    setSoundEnabled,
    setSoundOption,
    applyDesktopPreferences,
    initializeDesktopPreferences,
    setDndEnabled,
    setNotificationsEnabled,
    setPermissionBubbleEnabled,
    setClaudePermissionRespondEnabled,
    setClaudePermissionWaitSeconds,
    setPresentationMcpEnabled,
    setAchievementsEnabled,
    setEdgeModeEnabled,
    setShimejiEnabled,
    setCaptureExclusionEnabled,
    setFullscreenAutoHideEnabled,
    setRightClickHideEnabled,
    setCompletionMarkersEnabled,
    setSessionJumpEnabled,
    setSessionJumpSwitchAppEnabled,
    canSwitchToSessionApp,
    setLocalePreference,
    setLaunchAtStartup,
    openLoginItemsSettings,
  }
}
