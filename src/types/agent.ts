import type { PermissionNotice } from './capabilities'
import type { AgentAdapterId } from './agent-adapter'
import type { AgentHost } from './host-app'

export type AgentSource =
  | 'opencode-cli'
  | 'opencode-desktop'
  | 'codex'
  | 'codex-desktop'
  | 'claude'
  | 'claude-desktop'

export type AgentState =
  | 'offline'
  | 'idle'
  | 'thinking'
  | 'tool-running'
  | 'waiting-permission'
  | 'waiting-input'
  | 'success'
  | 'error'

export interface AgentTokenUsage {
  input?: number
  output?: number
  quality: 'estimated' | 'exact'
}

export interface AgentStatusEvent {
  adapterId?: AgentAdapterId
  source: AgentSource
  sessionId: string
  project?: string
  /** Main-process canonical project fingerprint; never a raw path. */
  projectId?: string
  /** Main-process routing result; absent means preserve legacy selected-pet behavior. */
  routedPetId?: string
  state: AgentState
  originalEvent?: string
  timestamp: number
  eventId?: string
  sourceEventId?: string
  toolName?: string
  tokenUsage?: AgentTokenUsage
  permissionNotice?: PermissionNotice
  /** Terminal / IDE / desktop app the session runs in (allowlisted id only). */
  host?: AgentHost
}

export interface AgentSession {
  key: string
  source: AgentSource
  sessionId: string
  project?: string
  projectId?: string
  routedPetId?: string
  state: AgentState
  lastSeenAt: number
  /** When this session was first seen; a stable tie-break for "who needs you" ordering. */
  firstSeenAt?: number
  toolName?: string
  permissionNotice?: PermissionNotice
  host?: AgentHost
}

export const STATE_PRIORITY: Record<AgentState, number> = {
  'waiting-permission': 100,
  error: 90,
  'waiting-input': 85,
  'tool-running': 80,
  thinking: 70,
  success: 60,
  idle: 20,
  offline: 0,
}

// Deliberately not localized, like SOURCE_LABELS below: these are the agent's
// technical run states (idle/thinking/waiting-permission/...), not prose —
// translating them read as inconsistent next to the English tool/session
// vocabulary the rest of the panel already uses, so they stay English in
// every locale.
export const STATE_LABELS: Record<AgentState, string> = {
  offline: 'Offline',
  idle: 'Idle',
  thinking: 'Thinking',
  'tool-running': 'Running Tool',
  'waiting-permission': 'Waiting Permission',
  'waiting-input': 'Waiting Input',
  success: 'Success',
  error: 'Error',
}

// Compact form for the pet's floating status line, where every character
// counts — the full STATE_LABELS stay for the roomy session-list panel.
export const STATE_LABELS_SHORT: Record<AgentState, string> = {
  offline: 'Offline',
  idle: 'Idle',
  thinking: 'Thinking',
  'tool-running': 'Running',
  'waiting-permission': 'Permission',
  'waiting-input': 'Waiting',
  success: 'Success',
  error: 'Error',
}

export const STATE_COLORS: Record<AgentState, string> = {
  offline: '#757575',
  idle: '#8a8a8a',
  thinking: '#8b9cf7',
  'tool-running': '#8b9cf7',
  'waiting-permission': '#c8b450',
  'waiting-input': '#c8b450',
  success: '#50c878',
  error: '#ff6b6b',
}

export const SOURCE_LABELS: Record<AgentSource, string> = {
  'opencode-cli': 'OpenCode CLI',
  'opencode-desktop': 'OpenCode Desktop',
  codex: 'Codex CLI',
  'codex-desktop': 'Codex Desktop',
  claude: 'Claude CLI',
  'claude-desktop': 'Claude Desktop',
}

// Groups CLI + Desktop variants of the same tool onto a single status line.
export const SOURCE_FAMILIES: { key: string; label: string; sources: AgentSource[] }[] = [
  { key: 'codex', label: 'Codex', sources: ['codex', 'codex-desktop'] },
  { key: 'claude', label: 'Claude', sources: ['claude', 'claude-desktop'] },
  { key: 'opencode', label: 'OpenCode', sources: ['opencode-cli', 'opencode-desktop'] },
]

export const ALL_SOURCES: AgentSource[] = [
  'opencode-cli',
  'opencode-desktop',
  'codex',
  'codex-desktop',
  'claude',
  'claude-desktop',
]
