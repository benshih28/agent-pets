import { randomUUID } from 'node:crypto'
import type { AgentCapabilities } from '../src/types/capabilities'
import type {
  PermissionDecisionSource,
  PermissionDecisionValue,
  PermissionRequestStatus,
  PermissionRequestView,
  PermissionRisk,
} from '../src/types/permission'
import { PERMISSION_DEFAULT_TTL_SECONDS } from '../src/types/permission.ts'
import { redactSensitiveText } from './permission-redact.ts'

const DEFAULT_TTL_MS = PERMISSION_DEFAULT_TTL_SECONDS * 1000
const MIN_TTL_MS = 15_000
const MAX_TTL_MS = 300_000
const MAX_ACTION_LENGTH = 80
const MAX_DESCRIPTION_LENGTH = 280
const MAX_DETAIL_ITEMS = 5
const MAX_DETAIL_LENGTH = 120
const MAX_AUDIT_RECORDS = 500
// Cap on *active* requests. Finished requests are kept only briefly (replay
// protection + late polls) and then dropped, so a long-running app never fills up.
const DEFAULT_MAX_REQUEST_RECORDS = 5_000
const TERMINAL_RETENTION_MS = 10 * 60_000
const MAX_TERMINAL_RECORDS = 200
const MAX_ACTIVE_PER_SESSION = 20
const IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/

export type PermissionDeliveryResult = 'delivered' | 'already_resolved' | 'rejected'

export interface AdapterPermissionDecision {
  decisionId: string
  requestId: string
  generation: number
  decision: PermissionDecisionValue
  decidedAt: number
  decidedBy: PermissionDecisionSource
  brokerNonce: string
}

export interface PermissionAdapterPort {
  readonly id: string
  readonly capabilities: Pick<AgentCapabilities, 'permissions' | 'permissionModes'>
  respond(
    responseHandle: unknown,
    decision: Readonly<AdapterPermissionDecision>,
    signal: AbortSignal,
  ): Promise<PermissionDeliveryResult>
}

export interface PermissionRequestInput {
  requestId: string
  agentId: string
  sessionId: string
  projectId?: string
  generation: number
  action: string
  description: string
  /** Tool arguments (command, path globs). Bounded and redacted here. */
  details?: ReadonlyArray<string>
  risk?: PermissionRisk
  /** The tool reaches outside the machine (network / external directory). */
  network?: boolean
  ttlMs?: number
  allowedDecisions?: ReadonlyArray<PermissionDecisionValue>
  responseHandle: unknown
}

export type CreatePermissionResult =
  | { ok: true; request: PermissionRequestView }
  | {
    ok: false
    error:
      | 'adapter_unavailable'
      | 'capability_denied'
      | 'invalid_request'
      | 'duplicate_request'
      | 'capacity_exceeded'
  }

export type DecidePermissionResult =
  | { ok: true; status: PermissionRequestStatus }
  | { ok: false; error: 'not_found' | 'invalid_decision' | 'conflict'; status?: PermissionRequestStatus }

export type ExternalResolutionReason =
  | 'agent_resolved'
  | 'adapter_disconnected'
  | 'session_ended'
  | 'system_lock'
  | 'system_suspend'
  | 'broker_shutdown'

export interface PermissionAuditRecord {
  requestId: string
  adapterId: string
  agentId: string
  sessionId: string
  generation: number
  receivedAt: number
  resolvedAt: number
  status: PermissionRequestStatus
  decision?: PermissionDecisionValue
  decidedBy?: PermissionDecisionSource
  terminalReason: string
  /** Tool name and risk only; never the description or arguments. */
  action?: string
  risk?: PermissionRisk
}

interface RegisteredAdapter {
  id: string
  permissions: AgentCapabilities['permissions']
  permissionModes: ReadonlySet<PermissionDecisionValue>
  respond: PermissionAdapterPort['respond']
}

interface InternalPermissionRequest {
  requestId: string
  adapterId: string
  agentId: string
  sessionId: string
  projectId?: string
  generation: number
  action: string
  description: string
  details: ReadonlyArray<string>
  truncatedChars: number
  risk: PermissionRisk
  network: boolean
  receivedAt: number
  expiresAt: number
  status: PermissionRequestStatus
  allowedDecisions: ReadonlyArray<PermissionDecisionValue>
  truncated: boolean
  responseHandle: unknown
  adapter: RegisteredAdapter
  order: number
  finishedAt?: number
  deliveryAbort?: AbortController
}

