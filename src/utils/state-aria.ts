import { t } from '@/i18n'
import { statePresentation } from '@/utils/agent-state-presentation'

// 狀態的口語化（已翻譯）名稱，給螢幕閱讀器用；畫面上的標籤依慣例維持英文。
export function stateAriaLabel(state: string): string {
  return t(statePresentation(state).ariaKey)
}
