import type {
  PermissionDecisionValue,
  PermissionHotkeyInfo,
  PermissionRequestView,
} from '../src/types/permission'

export const PERMISSION_ALLOW_ACCELERATOR = 'CommandOrControl+Shift+Y'
export const PERMISSION_DENY_ACCELERATOR = 'CommandOrControl+Shift+N'

export interface ShortcutPort {
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
  isRegistered(accelerator: string): boolean
}

export interface PermissionHotkeyOptions {
  shortcuts: ShortcutPort
  platform: NodeJS.Platform
  /** Called with the top request the hotkey was registered for. */
  decide(requestId: string, decision: PermissionDecisionValue): void
}

/** Platform-correct display labels, computed here so the renderer never guesses. */
export function permissionHotkeyLabels(platform: NodeJS.Platform): { allow: string; deny: string } {
  return platform === 'darwin'
    ? { allow: '⌘⇧Y', deny: '⌘⇧N' }
    : { allow: 'Ctrl+Shift+Y', deny: 'Ctrl+Shift+N' }
}

interface Registration {
  requestId: string
  accelerators: string[]
  info: PermissionHotkeyInfo
}

/**
 * Owns the two global permission shortcuts. Registration is keyed by the top
 * request, so broadcasts that do not change it leave the shortcuts untouched
 * (no unregister / register gap), and a failed registration is reported
 * instead of leaving the UI advertising a shortcut that does nothing.
 *
 * Only the top pending request that the broker marked hotkeyEligible (low /
 * medium risk, not truncated) ever gets a shortcut; high-risk and unclassified
 * requests have none.
 */
export class PermissionHotkeys {
  private current: Registration | null = null

  private readonly options: PermissionHotkeyOptions

  constructor(options: PermissionHotkeyOptions) {
    this.options = options
  }

  /** Brings registration in line with `top`; returns the info to show in the UI. */
  sync(top: PermissionRequestView | null | undefined, enabled: boolean): PermissionHotkeyInfo | null {
    const eligible = Boolean(
      enabled && top && top.status === 'pending' && top.hotkeyEligible,
    )
    if (!eligible || !top) {
      this.clear()
      return null
    }
    if (this.current?.requestId === top.requestId && this.stillRegistered(this.current)) {
      return this.current.info
    }
    this.clear()

    const labels = permissionHotkeyLabels(this.options.platform)
    const accelerators: string[] = []
    let failed = false
    const requestId = top.requestId
    const attempts: Array<[PermissionDecisionValue, string]> = []
    if (top.allowedDecisions.includes('allow_once')) attempts.push(['allow_once', PERMISSION_ALLOW_ACCELERATOR])
    if (top.allowedDecisions.includes('deny')) attempts.push(['deny', PERMISSION_DENY_ACCELERATOR])
    for (const [decision, accelerator] of attempts) {
      let ok = false
      try {
        ok = this.options.shortcuts.register(accelerator, () => this.options.decide(requestId, decision))
      } catch {
        ok = false
      }
      // register() can return true while another app still owns the key.
      if (ok && this.options.shortcuts.isRegistered(accelerator)) accelerators.push(accelerator)
      else failed = true
    }
    if (failed) {
      // Partial availability would be confusing: release what we did take.
      for (const accelerator of accelerators) this.safeUnregister(accelerator)
      this.current = {
        requestId,
        accelerators: [],
        info: { status: 'unavailable', allowLabel: labels.allow, denyLabel: labels.deny },
      }
      return this.current.info
    }
    this.current = {
      requestId,
      accelerators,
      info: { status: 'active', allowLabel: labels.allow, denyLabel: labels.deny },
    }
    return this.current.info
  }

  clear(): void {
    if (!this.current) return
    for (const accelerator of this.current.accelerators) this.safeUnregister(accelerator)
    this.current = null
  }

  private stillRegistered(registration: Registration): boolean {
    if (registration.info.status === 'unavailable') return true
    return registration.accelerators.every((accelerator) => this.options.shortcuts.isRegistered(accelerator))
  }

  private safeUnregister(accelerator: string): void {
    try {
      this.options.shortcuts.unregister(accelerator)
    } catch {
      // Unregistering a shortcut we no longer own is not an error worth surfacing.
    }
  }
}

/** Returns the views with hotkey info attached to the top request only. */
export function attachHotkeyInfo(
  requests: PermissionRequestView[],
  info: PermissionHotkeyInfo | null,
): PermissionRequestView[] {
  if (!info || requests.length === 0) return requests
  return requests.map((request, index) => (index === 0 ? { ...request, hotkey: info } : request))
}
