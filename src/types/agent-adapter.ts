import { GENERIC_HTTP_CAPABILITIES, type AgentCapabilities } from './capabilities.ts'
import type { AgentFamilyKey, AgentSource, AgentStatusEvent } from './agent'
import { AGENT_FAMILY_REGISTRY, FAMILY_SOURCES, SOURCE_LABELS } from './agent.ts'

export type AdapterInstallTarget = 'opencode' | 'codex' | 'claudeCode'

function freezeCapabilities(value: AgentCapabilities): Readonly<AgentCapabilities> {
  return Object.freeze({ ...value, permissionModes: Object.freeze([...value.permissionModes]) })
}

// 有沒有訂閱額度只寫在家族表（AGENT_FAMILY_REGISTRY.quotaProvider），capabilities 從那裡推導。
function quotaOf(family: AgentFamilyKey): AgentCapabilities['quota'] {
  return AGENT_FAMILY_REGISTRY[family].quotaProvider ? 'provider' : 'none'
}

const OPENCODE_CAPABILITIES = freezeCapabilities({
  lifecycle: true, sessions: true, projects: true, toolActivity: true, tokenUsage: 'estimated', quota: quotaOf('opencode'),
  waitingInput: true, permissions: 'respond', permissionModes: ['allow_once', 'deny'], orderedEvents: false, healthCheck: true,
})
const CODEX_CAPABILITIES = freezeCapabilities({
  lifecycle: true, sessions: true, projects: true, toolActivity: true, tokenUsage: 'exact', quota: quotaOf('codex'),
  waitingInput: false, permissions: 'observe', permissionModes: [], orderedEvents: false, healthCheck: true,
})
const CLAUDE_CAPABILITIES = freezeCapabilities({
  lifecycle: true, sessions: true, projects: true, toolActivity: true, tokenUsage: 'exact', quota: quotaOf('claude'),
  waitingInput: true, permissions: 'observe', permissionModes: [], orderedEvents: false, healthCheck: true,
})

interface AgentAdapterRegistryEntry {
  id: string
  displayName: string
  /** 這個 adapter 對應的工具家族；generic-http 沒有家族。來源清單由家族推導。 */
  family: AgentFamilyKey | null
  sources: ReadonlyArray<AgentSource>
  sourceLabels: ReadonlyArray<string>
  capabilities: Readonly<AgentCapabilities>
  installTarget?: AdapterInstallTarget
  installable: boolean
  testSource?: AgentSource
}

function sourceLabelsFor(sources: ReadonlyArray<AgentSource>): ReadonlyArray<string> {
  return Object.freeze(sources.map(source => SOURCE_LABELS[source]))
}

/** Single registration point for built-in adapter ids and their public capabilities. */
export const AGENT_ADAPTER_REGISTRY = Object.freeze([
  {
    id: 'opencode', displayName: 'OpenCode', family: 'opencode', sources: FAMILY_SOURCES.opencode, sourceLabels: sourceLabelsFor(FAMILY_SOURCES.opencode),
    capabilities: OPENCODE_CAPABILITIES, installTarget: 'opencode', installable: true, testSource: 'opencode-cli',
  },
  {
    id: 'codex', displayName: 'Codex', family: 'codex', sources: FAMILY_SOURCES.codex, sourceLabels: sourceLabelsFor(FAMILY_SOURCES.codex),
    capabilities: CODEX_CAPABILITIES, installTarget: 'codex', installable: true, testSource: 'codex',
  },
  {
    id: 'claude-code', displayName: 'Claude Code', family: 'claude', sources: FAMILY_SOURCES.claude, sourceLabels: sourceLabelsFor(FAMILY_SOURCES.claude),
    capabilities: CLAUDE_CAPABILITIES, installTarget: 'claudeCode', installable: true, testSource: 'claude',
  },
  {
    id: 'generic-http', displayName: 'Generic HTTP', family: null, sources: Object.freeze([]), sourceLabels: Object.freeze(['/v1/events']),
    capabilities: GENERIC_HTTP_CAPABILITIES, installable: false,
  },
] as const satisfies ReadonlyArray<AgentAdapterRegistryEntry>)

export type AgentAdapterId = typeof AGENT_ADAPTER_REGISTRY[number]['id']
export interface AgentAdapterDefinition extends AgentAdapterRegistryEntry {
  id: AgentAdapterId
}
export type AdapterHealth = 'ready' | 'needs_install' | 'needs_approval' | 'degraded' | 'error'

export type DiagnosticCheckStatus = 'pass' | 'warn' | 'fail'

export interface AdapterDiagnosticCheck {
  id: string
  status: DiagnosticCheckStatus
  /** `<id>.<status>`: stable key for localized text; `message` is an English fallback. */
  code?: string
  message: string
}

export interface DiagnosticReport {
  adapterId: AgentAdapterId
  health: AdapterHealth
  checkedAt: number
  checks: ReadonlyArray<AdapterDiagnosticCheck>
}

export interface AdapterDetection {
  installed: boolean
  health: AdapterHealth
  version?: string
  message?: string
  capabilities: Readonly<AgentCapabilities>
  sources: ReadonlyArray<AgentSource>
  sourceLabels: ReadonlyArray<string>
  installTarget?: AdapterInstallTarget
  installable: boolean
  testSource?: AgentSource
}

export interface AdapterRuntimeStatus extends AdapterDetection {
  id: AgentAdapterId
  displayName: string
  adapterVersion: string
}

export interface AdapterContext {
  readonly now: () => number
}

export type AdapterNormalizationError =
  | 'source_not_supported'
  | 'unknown_adapter'

export type AdapterNormalizeResult =
  | { ok: true; event: AgentStatusEvent }
  | { ok: false; error: string }

/**
 * Main-process contract shared by built-in and fixture-only adapters.
 * Implementations own installation, diagnostics and raw-event normalization;
 * Event Core and product projections consume only the returned AgentStatusEvent.
 */
export type InstallAction = 'installed' | 'repaired' | 'unchanged' | 'failed'

export type InstallErrorCode =
  | 'config_unparseable'
  | 'config_unsafe'
  | 'config_too_large'
  | 'permission_denied'
  | 'file_busy'
  | 'read_only'
  | 'node_missing'
  | 'node_unsupported'
  | 'unknown'

/** Structured result of one install/repair; the renderer localizes it from these codes. */
export interface InstallOutcome {
  adapterId: AgentAdapterId
  action: InstallAction
  /** Files that were created or modified. */
  changedFiles: string[]
  /** Backups made before modifying user config files. */
  backupPaths: string[]
  errorCode?: InstallErrorCode
  /** File the error is about (config problems only). */
  errorPath?: string
}

export interface InstallReport {
  changedFiles: string[]
  backupPaths: string[]
}

export interface AgentAdapter {
  readonly id: AgentAdapterId
  readonly displayName: string
  readonly adapterVersion: string
  readonly sources: ReadonlyArray<AgentSource>
  readonly capabilities: Readonly<AgentCapabilities>

  detect(ctx: AdapterContext): Promise<AdapterDetection>
  install(ctx: AdapterContext): Promise<AdapterDetection & { outcome?: InstallOutcome }>
  uninstall(ctx: AdapterContext): Promise<AdapterDetection>
  diagnose(ctx: AdapterContext): Promise<DiagnosticReport>
  normalize(input: unknown, ctx: AdapterContext, receivedAt?: number): Promise<AdapterNormalizeResult>
}
