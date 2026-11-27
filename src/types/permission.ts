export type PermissionDecisionValue = 'allow_once' | 'deny'

export type PermissionDecisionSource = 'bubble' | 'panel' | 'hotkey'

export type PermissionRisk = 'low' | 'medium' | 'high' | 'unknown'

export type PermissionRequestStatus =
  | 'pending'
  | 'deciding'
  | 'allowed'
  | 'denied'
  | 'expired'
  | 'cancelled'
  | 'delivery_failed'

export interface PermissionHotkeyInfo {
  /** `unavailable`: another program owns the shortcut, so it must not be advertised. */
  status: 'active' | 'unavailable'
  allowLabel: string
  denyLabel: string
}

export interface PermissionRequestView {
  requestId: string
  adapterId: string
  agentId: string
  sessionId: string
  projectId?: string
  generation: number
  action: string
  description: string
  /** Sanitized, redacted tool arguments (command / path globs), at most 5 x 120 chars. */
  details: ReadonlyArray<string>
  truncatedChars: number
  risk: PermissionRisk
  /** The tool reaches outside the machine (network or external directory). */
  network: boolean
  receivedAt: number
  expiresAt: number
  status: PermissionRequestStatus
  allowedDecisions: ReadonlyArray<PermissionDecisionValue>
  queuePosition: number
  queueSize: number
  hotkeyEligible: boolean
  hotkey?: PermissionHotkeyInfo
  truncated: boolean
}

/** Carries no request content beyond the sanitized action label, so it is safe to keep after the request is gone. */
export type PermissionOutcomeKind =
  | 'expired'
  | 'cancelled'
  | 'delivery_failed'
  | 'conflict'
  | 'error'

export interface PermissionOutcome {
  kind: PermissionOutcomeKind
  requestId: string
  agentId: string
  action: string
  projectId?: string
  at: number
}

export type PermissionDecideResult =
  | { ok: true; status: 'allowed' | 'denied' }
  | { ok: false; kind: PermissionOutcomeKind }

export const PERMISSION_DEFAULT_TTL_SECONDS = 60

/** What the settings page may show about a past request: no ids, no content. */
export interface PermissionAuditEntry {
  resolvedAt: number
  agentId: string
  action: string
  risk: PermissionRisk
  status: PermissionRequestStatus
  decidedBy?: PermissionDecisionSource
  terminalReason: string
}

// Claude Code shows its own permission dialog while our hook waits, so a long wait never blocks the user.
export const CLAUDE_PERMISSION_WAIT_DEFAULT_SECONDS = 90
export const CLAUDE_PERMISSION_WAIT_MIN_SECONDS = 15
export const CLAUDE_PERMISSION_WAIT_MAX_SECONDS = 120
/** Fixed above the largest allowed wait so the hook is never cut off before it answers. */
export const CLAUDE_PERMISSION_HOOK_TIMEOUT_SECONDS = CLAUDE_PERMISSION_WAIT_MAX_SECONDS + 15

export function clampClaudePermissionWaitSeconds(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return CLAUDE_PERMISSION_WAIT_DEFAULT_SECONDS
  return Math.min(CLAUDE_PERMISSION_WAIT_MAX_SECONDS, Math.max(CLAUDE_PERMISSION_WAIT_MIN_SECONDS, Math.round(value)))
}
