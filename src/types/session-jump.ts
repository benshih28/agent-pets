// Renderer <-> main contract for the per-session "jump back" actions. The renderer names a session
// only by its source and session id; the project path and app bundle id never leave main.

export const SESSION_JUMP_ACTIONS = ['switch-app', 'show-folder', 'copy-path'] as const

export type SessionJumpAction = typeof SESSION_JUMP_ACTIONS[number]

export type SessionJumpError =
  | 'disabled'
  | 'unsupported'
  | 'unknown_session'
  | 'unavailable'
  | 'rate_limited'
  | 'failed'
  | 'invalid_request'

export type SessionJumpResult = { ok: true } | { ok: false; error: SessionJumpError }

export interface SessionJumpRequest {
  action: SessionJumpAction
  source: string
  sessionId: string
}

export function isSessionJumpAction(value: unknown): value is SessionJumpAction {
  return typeof value === 'string' && (SESSION_JUMP_ACTIONS as ReadonlyArray<string>).includes(value)
}
