import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import * as path from 'node:path'
import type { PermissionDecisionValue, PermissionRisk } from '../src/types/permission'
import { FAMILY_SOURCES, familySourceSet, type SourceOfFamily } from '../src/types/agent.ts'
import { isOpaqueId128 as isIdentifier } from '../src/types/id-patterns.ts'
import { LOCAL_WIRE_HEADERS, LOCAL_WIRE_PATHS } from '../src/types/local-wire.ts'
import { hasJsonContentType, JSON_RESPONSE_HEADERS, readBoundedJson, sendJson, tokenMatches } from './loopback-http.ts'
import { isRecord } from './value-guards.ts'
import {
  PermissionBroker,
  type AdapterPermissionDecision,
  type PermissionAdapterPort,
  type PermissionDeliveryResult,
} from './permission-broker.ts'
import {
  CLAUDE_FILE_EDIT_TOOLS,
  classifyClaudeFileEdit,
  classifyClaudeToolRisk,
  classifyPermissionRisk,
  isClaudeNetworkTool,
  isNetworkPermission,
} from './permission-risk.ts'

// 與請求的 `${method} ${pathname}` 比對的路由 key；在載入時從契約組好一次。
const ROUTE_REQUEST = `POST ${LOCAL_WIRE_PATHS.permissionRequest}`
const ROUTE_DECISION = `POST ${LOCAL_WIRE_PATHS.permissionDecision}`
const ROUTE_RESULT = `POST ${LOCAL_WIRE_PATHS.permissionResult}`
const ROUTE_RESOLVED = `POST ${LOCAL_WIRE_PATHS.permissionResolved}`
const ROUTE_RESOLVED_SESSION = `POST ${LOCAL_WIRE_PATHS.permissionResolvedSession}`

const MAX_BODY_BYTES = 16 * 1024
// Per plugin instance (source + instanceId), so one noisy instance cannot use up
// another's budget; the per-host cap is a looser backstop for unparsed bodies.
const MAX_CREATE_REQUESTS_PER_MINUTE = 60
const MAX_CREATE_REQUESTS_PER_MINUTE_PER_HOST = 240
const MAX_BUDGET_WINDOWS = 256
const MAX_EXTERNAL_RECORDS = 400
// The broker applies the final display limits (and counts what it cuts); the
// adapter only bounds how much it accepts so memory use stays predictable.
const MAX_PATTERNS = 20
const MAX_PATTERN_LENGTH = 1_000
// 只有 OpenCode（插件回覆）與 Claude Code（hook 回覆）能從寵物回答權限；來源清單由來源 registry 推導。
export type PermissionAdapterSource = SourceOfFamily<'opencode' | 'claude'>
export const PERMISSION_ADAPTER_SOURCES: readonly PermissionAdapterSource[] = Object.freeze([
  ...FAMILY_SOURCES.opencode,
  ...FAMILY_SOURCES.claude,
])
const SOURCES: ReadonlySet<string> = new Set(PERMISSION_ADAPTER_SOURCES)
const CLAUDE_SOURCES = familySourceSet('claude')
// Claude's hook waits at most this long, so a request must not outlive it.
const MIN_CLAUDE_TTL_SECONDS = 15
const MAX_CLAUDE_TTL_SECONDS = 120
const MAX_CLAUDE_DETAIL_LENGTH = 1_000
const MAX_CLAUDE_PATH_LENGTH = 4_096
// One hook invocation owns a Claude request; its random nonce is required to read
// or acknowledge the decision, so one click can never answer two tool calls.
const NONCE_PATTERN = /^[a-f0-9]{32,64}$/

interface RelayHandle {
  relayKey: string
}

interface PendingDelivery {
  decision: Readonly<AdapterPermissionDecision>
  resolve: (result: PermissionDeliveryResult) => void
  reject: (error: Error) => void
  detachAbort: () => void
}

interface ExternalRequestRecord {
  brokerRequestId: string
  relayKey: string
  /** Claude only: the hook invocation that owns this request. */
  nonce?: string
  /** Claude only: main agent (`main`) or subagent id, for superseding older requests. */
  scope?: string
}

interface CreatePayload {
  source: PermissionAdapterSource
  instanceId: string
  permissionId: string
  sessionId: string
  project?: string
  permission: string
  title?: string
  patterns?: string[]
  /** Claude only: the command / path / URL being approved (sent by our hook). */
  detail?: string
  /** Claude only: how long the hook will wait for an answer. */
  ttlSeconds?: number
  /** Claude only (required): per-invocation random nonce. */
  nonce?: string
  /** Claude only: agent scope inside the session. */
  scope?: string
  /** Claude only: the edited file, classified against `cwd`; never shown as an absolute path. */
  filePath?: string
  cwd?: string
}

