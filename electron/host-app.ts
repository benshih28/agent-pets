import { HOST_APPS, type AgentHost, type HostAppId } from '../src/types/host-app.ts'

// Hooks send only these hints, read from a handful of environment variables (never an env
// dump, pid or tty). Everything here is attacker-controllable by any local token holder, so
// each value is shape-checked and mapped onto the fixed allowlist in src/types/host-app.ts.

const TERM_PROGRAM_PATTERN = /^[A-Za-z0-9._-]{1,32}$/
const ENTRYPOINT_PATTERN = /^[a-z0-9_-]{1,32}$/
// Reverse-DNS: 2-8 labels of letters, digits and hyphens (never leading, so it cannot read as a
// command-line option), at most 128 characters.
const BUNDLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,62}(?:\.[A-Za-z0-9][A-Za-z0-9-]{0,62}){1,7}$/
const MAX_BUNDLE_ID_LENGTH = 128
const HINT_KEYS: ReadonlySet<string> = new Set(['termProgram', 'bundleId', 'entrypoint', 'windowsTerminal', 'vscode', 'cursor'])

// A Map, not an object: a hint such as `__proto__` or `constructor` must not resolve to anything.
const TERM_PROGRAM_APPS: ReadonlyMap<string, HostAppId> = new Map(Object.entries({
  Apple_Terminal: 'apple-terminal',
  'iTerm.app': 'iterm2',
  WarpTerminal: 'warp',
  ghostty: 'ghostty',
  WezTerm: 'wezterm',
  Hyper: 'hyper',
  Tabby: 'tabby',
  zed: 'zed',
  vscode: 'vscode',
} satisfies Record<string, HostAppId>))

const BUNDLE_APPS: ReadonlyMap<string, HostAppId> = new Map(
  (Object.entries(HOST_APPS) as Array<[Exclude<HostAppId, 'unknown'>, (typeof HOST_APPS)[keyof typeof HOST_APPS]]>)
    .flatMap(([app, definition]) => definition.bundleIds.map(bundleId => [bundleId, app] as const)),
)

export interface ParsedHost {
  host: AgentHost
  /** Allowlisted macOS bundle id the hook reported; main-process only. */
  bundleId?: string
}

export function isValidBundleId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_BUNDLE_ID_LENGTH && BUNDLE_ID_PATTERN.test(value)
}

function hostFor(app: HostAppId): AgentHost {
  return { kind: app === 'unknown' ? 'unknown' : HOST_APPS[app].kind, app }
}

/** Maps hook-reported hints onto an allowlisted host; null when no hints were sent at all. */
export function parseHostHints(value: unknown): ParsedHost | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  // A descriptor with unexpected keys is not ours: treat it as unknown rather than guessing.
  if (Object.keys(raw).some(key => !HINT_KEYS.has(key))) return { host: hostFor('unknown') }

  const termProgram = typeof raw.termProgram === 'string' && TERM_PROGRAM_PATTERN.test(raw.termProgram) ? raw.termProgram : undefined
  const entrypoint = typeof raw.entrypoint === 'string' && ENTRYPOINT_PATTERN.test(raw.entrypoint) ? raw.entrypoint : undefined
  const bundleId = isValidBundleId(raw.bundleId) && BUNDLE_APPS.has(raw.bundleId) ? raw.bundleId : undefined
  const cursor = raw.cursor === true
  const vscode = raw.vscode === true

  // The bundle id is the most precise signal (it survives tmux and names VS Code forks apart).
  if (bundleId) return { host: hostFor(BUNDLE_APPS.get(bundleId)!), bundleId }
  if (entrypoint === 'claude-desktop') return { host: hostFor('claude-desktop') }
  const fromTerm = termProgram ? TERM_PROGRAM_APPS.get(termProgram) : undefined
  if (fromTerm === 'vscode') return { host: hostFor(cursor ? 'cursor' : 'vscode') }
  if (fromTerm) return { host: hostFor(fromTerm) }
  if (entrypoint === 'claude-vscode' || vscode) return { host: hostFor(cursor ? 'cursor' : 'vscode') }
  if (cursor) return { host: hostFor('cursor') }
  if (raw.windowsTerminal === true) return { host: hostFor('windows-terminal') }
  return { host: hostFor('unknown') }
}

/**
 * The only bundle id main will pass to LaunchServices for a host: the reported one when it is on
 * that app's allowlist, otherwise the app's unambiguous default. Re-validated on every call.
 */
export function resolveHostBundleId(app: HostAppId | undefined, reported?: string): string | null {
  if (!app || app === 'unknown') return null
  const definition = HOST_APPS[app]
  const candidate = reported && definition.bundleIds.includes(reported) ? reported : definition.defaultBundleId
  return candidate && isValidBundleId(candidate) && definition.bundleIds.includes(candidate) ? candidate : null
}
