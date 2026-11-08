import { t, type TranslationKey } from '@/i18n'
import type { AgentState } from '@/types/agent'

// STATE_LABELS stay English on screen on purpose (see ui-design-system.md);
// screen readers still get the user's language through this helper.
export function stateAriaLabel(state: AgentState): string {
  return t(`design.state.${state}` as TranslationKey)
}
