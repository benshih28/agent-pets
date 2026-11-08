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

/** Added by the main process to the top request when a global shortcut applies. */
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
  /** Number of characters dropped from description/details; 0 when nothing was cut. */
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

/**
 * Renderer-side result of a request that has left the broker's active queue.
 * It carries no request content beyond the already-sanitized action label, so
 * it is safe to keep around for a few seconds after the request is gone.
 */
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

/** What `decidePermission` reports back to its caller. */
export type PermissionDecideResult =
  | { ok: true; status: 'allowed' | 'denied' }
  | { ok: false; kind: PermissionOutcomeKind }

/** Default lifetime of a permission request; shared so UI copy can quote it. */
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

// Claude Code shows its own permission dialog while our hook waits (verified
// on 2.1.314 in an interactive terminal), so a long wait never blocks the user.
export const CLAUDE_PERMISSION_WAIT_DEFAULT_SECONDS = 90
export const CLAUDE_PERMISSION_WAIT_MIN_SECONDS = 15
export const CLAUDE_PERMISSION_WAIT_MAX_SECONDS = 120
/**
 * Claude Code's hook timeout for our PermissionRequest handler. Fixed above the
 * largest allowed wait, so changing the wait never needs a settings.json rewrite
 * and the hook can never be cut off before it has answered.
 */
export const CLAUDE_PERMISSION_HOOK_TIMEOUT_SECONDS = CLAUDE_PERMISSION_WAIT_MAX_SECONDS + 15

export function clampClaudePermissionWaitSeconds(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return CLAUDE_PERMISSION_WAIT_DEFAULT_SECONDS
  return Math.min(CLAUDE_PERMISSION_WAIT_MAX_SECONDS, Math.max(CLAUDE_PERMISSION_WAIT_MIN_SECONDS, Math.round(value)))
}
