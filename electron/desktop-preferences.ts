import * as fs from 'node:fs'
import * as path from 'node:path'
import { renameSyncWithRetry } from './fs-rename.ts'
import type { DesktopPreferences, DesktopPreferencesPatch } from '../src/types/desktop'
import { DEFAULT_LOCALE, isAppLocale } from '../src/types/locale.ts'
import {
  UNSUPPORTED_DESKTOP_VISIBILITY_CAPABILITIES,
  type DesktopVisibilityCapabilities,
} from '../src/types/desktop-visibility.ts'

export function readBoundedJson(filePath: string, maxBytes = 64 * 1024): unknown | null {
  try {
    const stat = fs.lstatSync(filePath)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) return null
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

export function writeJsonAtomic(filePath: string, value: unknown): void {
  const directory = path.dirname(filePath)
  fs.mkdirSync(directory, { recursive: true })
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  )

  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    })
    renameSyncWithRetry(temporaryPath, filePath)
    if (process.platform !== 'win32') {
      try { fs.chmodSync(filePath, 0o600) } catch {}
    }
  } catch (error) {
    try { fs.rmSync(temporaryPath, { force: true }) } catch {}
    throw error
  }
}

type StoredDesktopPreferences = Omit<DesktopPreferences, 'launchAtStartupSupported' | 'visibilityCapabilities'>

function supportedVisibilityPreference(
  enabled: boolean | undefined,
  supported: boolean,
): boolean {
  // A preference file can outlive the platform/runtime that wrote it. Never
  // project a stale `true` into the renderer or native side effects when the
  // current platform does not expose the capability.
  return supported && enabled === true
}

export interface LoginItemAdapter {
  supported: boolean
  getOpenAtLogin(): boolean
  setOpenAtLogin(enabled: boolean): boolean
}

export function resolveLoginItemExecutable(
  platform: NodeJS.Platform,
  isPackaged: boolean,
  execPath: string,
  portableExecutableFile?: string,
): string | null {
  if (!isPackaged) return null
  const candidate = platform === 'win32' ? portableExecutableFile : execPath
  if (!candidate || !path.isAbsolute(candidate)) return null
  if (platform === 'win32' && path.extname(candidate).toLowerCase() !== '.exe') return null

  try {
    const stat = fs.lstatSync(candidate)
    return stat.isFile() && !stat.isSymbolicLink() ? candidate : null
  } catch {
    return null
  }
}

const BOOLEAN_KEYS = [
  'dndEnabled',
  'notificationsEnabled',
  'permissionBubbleEnabled',
  'presentationMcpEnabled',
  'achievementsEnabled',
  'edgeModeEnabled',
  'shimejiEnabled',
  'captureExclusionEnabled',
  'fullscreenAutoHideEnabled',
  'rightClickHideEnabled',
  'soundEnabled',
  'launchAtStartup',
] as const

const DEFAULTS: StoredDesktopPreferences = {
  dndEnabled: false,
  notificationsEnabled: true,
  permissionBubbleEnabled: true,
  presentationMcpEnabled: true,
  achievementsEnabled: true,
  edgeModeEnabled: false,
  shimejiEnabled: false,
  captureExclusionEnabled: false,
  fullscreenAutoHideEnabled: false,
  rightClickHideEnabled: false,
  soundEnabled: false,
  launchAtStartup: false,
  locale: DEFAULT_LOCALE,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function sanitizeStored(value: unknown): Partial<StoredDesktopPreferences> {
  if (!isRecord(value)) return {}
  const result: Partial<StoredDesktopPreferences> = {}
  for (const key of BOOLEAN_KEYS) {
    if (typeof value[key] === 'boolean') result[key] = value[key]
  }
  if (isAppLocale(value.locale)) result.locale = value.locale
  return result
}

export function parseDesktopPreferencesPatch(value: unknown): DesktopPreferencesPatch {
  if (!isRecord(value)) throw new TypeError('Desktop preferences patch must be an object')

  const allowed = new Set<string>([...BOOLEAN_KEYS, 'locale'])
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`Unsupported desktop preference: ${key}`)
    if (key === 'locale') {
      if (!isAppLocale(value[key])) throw new TypeError('Desktop preference locale is unsupported')
      continue
    }
    if (typeof value[key] !== 'boolean') {
      throw new TypeError(`Desktop preference ${key} must be boolean`)
    }
  }

  return sanitizeStored(value)
}

export class DesktopPreferencesStore {
  private readonly filePath: string
  private readonly loginItem: LoginItemAdapter
  private visibilityCapabilities: DesktopVisibilityCapabilities
  private stored: Partial<StoredDesktopPreferences> | null = null

  constructor(
    filePath: string,
    loginItem: LoginItemAdapter,
    visibilityCapabilities: DesktopVisibilityCapabilities = UNSUPPORTED_DESKTOP_VISIBILITY_CAPABILITIES,
  ) {
    this.filePath = filePath
    this.loginItem = loginItem
    this.visibilityCapabilities = visibilityCapabilities
  }

