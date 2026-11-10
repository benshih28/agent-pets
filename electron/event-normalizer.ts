import type { AgentSource, AgentState, AgentStatusEvent, AgentTokenUsage } from '../src/types/agent'
import { AGENT_STATES, ALL_SOURCES } from '../src/types/agent.ts'
import { EXTERNAL_ONLY_PERMISSION_NOTICE } from '../src/types/capabilities.ts'
import { parseHostHints } from './host-app.ts'

const MAX_SESSION_ID_LENGTH = 256
const MAX_TEXT_FIELD_LENGTH = 512
const MAX_TOKEN_COUNT = 1_000_000_000_000

// 'opencode' 是舊版 OpenCode 插件送的來源，正規化成 opencode-cli；其餘來源以來源 registry 為準。
const LEGACY_OPENCODE_SOURCE = 'opencode'
const VALID_SOURCES: ReadonlySet<string> = new Set([...ALL_SOURCES, LEGACY_OPENCODE_SOURCE])

// 'waiting' 是舊版 hook 送的狀態，下面正規化成 waiting-permission；其餘狀態以狀態 registry 為準。
const LEGACY_WAITING_STATE = 'waiting'
const VALID_STATES: ReadonlySet<string> = new Set([...AGENT_STATES, LEGACY_WAITING_STATE])

export type EventNormalizationError =
  | 'event must be an object'
  | 'missing required fields'
  | 'invalid source'
  | 'invalid state'
  | 'invalid sessionId'

export type EventNormalizationResult =
  | { ok: true; event: AgentStatusEvent }
  | { ok: false; error: EventNormalizationError }

function normalizeSource(source: string): AgentSource {
  return (source === LEGACY_OPENCODE_SOURCE ? 'opencode-cli' : source) as AgentSource
}

function normalizeState(state: string): AgentState {
  return (state === LEGACY_WAITING_STATE ? 'waiting-permission' : state) as AgentState
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' ? value.slice(0, MAX_TEXT_FIELD_LENGTH) : undefined
}

function optionalTokenUsage(value: unknown): AgentTokenUsage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  if (raw.quality !== 'estimated' && raw.quality !== 'exact') return undefined
  const input = typeof raw.input === 'number' && Number.isSafeInteger(raw.input) && raw.input >= 0 && raw.input <= MAX_TOKEN_COUNT
    ? raw.input
    : undefined
  const output = typeof raw.output === 'number' && Number.isSafeInteger(raw.output) && raw.output >= 0 && raw.output <= MAX_TOKEN_COUNT
    ? raw.output
    : undefined
  if (input === undefined && output === undefined) return undefined
  return { quality: raw.quality, ...(input === undefined ? {} : { input }), ...(output === undefined ? {} : { output }) }
}

export function normalizeAgentStatusEvent(
  value: unknown,
  receivedAt = Date.now(),
): EventNormalizationResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'event must be an object' }
  }

  const raw = value as Record<string, unknown>
  if (
    typeof raw.source !== 'string'
    || typeof raw.sessionId !== 'string'
    || typeof raw.state !== 'string'
    || typeof raw.timestamp !== 'number'
    || !Number.isFinite(raw.timestamp)
  ) {
    return { ok: false, error: 'missing required fields' }
  }

  if (!VALID_SOURCES.has(raw.source)) return { ok: false, error: 'invalid source' }
  if (!VALID_STATES.has(raw.state)) return { ok: false, error: 'invalid state' }
  if (raw.sessionId.length === 0 || raw.sessionId.length > MAX_SESSION_ID_LENGTH) {
    return { ok: false, error: 'invalid sessionId' }
  }

  const state = normalizeState(raw.state)
  const project = typeof raw.project === 'string'
    ? (raw.project.split(/[/\\]/).pop() || raw.project).slice(0, MAX_TEXT_FIELD_LENGTH)
    : undefined
  const toolName = optionalText(raw.toolName)
  const originalEvent = optionalText(raw.originalEvent)
  const eventId = optionalText(raw.eventId)
  const sourceEventId = optionalText(raw.sourceEventId)
  const tokenUsage = optionalTokenUsage(raw.tokenUsage)
  // Only the allowlisted app id goes on the event; the bundle id is read separately by main.
  const host = parseHostHints(raw.host)?.host

  const event: AgentStatusEvent = {
    source: normalizeSource(raw.source),
    sessionId: raw.sessionId,
    state,
    timestamp: Number.isFinite(receivedAt) ? receivedAt : Date.now(),
    ...(eventId ? { eventId } : {}),
    ...(sourceEventId ? { sourceEventId } : {}),
    ...(project ? { project } : {}),
    ...(toolName ? { toolName } : {}),
    ...(tokenUsage ? { tokenUsage } : {}),
    ...(host ? { host } : {}),
    ...(originalEvent ? { originalEvent } : {}),
    ...(state === 'waiting-permission'
      ? { permissionNotice: { ...EXTERNAL_ONLY_PERMISSION_NOTICE } }
      : {}),
  }

  return { ok: true, event }
}
