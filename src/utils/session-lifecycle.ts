import type { AgentSession } from '@/types/agent'

/** No update for this long means the agent process most likely died silently. */
export const SESSION_STALE_MS = 15 * 60_000
/** A session that has been silent this long is dropped entirely (it was marked offline earlier). */
export const SESSION_REMOVE_MS = 45 * 60_000

export type SessionLifecycleAction = 'offline' | 'remove' | null

export interface SessionLifecycleContext {
  /** True while the permission broker still has an unanswered request. */
  hasPendingPermission: boolean
}

/**
 * Decides what the periodic sweep should do with one session.
 * A `waiting-permission` session is waiting on a human, not dead, so it is
 * kept alive for as long as a request is actually pending.
 */
export function sessionLifecycleAction(
  session: Pick<AgentSession, 'state' | 'lastSeenAt'>,
  now: number,
  context: SessionLifecycleContext,
): SessionLifecycleAction {
  const silentFor = now - session.lastSeenAt
  if (session.state === 'offline') return silentFor > SESSION_REMOVE_MS ? 'remove' : null
  if (silentFor <= SESSION_STALE_MS) return null
  if (session.state === 'waiting-permission' && context.hasPendingPermission) return null
  return 'offline'
}