  /**
   * A native capability can become unavailable after startup (for example if
   * a platform API rejects an event hook). Update the projection and clear any
   * persisted toggle that can no longer be honoured.
   */
  setVisibilityCapabilities(
    visibilityCapabilities: DesktopVisibilityCapabilities,
  ): DesktopPreferences {
    this.visibilityCapabilities = visibilityCapabilities
    const stored = this.load()
    const captureExclusionEnabled = supportedVisibilityPreference(
      stored.captureExclusionEnabled,
      visibilityCapabilities.captureExclusion.supported,
    )
    const fullscreenAutoHideEnabled = supportedVisibilityPreference(
      stored.fullscreenAutoHideEnabled,
      visibilityCapabilities.fullscreenAutoHide.supported,
    )
    if (stored.captureExclusionEnabled !== captureExclusionEnabled
      || stored.fullscreenAutoHideEnabled !== fullscreenAutoHideEnabled) {
      this.stored = {
        ...stored,
        captureExclusionEnabled,
        fullscreenAutoHideEnabled,
      }
      this.persist(this.get())
    }
    return this.get()
  }

  private load(): Partial<StoredDesktopPreferences> {
    if (this.stored === null) {
      this.stored = sanitizeStored(readBoundedJson(this.filePath))
    }
    return this.stored
  }

  private currentLaunchAtStartup(stored: Partial<StoredDesktopPreferences>): boolean {
    if (!this.loginItem.supported) return false
    try {
      return this.loginItem.getOpenAtLogin()
    } catch {
      return stored.launchAtStartup ?? false
    }
  }

  get(): DesktopPreferences {
    const stored = this.load()
    return {
      ...DEFAULTS,
      ...stored,
      captureExclusionEnabled: supportedVisibilityPreference(
        stored.captureExclusionEnabled,
        this.visibilityCapabilities.captureExclusion.supported,
      ),
      fullscreenAutoHideEnabled: supportedVisibilityPreference(
        stored.fullscreenAutoHideEnabled,
        this.visibilityCapabilities.fullscreenAutoHide.supported,
      ),
      launchAtStartup: this.currentLaunchAtStartup(stored),
      launchAtStartupSupported: this.loginItem.supported,
      visibilityCapabilities: this.visibilityCapabilities,
    }
  }

  initializeLegacySound(legacySoundEnabled: boolean): DesktopPreferences {
    const stored = this.load()
    if (typeof stored.soundEnabled !== 'boolean') {
      this.stored = { ...stored, soundEnabled: legacySoundEnabled }
      this.persist(this.get())
    }
    return this.get()
  }

  update(value: unknown): DesktopPreferences {
    const patch = parseDesktopPreferencesPatch(value)
    const current = this.get()
    const next: DesktopPreferences = { ...current, ...patch }

    // Keep unsupported values disabled even when an old settings file or a
    // forged renderer request asks to enable them. The response is the
    // effective projection, so the renderer cannot display a disabled
    // capability as enabled and no main-process side effect can observe it.
    next.captureExclusionEnabled = supportedVisibilityPreference(
      next.captureExclusionEnabled,
      this.visibilityCapabilities.captureExclusion.supported,
    )
    next.fullscreenAutoHideEnabled = supportedVisibilityPreference(
      next.fullscreenAutoHideEnabled,
      this.visibilityCapabilities.fullscreenAutoHide.supported,
    )

    if (typeof patch.launchAtStartup === 'boolean') {
      if (this.loginItem.supported) {
        next.launchAtStartup = this.loginItem.setOpenAtLogin(patch.launchAtStartup)
      } else {
        next.launchAtStartup = false
      }
    }

    this.stored = {
      dndEnabled: next.dndEnabled,
      notificationsEnabled: next.notificationsEnabled,
      permissionBubbleEnabled: next.permissionBubbleEnabled,
      presentationMcpEnabled: next.presentationMcpEnabled,
      achievementsEnabled: next.achievementsEnabled,
      edgeModeEnabled: next.edgeModeEnabled,
      shimejiEnabled: next.shimejiEnabled,
      captureExclusionEnabled: next.captureExclusionEnabled,
      fullscreenAutoHideEnabled: next.fullscreenAutoHideEnabled,
      rightClickHideEnabled: next.rightClickHideEnabled,
      soundEnabled: next.soundEnabled,
      launchAtStartup: next.launchAtStartup,
      locale: next.locale,
    }
    this.persist(next)
    return next
  }

  private persist(preferences: DesktopPreferences): void {
    writeJsonAtomic(this.filePath, {
      dndEnabled: preferences.dndEnabled,
      notificationsEnabled: preferences.notificationsEnabled,
      permissionBubbleEnabled: preferences.permissionBubbleEnabled,
      presentationMcpEnabled: preferences.presentationMcpEnabled,
      achievementsEnabled: preferences.achievementsEnabled,
      edgeModeEnabled: preferences.edgeModeEnabled,
      shimejiEnabled: preferences.shimejiEnabled,
      captureExclusionEnabled: preferences.captureExclusionEnabled,
      fullscreenAutoHideEnabled: preferences.fullscreenAutoHideEnabled,
      rightClickHideEnabled: preferences.rightClickHideEnabled,
      soundEnabled: preferences.soundEnabled,
      launchAtStartup: preferences.launchAtStartup,
      locale: preferences.locale,
    } satisfies StoredDesktopPreferences)
  }
}
