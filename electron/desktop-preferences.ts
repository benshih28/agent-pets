import * as fs from 'node:fs'
import * as path from 'node:path'
import { renameSyncWithRetry } from './fs-rename.ts'
import { dndHasExpired, normalizeDndUntil } from './dnd-schedule.ts'
import type { DesktopPreferences, DesktopPreferencesPatch, LaunchAtStartupStatus } from '../src/types/desktop'
import { DEFAULT_LOCALE, isAppLocale } from '../src/types/locale.ts'
import {
  CLAUDE_PERMISSION_WAIT_DEFAULT_SECONDS,
  CLAUDE_PERMISSION_WAIT_MAX_SECONDS,
  CLAUDE_PERMISSION_WAIT_MIN_SECONDS,
} from '../src/types/permission.ts'
import { SOUND_DEFAULTS, SOUND_VOLUME } from '../src/types/sound.ts'
import {
  UNSUPPORTED_DESKTOP_VISIBILITY_CAPABILITIES,
  type DesktopVisibilityCapabilities,
} from '../src/types/desktop-visibility.ts'
import { isRecord } from './value-guards.ts'

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

type StoredDesktopPreferences = Omit<DesktopPreferences, 'launchAtStartupSupported' | 'launchAtStartupStatus' | 'visibilityCapabilities'>

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
  /** OS-reported state. Must not throw. */
  getStatus(): LaunchAtStartupStatus
  /** Applies the request and returns the resulting OS state. Must not throw. */
  setLaunchAtStartup(enabled: boolean): LaunchAtStartupStatus
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

/** OS truth wins when it is definitive; otherwise the stored intent stands. */
export function resolveLaunchIntent(status: LaunchAtStartupStatus, storedIntent: boolean): boolean {
  if (status === 'enabled') return true
  if (status === 'disabled' || status === 'unsupported') return false
  return storedIntent
}

const BOOLEAN_KEYS = [
  'dndEnabled',
  'notificationsEnabled',
  'permissionBubbleEnabled',
  'claudePermissionRespondEnabled',
  'presentationMcpEnabled',
  'achievementsEnabled',
  'edgeModeEnabled',
  'shimejiEnabled',
  'captureExclusionEnabled',
  'fullscreenAutoHideEnabled',
  'rightClickHideEnabled',
  'completionMarkersEnabled',
  'sessionJumpEnabled',
  'sessionJumpSwitchAppEnabled',
  'soundEnabled',
  'soundOnPermission',
  'soundOnError',
  'soundOnSuccess',
  'launchAtStartup',
] as const

const DEFAULTS: StoredDesktopPreferences = {
  dndEnabled: false,
  dndUntil: null,
  notificationsEnabled: true,
  permissionBubbleEnabled: true,
  claudePermissionRespondEnabled: false,
  claudePermissionWaitSeconds: CLAUDE_PERMISSION_WAIT_DEFAULT_SECONDS,
  presentationMcpEnabled: true,
  achievementsEnabled: true,
  edgeModeEnabled: false,
  shimejiEnabled: false,
  captureExclusionEnabled: false,
  fullscreenAutoHideEnabled: false,
  rightClickHideEnabled: false,
  completionMarkersEnabled: true,
  sessionJumpEnabled: true,
  sessionJumpSwitchAppEnabled: true,
  ...SOUND_DEFAULTS,
  launchAtStartup: false,
  locale: DEFAULT_LOCALE,
}

function isVolume(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= SOUND_VOLUME.min && value <= SOUND_VOLUME.max
}

function isWaitSeconds(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= CLAUDE_PERMISSION_WAIT_MIN_SECONDS
    && value <= CLAUDE_PERMISSION_WAIT_MAX_SECONDS
}

function sanitizeStored(value: unknown): Partial<StoredDesktopPreferences> {
  if (!isRecord(value)) return {}
  const result: Partial<StoredDesktopPreferences> = {}
  for (const key of BOOLEAN_KEYS) {
    if (typeof value[key] === 'boolean') result[key] = value[key]
  }
  if (isAppLocale(value.locale)) result.locale = value.locale
  if (isVolume(value.soundVolume)) result.soundVolume = Math.round(value.soundVolume)
  if (isWaitSeconds(value.claudePermissionWaitSeconds)) result.claudePermissionWaitSeconds = value.claudePermissionWaitSeconds
  if (value.dndUntil === null) result.dndUntil = null
  else if (typeof value.dndUntil === 'number' && Number.isFinite(value.dndUntil) && value.dndUntil > 0) {
    result.dndUntil = Math.floor(value.dndUntil)
  }
  return result
}

