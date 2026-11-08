import type { AppLocale } from '@/types/locale'
import type { DesktopVisibilityCapabilities } from '@/types/desktop-visibility'

export type LaunchAtStartupStatus =
  | 'enabled'
  | 'disabled'
  | 'requires-approval'
  | 'not-in-applications'
  | 'unsupported'
  | 'error'

export interface DesktopPreferences {
  dndEnabled: boolean
  /** Epoch ms when a timed DND ends; null means it lasts until turned off. */
  dndUntil: number | null
  notificationsEnabled: boolean
  permissionBubbleEnabled: boolean
  /** Answer Claude Code permission prompts from the pet (off by default). */
  claudePermissionRespondEnabled: boolean
  /** How long Claude Code's hook waits for a pet answer before leaving it to the terminal. */
  claudePermissionWaitSeconds: number
  presentationMcpEnabled: boolean
  achievementsEnabled: boolean
  edgeModeEnabled: boolean
  shimejiEnabled: boolean
  captureExclusionEnabled: boolean
  fullscreenAutoHideEnabled: boolean
  rightClickHideEnabled: boolean
  /** The "N ✓" badge next to the pet counting results that finished while you were away. */
  completionMarkersEnabled: boolean
  /** Per-session "open project folder" / "copy project path" actions. */
  sessionJumpEnabled: boolean
  /** Per-session "switch to app" (macOS only; brings the app forward, not a specific window). */
  sessionJumpSwitchAppEnabled: boolean
  soundEnabled: boolean
  /** 0-100 master volume for the pet's synthesized cues. */
  soundVolume: number
  soundOnPermission: boolean
  soundOnError: boolean
  soundOnSuccess: boolean
  launchAtStartup: boolean
  launchAtStartupSupported: boolean
  /** OS-reported login item state; `launchAtStartup` stays the user's intent. */
  launchAtStartupStatus: LaunchAtStartupStatus
  locale: AppLocale
  visibilityCapabilities: DesktopVisibilityCapabilities
}

export type DesktopPreferencesPatch = Partial<Pick<
  DesktopPreferences,
  'dndEnabled'
  | 'dndUntil'
  | 'notificationsEnabled'
  | 'permissionBubbleEnabled'
  | 'claudePermissionRespondEnabled'
  | 'claudePermissionWaitSeconds'
  | 'presentationMcpEnabled'
  | 'achievementsEnabled'
  | 'edgeModeEnabled'
  | 'shimejiEnabled'
  | 'captureExclusionEnabled'
  | 'fullscreenAutoHideEnabled'
  | 'rightClickHideEnabled'
  | 'completionMarkersEnabled'
  | 'sessionJumpEnabled'
  | 'sessionJumpSwitchAppEnabled'
  | 'soundEnabled'
  | 'soundVolume'
  | 'soundOnPermission'
  | 'soundOnError'
  | 'soundOnSuccess'
  | 'launchAtStartup'
  | 'locale'
>>
