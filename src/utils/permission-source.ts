import { SOURCE_LABELS } from '@/types/agent'
import type { TranslationKey } from '@/i18n'

/** Human label for the agent that raised a permission request. */
export function permissionSourceName(agentId: string): string {
  return SOURCE_LABELS[agentId as keyof typeof SOURCE_LABELS] ?? agentId
}

/**
 * Claude Code keeps its own permission prompt open while the pet waits, so its
 * requests say where else they can be answered. Other agents return null.
 */
export function alsoAnswerableKey(agentId: string): TranslationKey | null {
  switch (agentId) {
    case 'claude': return 'permission.alsoInTerminal'
    case 'claude-desktop': return 'permission.alsoInApp'
    default: return null
  }
}