export interface PermissionBrokerOptions {
  now?: () => number
  randomId?: () => string
  onChanged?: () => void
  onAudit?: (record: Readonly<PermissionAuditRecord>) => void
  maxRequestRecords?: number
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && IDENTIFIER_PATTERN.test(value)
}

function sanitizeText(
  value: unknown,
  maxLength: number,
): { value: string; truncated: boolean; omitted: number } {
  if (typeof value !== 'string') return { value: '', truncated: false, omitted: 0 }
  const normalized = redactSensitiveText(value
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim())
  return {
    value: normalized.slice(0, maxLength),
    truncated: normalized.length > maxLength,
    omitted: Math.max(0, normalized.length - maxLength),
  }
}

function isDecision(value: unknown): value is PermissionDecisionValue {
  return value === 'allow_once' || value === 'deny'
}

function isDecisionSource(value: unknown): value is PermissionDecisionSource {
  return value === 'bubble' || value === 'hotkey' || value === 'panel'
}

function isRisk(value: unknown): value is PermissionRisk {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'unknown'
}

// Fail-closed: a risk level must be listed here to be approvable by hotkey, so
// a level added later (or `unknown`) is excluded by default.
function isHotkeyRisk(risk: PermissionRisk): boolean {
  return risk === 'low' || risk === 'medium'
}

function clampTtl(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_TTL_MS
  return Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, Math.round(value)))
}

function isTerminal(status: PermissionRequestStatus): boolean {
  return status !== 'pending' && status !== 'deciding'
}

export class PermissionBroker {
  private readonly adapters = new Map<string, RegisteredAdapter>()
  private readonly requests = new Map<string, InternalPermissionRequest>()
  private readonly expiryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly audit: PermissionAuditRecord[] = []
  private readonly now: () => number
  private readonly randomId: () => string
  private readonly onChanged?: () => void
  private readonly onAudit?: (record: Readonly<PermissionAuditRecord>) => void
  private readonly maxRequestRecords: number
  private nextOrder = 0

  constructor(options: PermissionBrokerOptions = {}) {
    this.now = options.now ?? Date.now
    this.randomId = options.randomId ?? randomUUID
    this.onChanged = options.onChanged
    this.onAudit = options.onAudit
    this.maxRequestRecords = Number.isSafeInteger(options.maxRequestRecords)
      && (options.maxRequestRecords ?? 0) > 0
      ? options.maxRequestRecords!
      : DEFAULT_MAX_REQUEST_RECORDS
  }

  registerAdapter(port: PermissionAdapterPort): void {
    const permissions = port?.capabilities?.permissions
    const rawModes = port?.capabilities?.permissionModes
    if (
      !isIdentifier(port?.id)
      || this.adapters.has(port.id)
      || (permissions !== 'none' && permissions !== 'observe' && permissions !== 'respond')
      || !Array.isArray(rawModes)
      || typeof port?.respond !== 'function'
    ) {
      throw new Error('Invalid or duplicate permission adapter')
    }
    const validModes = rawModes.every(isDecision)
    const permissionModes = new Set(rawModes)
    const modesMatchCapability = permissions === 'respond'
      ? rawModes.length > 0
      : rawModes.length === 0
    if (!validModes || permissionModes.size !== rawModes.length || !modesMatchCapability) {
      throw new Error('Invalid permission adapter capability modes')
    }
    this.adapters.set(port.id, {
      id: port.id,
      permissions,
      permissionModes,
      respond: port.respond.bind(port),
    })
  }

  unregisterAdapter(adapterId: string): void {
    if (!this.adapters.delete(adapterId)) return
    let changed = false
    for (const request of this.requests.values()) {
      if (request.adapterId !== adapterId || isTerminal(request.status)) continue
      this.finish(request, 'cancelled', 'adapter_disconnected')
      changed = true
    }
    if (changed) this.emitChanged()
  }

