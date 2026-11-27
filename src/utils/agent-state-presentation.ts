import type { TranslationKey } from '@/i18n'
import type { SoundCue } from '@/types/sound'
// 測試直接用 Node 執行本檔，執行期 import 必須是相對路徑。
import { isAgentState, type AgentState } from '../types/agent.ts'
import { deepFreeze } from '../types/freeze.ts'

// 不能在執行期依賴 i18n 或 Vue：表裡只放翻譯 key，由呼叫端翻譯。
export interface AgentStatePresentation {
  /** 刻意不翻譯，每個語系都是英文（與 SOURCE_LABELS 一致）。 */
  readonly label: string
  readonly shortLabel: string
  /** tokens.css 語意層的 CSS 變數，不寫死顏色。 */
  readonly color: string
  /** 給螢幕閱讀器的已翻譯名稱。 */
  readonly ariaKey: TranslationKey
  /** 寵物狀態列的英文短字，任何語系都一樣；各家族狀態列的 aria-label 與 tooltip 仍用 ariaKey。 */
  readonly lineWord: string
  /** icon 為 null 時畫圓點。 */
  readonly mini: { readonly icon: string | null; readonly labelKey: TranslationKey }
  /** 是否真的播放仍由 store 依狀態轉換判斷。 */
  readonly cue: SoundCue | null
}

export const AGENT_STATE_PRESENTATION = deepFreeze({
  offline: {
    label: 'Offline', shortLabel: 'Offline', color: 'var(--state-offline)',
    ariaKey: 'pet.stateOffline', lineWord: 'Offline',
    mini: { icon: null, labelKey: 'pet.miniIdle' }, cue: null,
  },
  idle: {
    label: 'Idle', shortLabel: 'Idle', color: 'var(--state-idle)',
    ariaKey: 'pet.stateIdle', lineWord: 'Idle',
    mini: { icon: null, labelKey: 'pet.miniIdle' }, cue: null,
  },
  thinking: {
    label: 'Thinking', shortLabel: 'Thinking', color: 'var(--state-active)',
    ariaKey: 'pet.stateThinking', lineWord: 'Thinking',
    mini: { icon: null, labelKey: 'pet.miniWorking' }, cue: null,
  },
  'tool-running': {
    label: 'Running Tool', shortLabel: 'Running', color: 'var(--state-active)',
    ariaKey: 'pet.stateWorking', lineWord: 'Working',
    mini: { icon: null, labelKey: 'pet.miniWorking' }, cue: null,
  },
  'waiting-permission': {
    label: 'Waiting Permission', shortLabel: 'Permission', color: 'var(--state-warn)',
    ariaKey: 'pet.statePermission', lineWord: 'Permission',
    mini: { icon: 'lock', labelKey: 'pet.miniPermission' }, cue: 'waiting-permission',
  },
  'waiting-input': {
    label: 'Waiting Input', shortLabel: 'Waiting', color: 'var(--state-warn)',
    ariaKey: 'pet.stateWaitingInput', lineWord: 'Needs input',
    mini: { icon: 'bell', labelKey: 'pet.miniWaiting' }, cue: 'waiting-input',
  },
  success: {
    label: 'Success', shortLabel: 'Success', color: 'var(--state-success)',
    ariaKey: 'pet.stateSuccess', lineWord: 'Done',
    mini: { icon: 'check', labelKey: 'pet.miniSuccess' }, cue: 'success',
  },
  error: {
    label: 'Error', shortLabel: 'Error', color: 'var(--state-error)',
    ariaKey: 'pet.stateError', lineWord: 'Failed',
    mini: { icon: 'warning', labelKey: 'pet.miniError' }, cue: 'error',
  },
} as const satisfies Record<AgentState, AgentStatePresentation>)

/** 不認得的狀態字串（舊歷史資料、原型鏈上的名稱）一律當 idle。 */
export function statePresentation(state: string): AgentStatePresentation {
  return isAgentState(state) ? AGENT_STATE_PRESENTATION[state] : AGENT_STATE_PRESENTATION.idle
}

export function stateLineLabel(state: string): string {
  return statePresentation(state).lineWord
}
