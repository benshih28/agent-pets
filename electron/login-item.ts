import type { LaunchAtStartupStatus } from '../src/types/desktop'
import { resolveLoginItemExecutable } from './desktop-preferences.ts'

/** The subset of Electron's LoginItemSettings this module reads. */
export interface LoginItemSettingsLike {
  openAtLogin: boolean
  status?: 'not-registered' | 'enabled' | 'requires-approval' | 'not-found'
}

export interface LoginItemApp {
  isPackaged: boolean
  isInApplicationsFolder?: () => boolean
  getLoginItemSettings(options?: { path?: string }): LoginItemSettingsLike
  setLoginItemSettings(settings: { openAtLogin: boolean; path?: string; type?: 'mainAppService' }): void
}

export interface LoginItemAdapter {
  supported: boolean
  /** The OS-reported state; never throws. */
  getStatus(): LaunchAtStartupStatus
  /** Applies the request and returns the resulting OS state; never throws. */
  setLaunchAtStartup(enabled: boolean): LaunchAtStartupStatus
}

/** Pure mapping of macOS SMAppService state. `path` does not apply to macOS. */
export function mapDarwinLoginItemStatus(
  settings: LoginItemSettingsLike,
  inApplicationsFolder: boolean,
): LaunchAtStartupStatus {
  if (settings.status === 'enabled' || (settings.status === undefined && settings.openAtLogin)) return 'enabled'
  if (settings.status === 'requires-approval') return 'requires-approval'
  // not-registered / not-found: an app outside /Applications (dmg mount or
  // App Translocation) cannot be registered, which is the usual reason.
  return inApplicationsFolder ? 'disabled' : 'not-in-applications'
}

export function createLoginItemAdapter(options: {
  platform: NodeJS.Platform
  app: LoginItemApp
  execPath: string
  portableExecutableFile?: string
}): LoginItemAdapter {
  const { platform, app } = options
  if (!app.isPackaged) {
    return { supported: false, getStatus: () => 'unsupported', setLaunchAtStartup: () => 'unsupported' }
  }

  if (platform === 'darwin') {
    const inApplications = (): boolean => {
      try { return app.isInApplicationsFolder?.() ?? true } catch { return true }
    }
    const read = (): LaunchAtStartupStatus => {
      try { return mapDarwinLoginItemStatus(app.getLoginItemSettings(), inApplications()) } catch { return 'error' }
    }
    return {
      supported: true,
      getStatus: read,
      setLaunchAtStartup: (enabled) => {
        try {
          app.setLoginItemSettings({ openAtLogin: enabled, type: 'mainAppService' })
        } catch {
          return 'error'
        }
        const status = read()
        // Asking to enable but landing on plain "disabled" while the app is in
        // /Applications means the OS refused for a reason we cannot name.
        return enabled && status === 'disabled' ? 'error' : status
      },
    }
  }

  // electron-builder's Windows portable target runs from a temporary
  // extraction directory. Register the original launcher path, never that
  // ephemeral process.execPath. Unsupported/invalid paths fail closed.
  const executable = resolveLoginItemExecutable(platform, app.isPackaged, options.execPath, options.portableExecutableFile)
  if (!executable) {
    return { supported: false, getStatus: () => 'unsupported', setLaunchAtStartup: () => 'unsupported' }
  }
  const read = (): LaunchAtStartupStatus => {
    try { return app.getLoginItemSettings({ path: executable }).openAtLogin ? 'enabled' : 'disabled' } catch { return 'error' }
  }
  return {
    supported: true,
    getStatus: read,
    setLaunchAtStartup: (enabled) => {
      try { app.setLoginItemSettings({ openAtLogin: enabled, path: executable }) } catch { return 'error' }
      return read()
    },
  }
}