  createRequest(adapterId: string, input: unknown): CreatePermissionResult {
    const adapter = this.adapters.get(adapterId)
    if (!adapter) return { ok: false, error: 'adapter_unavailable' }
    if (adapter.permissions !== 'respond') return { ok: false, error: 'capability_denied' }
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { ok: false, error: 'invalid_request' }
    }
    const candidate = input as Partial<PermissionRequestInput>
    if (
      !isIdentifier(candidate.requestId)
      || !isIdentifier(candidate.agentId)
      || !isIdentifier(candidate.sessionId)
      || (candidate.projectId !== undefined && !isIdentifier(candidate.projectId))
      || !Number.isSafeInteger(candidate.generation)
      || candidate.generation! < 1
      || candidate.responseHandle === undefined
      || candidate.responseHandle === null
      || (candidate.allowedDecisions !== undefined && !Array.isArray(candidate.allowedDecisions))
    ) {
      return { ok: false, error: 'invalid_request' }
    }
    if (this.requests.has(candidate.requestId)) return { ok: false, error: 'duplicate_request' }
    // One agent session cannot flood the queue and bury everyone else's requests.
    if (this.countActiveForSession(adapterId, candidate.sessionId) >= MAX_ACTIVE_PER_SESSION) {
      return { ok: false, error: 'capacity_exceeded' }
    }
    this.pruneTerminal()
    if (this.activeRequests().length >= this.maxRequestRecords) {
      return { ok: false, error: 'capacity_exceeded' }
    }

    const requestedDecisions = candidate.allowedDecisions ?? [...adapter.permissionModes]
    if (
      !requestedDecisions.every(isDecision)
      || new Set(requestedDecisions).size !== requestedDecisions.length
    ) {
      return { ok: false, error: 'invalid_request' }
    }
    const supportedDecisions = requestedDecisions.filter((value) => adapter.permissionModes.has(value))
    if (supportedDecisions.length === 0) return { ok: false, error: 'capability_denied' }

    const action = sanitizeText(candidate.action, MAX_ACTION_LENGTH)
    const description = sanitizeText(candidate.description, MAX_DESCRIPTION_LENGTH)
    if (!action.value || !description.value) return { ok: false, error: 'invalid_request' }
    const rawDetails = Array.isArray(candidate.details) ? candidate.details : []
    const details: string[] = []
    let truncatedChars = action.omitted + description.omitted
    let detailsTruncated = false
    rawDetails.forEach((item, index) => {
      const cleaned = sanitizeText(item, MAX_DETAIL_LENGTH)
      if (index >= MAX_DETAIL_ITEMS) {
        detailsTruncated = true
        truncatedChars += typeof item === 'string' ? item.length : 0
        return
      }
      if (!cleaned.value) return
      details.push(cleaned.value)
      truncatedChars += cleaned.omitted
      if (cleaned.truncated) detailsTruncated = true
    })

    const risk: PermissionRisk = isRisk(candidate.risk) ? candidate.risk : 'unknown'
    const truncated = action.truncated || description.truncated || detailsTruncated
    // A risky request whose arguments were cut off cannot be approved here: the user would be
    // allowing text they never saw. Deny stays available; allowing happens in the agent itself.
    const allowedDecisions = Object.freeze(truncated && !isHotkeyRisk(risk)
      ? supportedDecisions.filter((value) => value !== 'allow_once')
      : supportedDecisions)
    if (allowedDecisions.length === 0) return { ok: false, error: 'capability_denied' }

