import type { DesktopVisibilityCapabilities } from '../src/types/desktop-visibility.ts'
import { UNSUPPORTED_DESKTOP_VISIBILITY_CAPABILITIES } from '../src/types/desktop-visibility.ts'

// macOS sharing exclusion is best-effort (newer ScreenCaptureKit clients may ignore it); Linux is not advertised until it has a tested equivalent.
export function desktopVisibilityCapabilitiesForPlatform(
  platform: NodeJS.Platform,
  contentProtectionAvailable: boolean,
  windowsFullscreenDetectorAvailable = false,
): DesktopVisibilityCapabilities {
  const capture = platform === 'win32' && contentProtectionAvailable
    ? { supported: true, mode: 'system' as const }
    : platform === 'darwin' && contentProtectionAvailable
      ? { supported: true, mode: 'limited' as const }
      : { ...UNSUPPORTED_DESKTOP_VISIBILITY_CAPABILITIES.captureExclusion }

  return {
    captureExclusion: capture,
    fullscreenAutoHide: platform === 'darwin'
      ? { supported: true, mode: 'macos-native' }
      : platform === 'win32' && windowsFullscreenDetectorAvailable
        ? { supported: true, mode: 'windows-native' }
        : { ...UNSUPPORTED_DESKTOP_VISIBILITY_CAPABILITIES.fullscreenAutoHide },
  }
}

// macOS cannot detect another app's fullscreen Space, so "hide in fullscreen" means not following fullscreen Spaces;
// a pending permission request overrides that so the user can still answer it.
export function macVisibleOnFullScreen(
  fullscreenAutoHideEnabled: boolean,
  hasActivePermissionRequest: boolean,
): boolean {
  return !fullscreenAutoHideEnabled || hasActivePermissionRequest
}
