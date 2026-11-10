import type {
  AdapterContext,
  AdapterDetection,
  AdapterHealth,
  AdapterInstallTarget,
  AdapterNormalizeResult,
  AdapterRuntimeStatus,
  AgentAdapter,
  AgentAdapterId,
  AgentAdapterDefinition,
  DiagnosticReport,
  InstallOutcome,
  InstallReport,
} from '../src/types/agent-adapter'
import type { AgentCapabilities } from '../src/types/capabilities'
import { normalizeAgentStatusEvent } from './event-normalizer.ts'
import { buildOutcome, failedOutcome } from './install-outcome.ts'
import { AGENT_ADAPTER_REGISTRY } from '../src/types/agent-adapter.ts'
import { familyOfSource } from '../src/types/agent.ts'

const ADAPTER_VERSION = '1.0.0'
const ADAPTER_IDS: ReadonlySet<string> = new Set(AGENT_ADAPTER_REGISTRY.map(definition => definition.id))

export interface AdapterInspection {
  installed: boolean
  health: AdapterHealth
  message: string
  checks: DiagnosticReport['checks']
}

export interface AgentAdapterOperations {
  inspect(id: AgentAdapterId): AdapterInspection
  /** Async preconditions (e.g. resolving Node.js) that must pass before install writes anything. */
  prepare?(target: AdapterInstallTarget): Promise<void>
  install(target: AdapterInstallTarget): InstallReport | void
  uninstall(target: AdapterInstallTarget): void
  /**
   * Runtime capability projection. Claude Code answers permissions only while the user has
   * turned that on, so its reported capability follows the main-process preference.
   */
  capabilities?(id: AgentAdapterId, base: Readonly<AgentCapabilities>): Readonly<AgentCapabilities>
}

function check(id: string, status: 'pass' | 'warn' | 'fail', message: string) {
  return { id, status, code: `${id}.${status}`, message }
}

function inspectGenericHttp(): AdapterInspection {
  return {
    installed: true,
    health: 'ready',
    message: 'The local /v1/events ingress is available through the authenticated receiver.',
    checks: [
      check('loopback', 'pass', 'The receiver binds to loopback only.'),
      check('token', 'pass', 'Requests need the token created at install time.'),
      check('permissions', 'pass', 'Generic HTTP is observe-only and cannot answer Permission.'),
    ],
  }
}

function context(): AdapterContext {
  return { now: () => Date.now() }
}

function createAdapter(definition: AgentAdapterDefinition, operations: AgentAdapterOperations): AgentAdapter {
  return {
    id: definition.id,
    displayName: definition.displayName,
    adapterVersion: ADAPTER_VERSION,
    sources: definition.sources,
    capabilities: definition.capabilities,
    detect: async () => {
      const inspection = definition.id === 'generic-http' ? inspectGenericHttp() : operations.inspect(definition.id)
      return {
        installed: inspection.installed,
        health: inspection.health,
        message: inspection.message,
        capabilities: operations.capabilities?.(definition.id, definition.capabilities) ?? definition.capabilities,
        sources: definition.sources,
        sourceLabels: definition.sourceLabels,
        ...(definition.installTarget ? { installTarget: definition.installTarget } : {}),
        installable: definition.installable,
        ...(definition.testSource ? { testSource: definition.testSource } : {}),
      }
    },
    install: async () => {
      const self = createAdapter(definition, operations)
      const before = (await self.detect(context())).health
      let report: InstallReport = { changedFiles: [], backupPaths: [] }
      try {
        if (definition.installTarget) {
          await operations.prepare?.(definition.installTarget)
          report = operations.install(definition.installTarget) ?? report
        }
      } catch (error) {
        // Keep the failure structured; the IPC layer turns this into a per-adapter result.
        throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
          installOutcome: failedOutcome(definition.id, error),
        })
      }
      return { ...(await self.detect(context())), outcome: buildOutcome(definition.id, report, before) }
    },
    uninstall: async () => {
      if (definition.installTarget) operations.uninstall(definition.installTarget)
      return (await createAdapter(definition, operations).detect(context()))
    },
    diagnose: async ctx => {
      const inspection = definition.id === 'generic-http' ? inspectGenericHttp() : operations.inspect(definition.id)
      return {
        adapterId: definition.id,
        health: inspection.health,
        checkedAt: ctx.now(),
        checks: inspection.checks,
      }
    },
    normalize: async (input, _ctx, receivedAt) => {
      const normalized = normalizeAgentStatusEvent(input, receivedAt)
      if (!normalized.ok) return normalized
      // 有家族的 adapter 只收自己家族的來源（查來源 registry，O(1)）；generic-http 沒有家族，什麼來源都收。
      if (definition.family !== null && familyOfSource(normalized.event.source) !== definition.family) {
        return { ok: false, error: 'source_not_supported' }
      }
      return {
        ok: true,
        event: { ...normalized.event, adapterId: definition.id },
      }
    },
  }
}