export class PermissionAdapterRelay {
  private readonly pending = new Map<string, PendingDelivery>()

  createPort(id: PermissionAdapterSource): PermissionAdapterPort {
    return {
      id,
      capabilities: {
        permissions: 'respond',
        permissionModes: ['allow_once', 'deny'],
      },
      respond: (handle, decision, signal) => this.respond(handle, decision, signal),
    }
  }

  poll(relayKey: string): Pick<AdapterPermissionDecision, 'decisionId' | 'decision'> | null {
    const delivery = this.pending.get(relayKey)
    if (!delivery) return null
    return {
      decisionId: delivery.decision.decisionId,
      decision: delivery.decision.decision,
    }
  }

  complete(
    relayKey: string,
    decisionId: string,
    result: PermissionDeliveryResult,
  ): boolean {
    const delivery = this.pending.get(relayKey)
    if (!delivery || delivery.decision.decisionId !== decisionId) return false
    this.pending.delete(relayKey)
    delivery.detachAbort()
    delivery.resolve(result)
    return true
  }

  shutdown(): void {
    for (const delivery of this.pending.values()) {
      delivery.detachAbort()
      delivery.reject(new Error('Permission adapter relay stopped'))
    }
    this.pending.clear()
  }

  private respond(
    handle: unknown,
    decision: Readonly<AdapterPermissionDecision>,
    signal: AbortSignal,
  ): Promise<PermissionDeliveryResult> {
    if (!isRelayHandle(handle) || this.pending.has(handle.relayKey) || signal.aborted) {
      return Promise.resolve('rejected')
    }

    return new Promise((resolve, reject) => {
      const onAbort = () => {
        const delivery = this.pending.get(handle.relayKey)
        if (!delivery || delivery.decision.decisionId !== decision.decisionId) return
        this.pending.delete(handle.relayKey)
        delivery.detachAbort()
        reject(new Error('Permission delivery aborted'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      this.pending.set(handle.relayKey, {
        decision,
        resolve,
        reject,
        detachAbort: () => signal.removeEventListener('abort', onAbort),
      })
    })
  }
}

export interface PermissionAdapterServerOptions {
  token: string
  broker: PermissionBroker
  relay: PermissionAdapterRelay
  now?: () => number
  randomId?: () => string
  /**
   * Main-process off switch per source. A disabled source cannot create new
   * requests (503, so the agent falls back to its own prompt). Defaults to on.
   */
  isSourceEnabled?: (source: PermissionAdapterSource) => boolean
}

export function createPermissionAdapterServer(options: PermissionAdapterServerOptions): Server {
  const now = options.now ?? Date.now
  const randomId = options.randomId ?? randomUUID
  const records = new Map<string, ExternalRequestRecord>()
  const createWindows = new Map<string, { startedAt: number; count: number }>()
  const expectedToken = Buffer.from(options.token)

  return createServer(async (request, response) => {
    setSecurityHeaders(response)
    if (request.headers.origin) {
      sendJson(response, 403, { error: 'browser_origins_forbidden' })
      return
    }
    if (!isLoopback(request.socket.remoteAddress)) {
      sendJson(response, 403, { error: 'forbidden' })
      return
    }
    if (!tokenMatches(request.headers[LOCAL_WIRE_HEADERS.permissionToken], expectedToken)) {
      sendJson(response, 401, { error: 'unauthorized' })
      return
    }
    if (!hasJsonContentType(request)) {
      sendJson(response, 415, { error: 'application_json_required' })
      return
    }

    const route = `${request.method ?? ''} ${request.url?.split('?')[0] ?? ''}`
    if (route === ROUTE_REQUEST) {
      if (!consumeCreateBudget(createWindows, `host:${request.socket.remoteAddress ?? 'loopback'}`, now(), MAX_CREATE_REQUESTS_PER_MINUTE_PER_HOST)) {
        sendJson(response, 429, { error: 'rate_limited' })
        return
      }
      const body = await readJsonBody(request)
      const payload = normalizeCreatePayload(body)
      if (!payload) {
        sendJson(response, 400, { error: 'invalid_request' })
        return
      }
      if (!consumeCreateBudget(createWindows, `instance:${payload.source}:${payload.instanceId}`, now(), MAX_CREATE_REQUESTS_PER_MINUTE)) {
        sendJson(response, 429, { error: 'rate_limited' })
        return
      }

      if (options.isSourceEnabled && !options.isSourceEnabled(payload.source)) {
        sendJson(response, 503, { error: 'source_disabled' })
        return
      }

      const externalKey = toExternalKey(payload.source, payload.instanceId, payload.permissionId)
      const existing = records.get(externalKey)
      // A Claude ID is derived from the request content, so the same command
      // asked again after the first one finished maps to the same key. Only a
      // still-active record is reused; a finished one is replaced by a fresh
      // request instead of handing back a request that can never be answered.
      const isClaude = CLAUDE_SOURCES.has(payload.source)
      if (existing && (!isClaude || options.broker.isRequestActive(existing.brokerRequestId))) {
        // Another invocation asking the same thing at the same time (parallel subagents running
        // the same command) does not share this request: it stays silent and Claude Code asks
        // in the terminal, so a single click answers exactly one tool call.
        if (isClaude && existing.nonce !== payload.nonce) {
          sendJson(response, 409, { error: 'in_use' })
          return
        }
        sendJson(response, 200, { requestId: existing.brokerRequestId })
        return
      }
      // A new Claude prompt in the same agent scope means any older one was answered in the
      // terminal (Claude Code asks one at a time), so its bubble and hotkeys come down.
      if (isClaude) resolveScope(records, options.broker, payload.source, payload.instanceId, payload.scope)

      const relayKey = randomId()
      const brokerRequestId = randomId()
      const edit = claudeFileEdit(payload)
      const projectId = sanitizeProjectId(payload.project)
      const created = options.broker.createRequest(payload.source, {
        requestId: brokerRequestId,
        agentId: payload.source,
        sessionId: payload.sessionId,
        ...(projectId ? { projectId } : {}),
        generation: 1,
        action: payload.permission,
        description: describePermission(payload, edit),
        ...(payload.title && payload.patterns?.length ? { details: payload.patterns } : {}),
        ...requestPolicy(payload, edit),
        allowedDecisions: ['allow_once', 'deny'],
        responseHandle: { relayKey } satisfies RelayHandle,
      })
      if (!created.ok) {
        const status = created.error === 'capacity_exceeded' ? 503 : 400
        sendJson(response, status, { error: created.error })
        return
      }
      // Drop index entries whose broker request has been forgotten, so the
      // external index cannot grow for the lifetime of the app.
      if (records.size >= MAX_EXTERNAL_RECORDS) {
        for (const [key, record] of records) {
          if (!options.broker.hasRecord(record.brokerRequestId)) records.delete(key)
        }
      }
      records.set(externalKey, {
        brokerRequestId,
        relayKey,
        ...(payload.nonce ? { nonce: payload.nonce } : {}),
        ...(payload.scope ? { scope: payload.scope } : {}),
      })
      sendJson(response, 201, { requestId: brokerRequestId })
      return
    }

    if (route === ROUTE_DECISION) {
      const lookup = normalizeLookupPayload(await readJsonBody(request))
      if (!lookup) {
        sendJson(response, 400, { error: 'invalid_request' })
        return
      }
      const record = records.get(toExternalKey(lookup.source, lookup.instanceId, lookup.permissionId))
      if (!record) {
        sendJson(response, 404, { error: 'not_found' })
        return
      }
      if (record.nonce !== undefined && record.nonce !== lookup.nonce) {
        sendJson(response, 409, { error: 'conflict' })
        return
      }
      const decision = options.relay.poll(record.relayKey)
      if (!decision) {
        if (!options.broker.isRequestActive(record.brokerRequestId)) {
          sendJson(response, 410, { error: 'resolved' })
          return
        }
        response.statusCode = 204
        response.end()
        return
      }
      sendJson(response, 200, decision)
      return
    }

    if (route === ROUTE_RESULT) {
      const result = normalizeResultPayload(await readJsonBody(request))
      if (!result) {
        sendJson(response, 400, { error: 'invalid_request' })
        return
      }
      const record = records.get(toExternalKey(result.source, result.instanceId, result.permissionId))
      if (
        !record
        || (record.nonce !== undefined && record.nonce !== result.nonce)
        || !options.relay.complete(record.relayKey, result.decisionId, result.result)
      ) {
        sendJson(response, 409, { error: 'conflict' })
        return
      }
      response.statusCode = 204
      response.end()
      return
    }

    if (route === ROUTE_RESOLVED) {
      const lookup = normalizeLookupPayload(await readJsonBody(request))
      if (!lookup) {
        sendJson(response, 400, { error: 'invalid_request' })
        return
      }
      const record = records.get(toExternalKey(lookup.source, lookup.instanceId, lookup.permissionId))
      if (!record) {
        response.statusCode = 204
        response.end()
        return
      }
      options.broker.resolveExternally(record.brokerRequestId, 'agent_resolved')
      response.statusCode = 204
      response.end()
      return
    }

    // Claude has no per-request "answered in the terminal" event; when a turn
    // or session ends, everything still pending for that session is settled.
    if (route === ROUTE_RESOLVED_SESSION) {
      const lookup = normalizeSessionLookupPayload(await readJsonBody(request))
      if (!lookup) {
        sendJson(response, 400, { error: 'invalid_request' })
        return
      }
      resolveScope(records, options.broker, lookup.source, lookup.instanceId, lookup.scope)
      response.statusCode = 204
      response.end()
      return
    }

    sendJson(response, 404, { error: 'not_found' })
  })
}

function isRelayHandle(value: unknown): value is RelayHandle {
  return isRecord(value) && isIdentifier(value.relayKey)
}

function normalizeCreatePayload(data: unknown): CreatePayload | null {
  if (!isRecord(data)) return null
  if (
    typeof data.source !== 'string'
    || !SOURCES.has(data.source)
    || !isIdentifier(data.instanceId)
    || !isIdentifier(data.permissionId)
    || !isIdentifier(data.sessionId)
  ) return null

  const permission = sanitizeText(data.permission, 80)
  if (!permission) return null
  const title = sanitizeText(data.title, 160)
  const patterns = Array.isArray(data.patterns)
    ? data.patterns.slice(0, MAX_PATTERNS).map((item) => sanitizeText(item, MAX_PATTERN_LENGTH)).filter(Boolean)
    : []
  if (data.patterns !== undefined && !Array.isArray(data.patterns)) return null
  const isClaude = CLAUDE_SOURCES.has(data.source)
  if (isClaude && (typeof data.nonce !== 'string' || !NONCE_PATTERN.test(data.nonce))) return null
  if (isClaude && data.scope !== undefined && !isIdentifier(data.scope)) return null
  const detail = isClaude ? sanitizeText(data.detail, MAX_CLAUDE_DETAIL_LENGTH) : ''
  const filePath = isClaude && typeof data.filePath === 'string' && data.filePath.length <= MAX_CLAUDE_PATH_LENGTH ? data.filePath : undefined
  // The full cwd is kept only for classification; a cut-off cwd could make an outside path look inside.
  const cwd = isClaude && typeof data.project === 'string' && data.project.length <= MAX_CLAUDE_PATH_LENGTH ? data.project : undefined
  const ttlSeconds = isClaude && typeof data.ttlSeconds === 'number' && Number.isFinite(data.ttlSeconds)
    ? Math.min(MAX_CLAUDE_TTL_SECONDS, Math.max(MIN_CLAUDE_TTL_SECONDS, Math.round(data.ttlSeconds)))
    : undefined

  return {
    source: data.source as CreatePayload['source'],
    instanceId: data.instanceId,
    permissionId: data.permissionId,
    sessionId: data.sessionId,
    ...(typeof data.project === 'string' ? { project: data.project.slice(0, 512) } : {}),
    permission,
    ...(title ? { title } : {}),
    ...(patterns.length > 0 ? { patterns } : {}),
    ...(detail ? { detail } : {}),
    ...(ttlSeconds !== undefined ? { ttlSeconds } : {}),
    ...(isClaude ? { nonce: data.nonce as string, scope: typeof data.scope === 'string' ? data.scope : 'main' } : {}),
    ...(filePath ? { filePath } : {}),
    ...(cwd ? { cwd } : {}),
  }
}

function normalizeSessionLookupPayload(data: unknown): (Pick<CreatePayload, 'source' | 'instanceId'> & { scope?: string }) | null {
  if (!isRecord(data)) return null
  if (typeof data.source !== 'string' || !SOURCES.has(data.source) || !isIdentifier(data.instanceId)) return null
  if (data.scope !== undefined && !isIdentifier(data.scope)) return null
  return {
    source: data.source as CreatePayload['source'],
    instanceId: data.instanceId,
    ...(typeof data.scope === 'string' ? { scope: data.scope } : {}),
  }
}

/** Settles pending requests of one Claude session, or only one agent scope inside it. */
function resolveScope(
  records: Map<string, ExternalRequestRecord>,
  broker: PermissionBroker,
  source: string,
  instanceId: string,
  scope: string | undefined,
): void {
  const prefix = `${source}:${instanceId}:`
  for (const [key, record] of records) {
    if (!key.startsWith(prefix) || (scope !== undefined && record.scope !== scope)) continue
    broker.resolveExternally(record.brokerRequestId, 'agent_resolved')
  }
}

function normalizeLookupPayload(data: unknown): (Pick<CreatePayload, 'source' | 'instanceId' | 'permissionId'> & { nonce?: string }) | null {
  if (!isRecord(data)) return null
  if (
    typeof data.source !== 'string'
    || !SOURCES.has(data.source)
    || !isIdentifier(data.instanceId)
    || !isIdentifier(data.permissionId)
  ) return null
  return {
    source: data.source as CreatePayload['source'],
    instanceId: data.instanceId,
    permissionId: data.permissionId,
    ...(typeof data.nonce === 'string' && NONCE_PATTERN.test(data.nonce) ? { nonce: data.nonce } : {}),
  }
}

function normalizeResultPayload(data: unknown): (
  Pick<CreatePayload, 'source' | 'instanceId' | 'permissionId'>
  & { nonce?: string; decisionId: string; result: PermissionDeliveryResult }
) | null {
  const lookup = normalizeLookupPayload(data)
  if (!lookup || !isRecord(data)) return null
  if (!isIdentifier(data.decisionId) || !isDeliveryResult(data.result)) return null
  return { ...lookup, decisionId: data.decisionId, result: data.result }
}

function isDeliveryResult(value: unknown): value is PermissionDeliveryResult {
  return value === 'delivered' || value === 'already_resolved' || value === 'rejected'
}

function sanitizeText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function sanitizeProjectId(project: string | undefined): string | undefined {
  if (!project) return undefined
  const base = path.basename(project).replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 128)
  return isIdentifier(base) ? base : undefined
}

function describePermission(payload: CreatePayload, edit: FileEdit | null): string {
  if (CLAUDE_SOURCES.has(payload.source)) {
    if (edit?.relativePath) return edit.relativePath
    return payload.detail || `Claude Code requests ${payload.permission} permission.`
  }
  if (payload.title) return payload.title
  if (payload.patterns?.length) return payload.patterns.join(', ')
  return `OpenCode requests ${payload.permission} permission.`
}

function requestPolicy(payload: CreatePayload, edit: FileEdit | null): { risk: PermissionRisk; network: boolean; ttlMs?: number } {
  if (CLAUDE_SOURCES.has(payload.source)) {
    return {
      risk: edit?.risk ?? classifyClaudeToolRisk(payload.permission),
      network: isClaudeNetworkTool(payload.permission),
      ...(payload.ttlSeconds !== undefined ? { ttlMs: payload.ttlSeconds * 1000 } : {}),
    }
  }
  return {
    risk: classifyPermissionRisk(payload.permission),
    network: isNetworkPermission(payload.permission),
  }
}

type FileEdit = ReturnType<typeof classifyClaudeFileEdit>

// Runs only when a Claude edit request is created (rate-limited), never on the event path.
function claudeFileEdit(payload: CreatePayload): FileEdit | null {
  if (!CLAUDE_SOURCES.has(payload.source) || !CLAUDE_FILE_EDIT_TOOLS.has(payload.permission)) return null
  return classifyClaudeFileEdit(payload.filePath, payload.cwd, path, safeRealpath)
}

function safeRealpath(value: string): string | null {
  try {
    return fs.realpathSync.native(value)
  } catch {
    return null
  }
}

function toExternalKey(source: string, instanceId: string, permissionId: string): string {
  return `${source}:${instanceId}:${permissionId}`
}

function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/**
 * 這個 server 的 client 不區分 body 失敗的原因：過大、空 body、錯誤 JSON 與中斷都回 null，
 * 由各路由的 normalize 函式轉成 400 `invalid_request`（沒有 413）。
 */
async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const body = await readBoundedJson(request, MAX_BODY_BYTES)
  return body.ok ? body.value : null
}

/** 先設好，讓沒有 body 的 204 回應也帶同一組 header。 */
function setSecurityHeaders(response: ServerResponse): void {
  for (const [name, value] of Object.entries(JSON_RESPONSE_HEADERS)) response.setHeader(name, value)
}

function consumeCreateBudget(
  windows: Map<string, { startedAt: number; count: number }>,
  key: string,
  now: number,
  limit: number,
): boolean {
  const current = windows.get(key)
  if (!current || now - current.startedAt >= 60_000 || now < current.startedAt) {
    if (windows.size >= MAX_BUDGET_WINDOWS) {
      for (const [existingKey, window] of windows) {
        if (now - window.startedAt >= 60_000 || now < window.startedAt) windows.delete(existingKey)
      }
    }
    windows.set(key, { startedAt: now, count: 1 })
    return true
  }
  if (current.count >= limit) return false
  current.count += 1
  return true
}

export function mapOpenCodeDecision(decision: PermissionDecisionValue): 'once' | 'reject' {
  return decision === 'allow_once' ? 'once' : 'reject'
}
