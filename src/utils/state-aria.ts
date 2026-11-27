import { t } from '@/i18n'
import { statePresentation } from '@/utils/agent-state-presentation'

export function stateAriaLabel(state: string): string {
  return t(statePresentation(state).ariaKey)
}