const CLAUDE_RESPOND_MODES = Object.freeze(['allow_once', 'deny'] as const)

/** Claude Code's capability while answering from the pet is on; every other adapter is unchanged. */
export function projectAdapterCapabilities(
  id: AgentAdapterId,
  base: Readonly<AgentCapabilities>,
  claudePermissionRespondEnabled: boolean,
): Readonly<AgentCapabilities> {
  if (id !== 'claude-code' || !claudePermissionRespondEnabled) return base
  return Object.freeze({ ...base, permissions: 'respond', permissionModes: CLAUDE_RESPOND_MODES })
}

export interface AgentAdapterRegistry {
  readonly adapters: ReadonlyArray<AgentAdapter>
  listStatuses(): Promise<ReadonlyArray<AdapterRuntimeStatus>>
  diagnose(id: AgentAdapterId): Promise<DiagnosticReport | null>
  install(id: AgentAdapterId): Promise<(AdapterDetection & { outcome?: InstallOutcome }) | null>
  uninstall(id: AgentAdapterId): Promise<AdapterDetection | null>
  normalize(input: unknown, receivedAt?: number): Promise<AdapterNormalizeResult>
}

export function isAgentAdapterId(value: unknown): value is AgentAdapterId {
  return typeof value === 'string' && ADAPTER_IDS.has(value)
}

const DEFAULT_OPERATIONS: AgentAdapterOperations = {
  inspect: id => ({
    installed: id === 'generic-http',
    health: id === 'generic-http' ? 'ready' : 'needs_install',
    message: id === 'generic-http' ? 'The local /v1/events ingress is available.' : 'The adapter is not installed.',
    checks: id === 'generic-http'
      ? inspectGenericHttp().checks
      : [check('runtime', 'warn', 'Setup operations are unavailable in this runtime.')],
  }),
  install: () => {},
  uninstall: () => {},
}

export function createAgentAdapterRegistry(operations: AgentAdapterOperations = DEFAULT_OPERATIONS): AgentAdapterRegistry {
  const adapters = Object.freeze(AGENT_ADAPTER_REGISTRY.map(definition => createAdapter(definition, operations)))
  const byId = new Map(adapters.map(adapter => [adapter.id, adapter]))
  const generic = byId.get('generic-http')!

  return {
    adapters,
    async listStatuses() {
      const statuses = await Promise.all(adapters.map(async adapter => {
        const detection = await adapter.detect(context())
        return {
          id: adapter.id,
          displayName: adapter.displayName,
          adapterVersion: adapter.adapterVersion,
          ...detection,
        }
      }))
      return statuses
    },
    diagnose(id) {
      return byId.get(id)?.diagnose(context()) ?? Promise.resolve(null)
    },
    install(id) {
      return byId.get(id)?.install(context()) ?? Promise.resolve(null)
    },
    uninstall(id) {
      return byId.get(id)?.uninstall(context()) ?? Promise.resolve(null)
    },
    async normalize(input, receivedAt = Date.now()) {
      const raw = input && typeof input === 'object' && !Array.isArray(input)
        ? input as Record<string, unknown>
        : {}
      const requestedId = raw.adapterId
      if (requestedId !== undefined) {
        if (!isAgentAdapterId(requestedId)) return { ok: false, error: 'unknown_adapter' }
        // `/v1/events` is a generic local ingress. A caller may explicitly
        // opt into the observe-only adapter, but cannot self-assert a
        // built-in adapter with stronger capabilities.
        if (requestedId !== 'generic-http') return { ok: false, error: 'adapter_claim_not_allowed' }
        return byId.get(requestedId)!.normalize(input, context(), receivedAt)
      }
      const source = typeof raw.source === 'string' ? raw.source : undefined
      const sourceAdapter = source === undefined
        ? undefined
        : adapters.find(adapter => adapter.sources.some(adapterSource => adapterSource === source))
      return (sourceAdapter ?? generic).normalize(input, context(), receivedAt)
    },
  }
}