    const receivedAt = this.readNow()
    if (receivedAt === null) return { ok: false, error: 'invalid_request' }
    const request: InternalPermissionRequest = {
      requestId: candidate.requestId,
      adapterId,
      agentId: candidate.agentId,
      sessionId: candidate.sessionId,
      ...(candidate.projectId ? { projectId: candidate.projectId } : {}),
      generation: candidate.generation!,
      action: action.value,
      description: description.value,
      details: Object.freeze(details),
      truncatedChars,
      risk,
      network: candidate.network === true,
      receivedAt,
      expiresAt: receivedAt + clampTtl(candidate.ttlMs),
      status: 'pending',
      allowedDecisions,
      truncated,
      responseHandle: candidate.responseHandle,
      adapter,
      order: this.nextOrder++,
    }
    this.requests.set(request.requestId, request)
    this.scheduleExpiry(request)
    this.emitChanged()
    // 新請求的 order 最大，必定排在佇列最後，不需要再線性搜尋一次。
    const queueSize = this.activeRequests().length
    return { ok: true, request: this.toView(request, queueSize, queueSize) }
  }

  listRequests(): PermissionRequestView[] {
    this.expireDue()
    const active = this.activeRequests()
    return active.map((request, index) => this.toView(request, index + 1, active.length))
  }

  // 只需要布林判斷的呼叫端（例如拖曳輪詢、adapter decision 輪詢）不必為每個
  // 請求建立 view 物件。
  hasActiveRequests(): boolean {
    this.expireDue()
    for (const request of this.requests.values()) {
      if (!isTerminal(request.status)) return true
    }
    return false
  }

  isRequestActive(requestId: string): boolean {
    this.expireDue()
    const request = this.requests.get(requestId)
    return Boolean(request && !isTerminal(request.status))
  }

  async decide(
    requestId: string,
    decision: unknown,
    decidedBy: unknown,
  ): Promise<DecidePermissionResult> {
    if (!isDecision(decision) || !isDecisionSource(decidedBy)) {
      return { ok: false, error: 'invalid_decision' }
    }
    const request = this.requests.get(requestId)
    if (!request) return { ok: false, error: 'not_found' }

    if (request.status !== 'pending') {
      return { ok: false, error: 'conflict', status: request.status }
    }
    const startedAt = this.readNow()
    if (startedAt === null || startedAt >= request.expiresAt) {
      this.finish(request, 'expired', 'ttl')
      this.emitChanged()
      return { ok: false, error: 'conflict', status: 'expired' }
    }
    if (!request.allowedDecisions.includes(decision)) {
      return { ok: false, error: 'invalid_decision', status: request.status }
    }

    request.status = 'deciding'
    request.deliveryAbort = new AbortController()
    this.emitChanged()
    const adapterDecision: Readonly<AdapterPermissionDecision> = Object.freeze({
      decisionId: this.randomId(),
      requestId: request.requestId,
      generation: request.generation,
      decision,
      decidedAt: startedAt,
      decidedBy,
      brokerNonce: this.randomId(),
    })

    let delivery: PermissionDeliveryResult
    try {
      delivery = await request.adapter.respond(
        request.responseHandle,
        adapterDecision,
        request.deliveryAbort.signal,
      )
    } catch {
      if (request.status !== 'deciding') {
        return { ok: false, error: 'conflict', status: request.status }
      }
      this.finish(request, 'delivery_failed', 'adapter_error', decision, decidedBy)
      this.emitChanged()
      return { ok: true, status: 'delivery_failed' }
    }

    if (request.status !== 'deciding') {
      return { ok: false, error: 'conflict', status: request.status }
    }

    if (delivery === 'delivered') {
      const status = decision === 'allow_once' ? 'allowed' : 'denied'
      this.finish(request, status, 'delivered', decision, decidedBy)
      this.emitChanged()
      return { ok: true, status }
    }
    if (delivery === 'already_resolved') {
      this.finish(request, 'cancelled', 'already_resolved', decision, decidedBy)
      this.emitChanged()
      return { ok: true, status: 'cancelled' }
    }
    this.finish(request, 'delivery_failed', 'adapter_rejected', decision, decidedBy)
    this.emitChanged()
    return { ok: true, status: 'delivery_failed' }
  }

  resolveExternally(requestId: string, reason: ExternalResolutionReason): boolean {
    const request = this.requests.get(requestId)
    if (!request || isTerminal(request.status)) return false
    this.finish(request, 'cancelled', reason)
    this.emitChanged()
    return true
  }

  expireDue(now = this.readNow() ?? Number.POSITIVE_INFINITY): number {
    let expired = 0
    for (const request of this.requests.values()) {
      if (isTerminal(request.status) || now < request.expiresAt) continue
      this.finish(request, 'expired', 'ttl')
      expired += 1
    }
    if (expired > 0) this.emitChanged()
    return expired
  }

  shutdown(): void {
    let changed = false
    for (const request of this.requests.values()) {
      if (isTerminal(request.status)) continue
      this.finish(request, 'cancelled', 'broker_shutdown')
      changed = true
    }
    this.adapters.clear()
    for (const timer of this.expiryTimers.values()) clearTimeout(timer)
    this.expiryTimers.clear()
    if (changed) this.emitChanged()
  }

  getAuditRecords(): PermissionAuditRecord[] {
    return this.audit.map((record) => ({ ...record }))
  }

  private toView(
    request: InternalPermissionRequest,
    queuePosition: number,
    queueSize: number,
  ): PermissionRequestView {
    return {
      requestId: request.requestId,
      adapterId: request.adapterId,
      agentId: request.agentId,
      sessionId: request.sessionId,
      ...(request.projectId ? { projectId: request.projectId } : {}),
      generation: request.generation,
      action: request.action,
      description: request.description,
      details: [...request.details],
      truncatedChars: request.truncatedChars,
      risk: request.risk,
      network: request.network,
      receivedAt: request.receivedAt,
      expiresAt: request.expiresAt,
      status: request.status,
      allowedDecisions: [...request.allowedDecisions],
      queuePosition,
      queueSize,
      hotkeyEligible: request.status === 'pending'
        && isHotkeyRisk(request.risk)
        && !request.truncated,
      truncated: request.truncated,
    }
  }

  private finish(
    request: InternalPermissionRequest,
    status: PermissionRequestStatus,
    terminalReason: string,
    decision?: PermissionDecisionValue,
    decidedBy?: PermissionDecisionSource,
  ): void {
    const expiryTimer = this.expiryTimers.get(request.requestId)
    if (expiryTimer) {
      clearTimeout(expiryTimer)
      this.expiryTimers.delete(request.requestId)
    }
    request.deliveryAbort?.abort()
    request.deliveryAbort = undefined
    request.status = status
    request.finishedAt = this.readNow() ?? request.expiresAt
    const auditRecord: PermissionAuditRecord = {
      requestId: request.requestId,
      adapterId: request.adapterId,
      agentId: request.agentId,
      sessionId: request.sessionId,
      generation: request.generation,
      receivedAt: request.receivedAt,
      resolvedAt: this.readNow() ?? request.expiresAt,
      status,
      ...(decision ? { decision } : {}),
      ...(decidedBy ? { decidedBy } : {}),
      terminalReason,
      action: request.action,
      risk: request.risk,
    }
    this.audit.push(auditRecord)
    if (this.audit.length > MAX_AUDIT_RECORDS) this.audit.shift()
    try {
      this.onAudit?.(Object.freeze({ ...auditRecord }))
    } catch {
      // Audit persistence failure must not alter an already-terminal decision.
    }
  }

  private emitChanged(): void {
    try {
      this.onChanged?.()
    } catch {
      // Observers cannot interrupt the broker state transition.
    }
  }

  /**
   * Whether this agent session has a request that is still open or finished within `withinMs`.
   * Lets the main process tell a prompt that can be answered here from one that cannot.
   */
  hasRecentRequestForSession(adapterId: string, sessionId: string, withinMs: number): boolean {
    const now = this.readNow() ?? 0
    for (const request of this.requests.values()) {
      if (request.adapterId !== adapterId || request.sessionId !== sessionId) continue
      if (!isTerminal(request.status)) return true
      if (now - (request.finishedAt ?? 0) <= withinMs) return true
    }
    return false
  }

  /** Whether the broker still remembers this request (active or recently finished). */
  hasRecord(requestId: string): boolean {
    return this.requests.has(requestId)
  }

  private pruneTerminal(): void {
    const now = this.readNow() ?? 0
    const finished: InternalPermissionRequest[] = []
    for (const request of this.requests.values()) {
      if (isTerminal(request.status)) finished.push(request)
    }
    if (finished.length === 0) return
    // `finished` is in insertion order, so the oldest are first.
    const excess = Math.max(0, finished.length - MAX_TERMINAL_RECORDS)
    finished.forEach((request, index) => {
      const expired = now - (request.finishedAt ?? now) >= TERMINAL_RETENTION_MS
      if (index < excess || expired) this.requests.delete(request.requestId)
    })
  }

  private countActiveForSession(adapterId: string, sessionId: string): number {
    let count = 0
    for (const request of this.requests.values()) {
      if (!isTerminal(request.status) && request.adapterId === adapterId && request.sessionId === sessionId) count += 1
    }
    return count
  }

  // Map 依插入順序迭代，而 order 在插入時單調遞增且紀錄不會重新插入，
  // 因此迭代順序即為佇列順序，省去 O(n log n) 排序。
  private activeRequests(): InternalPermissionRequest[] {
    const active: InternalPermissionRequest[] = []
    for (const request of this.requests.values()) {
      if (!isTerminal(request.status)) active.push(request)
    }
    return active
  }

  private scheduleExpiry(request: InternalPermissionRequest): void {
    const now = this.readNow() ?? request.receivedAt
    const delay = Math.max(0, request.expiresAt - now)
    const timer = setTimeout(() => {
      this.expiryTimers.delete(request.requestId)
      const current = this.readNow() ?? Number.POSITIVE_INFINITY
      if (current < request.expiresAt && !isTerminal(request.status)) {
        this.scheduleExpiry(request)
        return
      }
      if (isTerminal(request.status)) return
      this.finish(request, 'expired', 'ttl')
      this.emitChanged()
    }, Math.min(delay, 2_147_483_647))
    timer.unref?.()
    this.expiryTimers.set(request.requestId, timer)
  }

  private readNow(): number | null {
    try {
      const value = this.now()
      return Number.isSafeInteger(value) && value >= 0 ? value : null
    } catch {
      return null
    }
  }
}
