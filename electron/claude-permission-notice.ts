import type { AdapterNormalizeResult } from '../src/types/agent-adapter'

const CLAUDE_SOURCES: ReadonlySet<string> = new Set(['claude', 'claude-desktop'])

// How long after a pet request finished a Claude "waiting for permission" event still counts
// as answerable here (Claude's Notification hook can trail the decision by a few seconds).
export const CLAUDE_ANSWERABLE_GRACE_MS = 10_000

export interface AnswerableClaudeNoticeContext {
  /** Main-process preference: answering Claude Code permissions from the pet is on. */
  enabled: boolean
  /** The broker holds a live, or just finished, request for this agent session. */
  hasRecentRequest: (source: string, sessionId: string) => boolean
}

/**
 * A Claude prompt that the pet can answer is not "external only": drop that notice so the
 * native notification and the panel do not tell the user to go back to the terminal. Without a
 * matching broker request (the hook failed or the feature is off) the notice stays.
 */
export function withAnswerableClaudeNotice(
  normalized: AdapterNormalizeResult,
  context: AnswerableClaudeNoticeContext,
): AdapterNormalizeResult {
  if (!normalized.ok || !context.enabled) return normalized
  const event = normalized.event
  if (event.state !== 'waiting-permission' || !event.permissionNotice || !CLAUDE_SOURCES.has(event.source)) return normalized
  if (!context.hasRecentRequest(event.source, event.sessionId)) return normalized
  const { permissionNotice: _external, ...rest } = event
  return { ok: true, event: rest }
}
