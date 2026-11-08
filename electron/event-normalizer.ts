import type { AgentSource, AgentState, AgentStatusEvent, AgentTokenUsage } from '../src/types/agent'
import type { PermissionNotice } from '../src/types/capabilities'
import { parseHostHints } from './host-app.ts'

const EXTERNAL_ONLY_PERMISSION_NOTICE: Readonly<PermissionNotice> = Object.freeze({
  responseMode: 'external_only',
})

const MAX_SESSION_ID_LENGTH = 256
const MAX_TEXT_FIELD_LENGTH = 512
const MAX_TOKEN_COUNT = 1_000_000_000_000

const VALID_SOURCES = new Set([
  'opencode-cli', 'opencode-desktop',
  'opencode',
  'codex', 'codex-desktop',
  'claude', 'claude-desktop',
])

const VALID_STATES = new Set([
  'idle', 'thinking', 'tool-running',
  'waiting-permission', 'waiting-input', 'waiting',
  'success', 'error', 'offline',
])

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
  return (source === 'opencode' ? 'opencode-cli' : source) as AgentSource
}

function normalizeState(state: string): AgentState {
  return (state === 'waiting' ? 'waiting-permission' : state) as AgentState
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
