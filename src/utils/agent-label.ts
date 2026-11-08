import { t } from '@/i18n'

/** Display name for a History adapter id; unknown ids are shown as-is. */
export function agentDisplayName(adapterId: string): string {
  const id = adapterId.toLowerCase()
  if (id.includes('codex')) return t('clientCodex')
  if (id.includes('claude')) return t('clientClaudeCode')
  if (id.includes('opencode')) return t('clientOpenCode')
  return adapterId
}
