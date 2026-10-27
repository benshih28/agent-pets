import type { AgentCapabilities } from './capabilities'
import type { AgentSource, AgentStatusEvent } from './agent'
import { SOURCE_LABELS } from './agent.ts'

export type AdapterInstallTarget = 'opencode' | 'codex' | 'claudeCode'

const OPENCODE_SOURCES: ReadonlyArray<AgentSource> = Object.freeze(['opencode-cli', 'opencode-desktop'])
const CODEX_SOURCES: ReadonlyArray<AgentSource> = Object.freeze(['codex', 'codex-desktop'])
const CLAUDE_SOURCES: ReadonlyArray<AgentSource> = Object.freeze(['claude', 'claude-desktop'])

function freezeCapabilities(value: AgentCapabilities): Readonly<AgentCapabilities> {
  return Object.freeze({ ...value, permissionModes: Object.freeze([...value.permissionModes]) })
}

const OPENCODE_CAPABILITIES = freezeCapabilities({
  lifecycle: true, sessions: true, projects: true, toolActivity: true, tokenUsage: 'estimated', quota: 'none',
  waitingInput: true, permissions: 'respond', permissionModes: ['allow_once', 'deny'], orderedEvents: false, healthCheck: true,
})
const CODEX_CAPABILITIES = freezeCapabilities({
  lifecycle: true, sessions: true, projects: true, toolActivity: true, tokenUsage: 'estimated', quota: 'provider',
  waitingInput: true, permissions: 'observe', permissionModes: [], orderedEvents: false, healthCheck: true,
})
const CLAUDE_CAPABILITIES = freezeCapabilities({
  lifecycle: true, sessions: true, projects: true, toolActivity: true, tokenUsage: 'estimated', quota: 'provider',
  waitingInput: true, permissions: 'observe', permissionModes: [], orderedEvents: false, healthCheck: true,
})
const GENERIC_HTTP_CAPABILITIES = freezeCapabilities({
  lifecycle: true, sessions: true, projects: true, toolActivity: true, tokenUsage: 'none', quota: 'none',
  waitingInput: true, permissions: 'none', permissionModes: [], orderedEvents: false, healthCheck: false,
})

interface AgentAdapterRegistryEntry {
  id: string
  displayName: string
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
    id: 'opencode', displayName: 'OpenCode', sources: OPENCODE_SOURCES, sourceLabels: sourceLabelsFor(OPENCODE_SOURCES),
    capabilities: OPENCODE_CAPABILITIES, installTarget: 'opencode', installable: true, testSource: 'opencode-cli',
  },
  {
    id: 'codex', displayName: 'Codex', sources: CODEX_SOURCES, sourceLabels: sourceLabelsFor(CODEX_SOURCES),
    capabilities: CODEX_CAPABILITIES, installTarget: 'codex', installable: true, testSource: 'codex',
  },
  {
    id: 'claude-code', displayName: 'Claude Code', sources: CLAUDE_SOURCES, sourceLabels: sourceLabelsFor(CLAUDE_SOURCES),
    capabilities: CLAUDE_CAPABILITIES, installTarget: 'claudeCode', installable: true, testSource: 'claude',
  },
  {
    id: 'generic-http', displayName: 'Generic HTTP', sources: Object.freeze([]), sourceLabels: Object.freeze(['/v1/events']),
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
export interface AgentAdapter {
  readonly id: AgentAdapterId
  readonly displayName: string
  readonly adapterVersion: string
  readonly sources: ReadonlyArray<AgentSource>
  readonly capabilities: Readonly<AgentCapabilities>

  detect(ctx: AdapterContext): Promise<AdapterDetection>
  install(ctx: AdapterContext): Promise<AdapterDetection>
  uninstall(ctx: AdapterContext): Promise<AdapterDetection>
  diagnose(ctx: AdapterContext): Promise<DiagnosticReport>
  normalize(input: unknown, ctx: AdapterContext, receivedAt?: number): Promise<AdapterNormalizeResult>
}
