import { t, type TranslationKey } from '@/i18n'
import type { AgentState } from '@/types/agent'

// 狀態的口語化（已翻譯）名稱，給螢幕閱讀器用；畫面上的 STATE_LABELS 依慣例維持英文。
const STATE_ARIA_KEYS: Record<AgentState, TranslationKey> = {
  offline: 'pet.stateOffline',
  idle: 'pet.stateIdle',
  thinking: 'pet.stateThinking',
  'tool-running': 'pet.stateWorking',
  'waiting-permission': 'pet.statePermission',
  'waiting-input': 'pet.stateWaitingInput',
  success: 'pet.stateSuccess',
  error: 'pet.stateError',
}

export function stateAriaLabel(state: string): string {
  return t(STATE_ARIA_KEYS[state as AgentState] ?? 'pet.stateIdle')
}
