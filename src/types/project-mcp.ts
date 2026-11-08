export const PROJECT_MCP_CLIENTS = ['codex', 'claude', 'opencode'] as const

export type ProjectMcpClientId = typeof PROJECT_MCP_CLIENTS[number]

export type ProjectMcpInstallStatus =
  | 'installed'
  | 'already_configured'
  | 'not_configured'
  | 'stale'
  | 'conflict'
  | 'error'

/** Stable machine-readable reason; the renderer localizes it, `message` is an English fallback. */
export type ProjectMcpResultCode =
  | 'installed'
  | 'already_configured'
  | 'not_configured'
  | 'stale_paths'
  | 'updated'
  | 'removed'
  | 'already_absent'
  | 'entry_changed'
  | 'server_mismatch'
  | 'servers_not_object'
  | 'legacy_format'
  | 'jsonc'
  | 'invalid_json'
  | 'root_not_object'
  | 'too_large'
  | 'unsafe_file'
  | 'write_failed'

export interface ProjectMcpInstallResult {
  client: ProjectMcpClientId
  status: ProjectMcpInstallStatus
  configPath: string
  code?: ProjectMcpResultCode
  message?: string
  /** Config the user can paste by hand when Agent Pets will not edit the file. */
  manualSnippet?: string
}

export interface ProjectMcpSetupSummary {
  ok: boolean
  cancelled?: boolean
  projectPath?: string
  results: ProjectMcpInstallResult[]
  error?: string
  /** Files added to .git/info/exclude (local-only mode). */
  excluded?: string[]
  /** Written files that Git already tracks, so they cannot be kept local-only. */
  trackedFiles?: string[]
  /** Stable warning codes; the renderer localizes them. */
  warnings?: ProjectMcpSetupWarning[]
}

export type ProjectMcpSetupWarning = 'git_outside_project' | 'exclude_write_failed'

export interface ProjectMcpPlanClient {
  client: ProjectMcpClientId
  configPath: string
  relativePath: string
  exists: boolean
  /** Current state of the file for this client; 'error' means it cannot be edited as-is. */
  status: 'not_configured' | 'already_configured' | 'stale' | 'conflict' | 'error'
  code?: ProjectMcpResultCode
  message?: string
  /** true/false when the project is a Git repo with a readable index; null when unknown. */
  gitTracked: boolean | null
  /** The client appears to be in use on this machine/project. */
  suggested: boolean
  /** What will be added (contains local paths; shown only in this UI). */
  preview: string
}

export interface ProjectMcpPlan {
  ok: boolean
  cancelled?: boolean
  projectPath?: string
  isGitRepo?: boolean
  clients?: ProjectMcpPlanClient[]
  error?: string
}

export interface ProjectMcpApplyRequest {
  projectPath: string
  clients: ProjectMcpClientId[]
  localOnly: boolean
  /** Rewrite entries that are clearly Agent Pets' own but point at outdated paths. */
  updateStale?: boolean
}

export type ProjectMcpProjectStatus =
  | 'connected'
  | 'partial'
  | 'stale'
  | 'conflict'
  | 'missing'
  | 'error'

export interface ProjectMcpProjectRecord {
  projectPath: string
  projectName: string
  registeredAt: string
  lastCheckedAt: string
  status: ProjectMcpProjectStatus
  results: ProjectMcpInstallResult[]
  /** Why the check failed (status 'error'). */
  error?: string
}

export interface ProjectMcpRegistrySnapshot {
  ok: boolean
  projects: ProjectMcpProjectRecord[]
  error?: string
  /** The project list file was unreadable and has been set aside; the list starts empty. */
  recovered?: boolean
}

export type ProjectMcpRemovalStatus =
  | 'removed'
  | 'already_absent'
  | 'conflict'
  | 'error'

export interface ProjectMcpRemovalResult {
  client: ProjectMcpClientId
  status: ProjectMcpRemovalStatus
  configPath: string
  code?: ProjectMcpResultCode
  message?: string
}

export interface ProjectMcpRemovalSummary {
  ok: boolean
  projectPath: string
  results: ProjectMcpRemovalResult[]
  error?: string
}
