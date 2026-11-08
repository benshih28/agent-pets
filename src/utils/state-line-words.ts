import type { AgentState } from '@/types/agent'

// 寵物狀態列上的狀態詞一律用英文短字（使用者偏好，任何語系都一樣）；
// 各家族狀態列的 aria-label 與 tooltip 仍用已翻譯的完整說法（stateAriaLabel）；
// 沒有家族時的整體狀態列（Idle／Offline）連 tooltip 與 aria-label 都用這個英文字。
// 刻意不放進語系檔：這組字不翻譯，也不等同面板用的 STATE_LABELS_SHORT。
export const STATE_LINE_WORDS: Readonly<Record<AgentState, string>> = {
  offline: 'Offline',
  idle: 'Idle',
  thinking: 'Thinking',
  'tool-running': 'Working',
  'waiting-permission': 'Permission',
  'waiting-input': 'Needs input',
  success: 'Done',
  error: 'Failed',
}

export function stateLineLabel(state: string): string {
  return STATE_LINE_WORDS[state as AgentState] ?? STATE_LINE_WORDS.idle
}