export function parseDesktopPreferencesPatch(value: unknown): DesktopPreferencesPatch {
  if (!isRecord(value)) throw new TypeError('Desktop preferences patch must be an object')

  const allowed = new Set<string>([...BOOLEAN_KEYS, 'locale', 'dndUntil', 'soundVolume', 'claudePermissionWaitSeconds'])
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`Unsupported desktop preference: ${key}`)
    if (key === 'locale') {
      if (!isAppLocale(value[key])) throw new TypeError('Desktop preference locale is unsupported')
      continue
    }
    if (key === 'soundVolume') {
      if (!isVolume(value[key])) throw new TypeError(`Desktop preference soundVolume must be a number from ${SOUND_VOLUME.min} to ${SOUND_VOLUME.max}`)
      continue
    }
    if (key === 'claudePermissionWaitSeconds') {
      if (!isWaitSeconds(value[key])) {
        throw new TypeError(`Desktop preference claudePermissionWaitSeconds must be an integer from ${CLAUDE_PERMISSION_WAIT_MIN_SECONDS} to ${CLAUDE_PERMISSION_WAIT_MAX_SECONDS}`)
      }
      continue
    }
    if (key === 'dndUntil') {
      if (value[key] !== null && !(typeof value[key] === 'number' && Number.isFinite(value[key]) && (value[key] as number) > 0)) {
        throw new TypeError('Desktop preference dndUntil must be a positive number or null')
      }
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

  private currentLaunchAtStartup(stored: Partial<StoredDesktopPreferences>): {
    launchAtStartup: boolean
    launchAtStartupStatus: LaunchAtStartupStatus
  } {
    if (!this.loginItem.supported) return { launchAtStartup: false, launchAtStartupStatus: 'unsupported' }
    let status: LaunchAtStartupStatus
    try { status = this.loginItem.getStatus() } catch { status = 'error' }
    return { launchAtStartup: resolveLaunchIntent(status, stored.launchAtStartup ?? false), launchAtStartupStatus: status }
  }

  get(): DesktopPreferences {
    const stored = this.load()
    const now = Date.now()
    const dndExpired = dndHasExpired(stored.dndEnabled ?? false, stored.dndUntil, now)
    return {
      ...DEFAULTS,
      ...stored,
      dndEnabled: dndExpired ? false : (stored.dndEnabled ?? false),
      dndUntil: dndExpired ? null : (stored.dndEnabled ? (stored.dndUntil ?? null) : null),
      captureExclusionEnabled: supportedVisibilityPreference(
        stored.captureExclusionEnabled,
        this.visibilityCapabilities.captureExclusion.supported,
      ),
      fullscreenAutoHideEnabled: supportedVisibilityPreference(
        stored.fullscreenAutoHideEnabled,
        this.visibilityCapabilities.fullscreenAutoHide.supported,
      ),
      ...this.currentLaunchAtStartup(stored),
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
    // A timed DND only makes sense while DND is on; the end time is clamped to
    // a bounded window so a forged value cannot pin it on indefinitely by accident.
    next.dndUntil = normalizeDndUntil(next.dndUntil, next.dndEnabled, Date.now())

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
        let status: LaunchAtStartupStatus
        try { status = this.loginItem.setLaunchAtStartup(patch.launchAtStartup) } catch { status = 'error' }
        next.launchAtStartupStatus = status
        // Keep the user's intent when the OS needs approval or refuses, so the
        // toggle does not silently snap back.
        next.launchAtStartup = patch.launchAtStartup ? resolveLaunchIntent(status, true) : false
      } else {
        next.launchAtStartup = false
        next.launchAtStartupStatus = 'unsupported'
      }
    }

    this.stored = {
      dndEnabled: next.dndEnabled,
      dndUntil: next.dndUntil,
      notificationsEnabled: next.notificationsEnabled,
      permissionBubbleEnabled: next.permissionBubbleEnabled,
      claudePermissionRespondEnabled: next.claudePermissionRespondEnabled,
      claudePermissionWaitSeconds: next.claudePermissionWaitSeconds,
      presentationMcpEnabled: next.presentationMcpEnabled,
      achievementsEnabled: next.achievementsEnabled,
      edgeModeEnabled: next.edgeModeEnabled,
      shimejiEnabled: next.shimejiEnabled,
      captureExclusionEnabled: next.captureExclusionEnabled,
      fullscreenAutoHideEnabled: next.fullscreenAutoHideEnabled,
      rightClickHideEnabled: next.rightClickHideEnabled,
      completionMarkersEnabled: next.completionMarkersEnabled,
      sessionJumpEnabled: next.sessionJumpEnabled,
      sessionJumpSwitchAppEnabled: next.sessionJumpSwitchAppEnabled,
      soundEnabled: next.soundEnabled,
      soundVolume: next.soundVolume,
      soundOnPermission: next.soundOnPermission,
      soundOnError: next.soundOnError,
      soundOnSuccess: next.soundOnSuccess,
      launchAtStartup: next.launchAtStartup,
      locale: next.locale,
    }
    this.persist(next)
    return next
  }

  private persist(preferences: DesktopPreferences): void {
    writeJsonAtomic(this.filePath, {
      dndEnabled: preferences.dndEnabled,
      dndUntil: preferences.dndUntil,
      notificationsEnabled: preferences.notificationsEnabled,
      permissionBubbleEnabled: preferences.permissionBubbleEnabled,
      claudePermissionRespondEnabled: preferences.claudePermissionRespondEnabled,
      claudePermissionWaitSeconds: preferences.claudePermissionWaitSeconds,
      presentationMcpEnabled: preferences.presentationMcpEnabled,
      achievementsEnabled: preferences.achievementsEnabled,
      edgeModeEnabled: preferences.edgeModeEnabled,
      shimejiEnabled: preferences.shimejiEnabled,
      captureExclusionEnabled: preferences.captureExclusionEnabled,
      fullscreenAutoHideEnabled: preferences.fullscreenAutoHideEnabled,
      rightClickHideEnabled: preferences.rightClickHideEnabled,
      completionMarkersEnabled: preferences.completionMarkersEnabled,
      sessionJumpEnabled: preferences.sessionJumpEnabled,
      sessionJumpSwitchAppEnabled: preferences.sessionJumpSwitchAppEnabled,
      soundEnabled: preferences.soundEnabled,
      soundVolume: preferences.soundVolume,
      soundOnPermission: preferences.soundOnPermission,
      soundOnError: preferences.soundOnError,
      soundOnSuccess: preferences.soundOnSuccess,
      launchAtStartup: preferences.launchAtStartup,
      locale: preferences.locale,
    } satisfies StoredDesktopPreferences)
  }
}
