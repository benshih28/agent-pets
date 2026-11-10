import { AGENT_SOURCE_REGISTRY, isAgentSource, type AgentSourceDefinition } from '@/types/agent'
import type { TranslationKey } from '@/i18n'

/** Human label for the agent that raised a permission request. */
export function permissionSourceName(agentId: string): string {
  // 先驗證再查表：'constructor' 之類的字串不能從原型鏈拿到值。
  return isAgentSource(agentId) ? AGENT_SOURCE_REGISTRY[agentId].label : agentId
}

const ALSO_ANSWERABLE_KEY = Object.freeze({
  cli: 'permission.alsoInTerminal',
  desktop: 'permission.alsoInApp',
} as const satisfies Record<AgentSourceDefinition['variant'], TranslationKey>)

/**
 * Claude Code keeps its own permission prompt open while the pet waits, so its
 * requests say where else they can be answered. Other agents return null.
 */
export function alsoAnswerableKey(agentId: string): TranslationKey | null {
  if (!isAgentSource(agentId)) return null
  const definition = AGENT_SOURCE_REGISTRY[agentId]
  return definition.family === 'claude' ? ALSO_ANSWERABLE_KEY[definition.variant] : null
}
