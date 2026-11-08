import type {
  PermissionDecideResult,
  PermissionOutcomeKind,
  PermissionRequestStatus,
  PermissionRequestView,
} from '@/types/permission'

/** Remaining time is shown in the warning style below this threshold. */
export const PERMISSION_URGENT_MS = 15_000

const EXPIRY_SLACK_MS = 2_000

/** How long a finished request's result stays visible in the bubble. */
export const PERMISSION_OUTCOME_VISIBLE_MS = 5_000
export const PERMISSION_FAILURE_VISIBLE_MS = 8_000

/** Formats a duration as m:ss (never 83.4s). Negative values clamp to 0:00. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil((Number.isFinite(ms) ? ms : 0) / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function permissionRemainingMs(
  request: Pick<PermissionRequestView, 'expiresAt'>,
  now: number,
): number {
  return Math.max(0, request.expiresAt - now)
}

/** 0..1 fraction of the request's lifetime that is left. */
export function permissionRemainingFraction(
  request: Pick<PermissionRequestView, 'expiresAt' | 'receivedAt'>,
  now: number,
): number {
  const total = request.expiresAt - request.receivedAt
  if (!(total > 0)) return 0
  return Math.min(1, Math.max(0, (request.expiresAt - now) / total))
}

export function permissionIsUrgent(
  request: Pick<PermissionRequestView, 'expiresAt'>,
  now: number,
): boolean {
  return permissionRemainingMs(request, now) < PERMISSION_URGENT_MS
}

/**
 * A request that left the active list without us deciding it either ran out
 * of time or was resolved elsewhere (agent answered, adapter disconnected).
 */
export function inferVanishedOutcome(
  request: Pick<PermissionRequestView, 'expiresAt'>,
  now: number,
): PermissionOutcomeKind {
  // The broker's expiry timer fires at expiresAt and the broadcast lands a
  // moment later, so allow a little slack for IPC latency.
  return now >= request.expiresAt - EXPIRY_SLACK_MS ? 'expired' : 'cancelled'
}

export function outcomeVisibleMs(kind: PermissionOutcomeKind): number {
  return kind === 'delivery_failed' || kind === 'error' ? PERMISSION_FAILURE_VISIBLE_MS : PERMISSION_OUTCOME_VISIBLE_MS
}

/** Maps the `permissionDecide` IPC response onto what the UI should do next. */
export function classifyDecideResponse(
  response: { ok: boolean; status?: PermissionRequestStatus; error?: string } | null | undefined,
): PermissionDecideResult {
  if (!response) return { ok: false, kind: 'error' }
  const { status } = response
  if (response.ok && (status === 'allowed' || status === 'denied')) return { ok: true, status }
  if (status === 'delivery_failed') return { ok: false, kind: 'delivery_failed' }
  if (status === 'expired') return { ok: false, kind: 'expired' }
  // The agent (or another window) already answered this request.
  if (status === 'cancelled' || status === 'allowed' || status === 'denied') return { ok: false, kind: 'cancelled' }
  return { ok: false, kind: response.error === 'conflict' ? 'conflict' : 'error' }
}

/** Buttons stay inert this long after a request appears, so a click aimed at the previous one cannot land on it. */
export const PERMISSION_CLICK_GUARD_MS = 300

export function isPermissionClickArmed(shownAt: number, now: number): boolean {
  return now - shownAt >= PERMISSION_CLICK_GUARD_MS
}

export interface PermissionQueueGroup {
  /** First request of the group; its requestId is the group's identity. */
  first: PermissionRequestView
  requestIds: string[]
  count: number
}

/**
 * Folds consecutive requests of the same session asking for the same action
 * with the same content. Each request keeps its own id: folding only changes
 * how the list is drawn, never what a decision applies to.
 */
export function groupPermissionRequests(requests: ReadonlyArray<PermissionRequestView>): PermissionQueueGroup[] {
  const groups: PermissionQueueGroup[] = []
  for (const request of requests) {
    const last = groups[groups.length - 1]
    if (
      last
      && last.first.agentId === request.agentId
      && last.first.sessionId === request.sessionId
      && last.first.action === request.action
      && last.first.description === request.description
      && last.first.details.join('\n') === request.details.join('\n')
    ) {
      last.requestIds.push(request.requestId)
      last.count += 1
    } else {
      groups.push({ first: request, requestIds: [request.requestId], count: 1 })
    }
  }
  return groups
}
