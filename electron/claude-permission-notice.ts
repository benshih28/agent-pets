import type { AdapterNormalizeResult } from '../src/types/agent-adapter'
import { familySourceSet } from '../src/types/agent.ts'

const CLAUDE_SOURCES = familySourceSet('claude')

// Claude's Notification hook can trail the decision by a few seconds.
export const CLAUDE_ANSWERABLE_GRACE_MS = 10_000

export interface AnswerableClaudeNoticeContext {
  enabled: boolean
  hasRecentRequest: (source: string, sessionId: string) => boolean
}

/** Drops the "answer in terminal" notice only when a matching broker request exists. */
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
