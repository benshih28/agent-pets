import type { TranslationKey } from '@/i18n'
import type { SoundCue } from '@/types/sound'
// 測試會直接用 Node 執行這個檔案，執行期 import 必須是相對路徑（見 agent-pets-conventions §1）。
import { isAgentState, type AgentState } from '../types/agent.ts'
import { deepFreeze } from '../types/freeze.ts'

// --- 狀態 registry（renderer 畫面呈現） ------------------------------------------
// 每個 AgentState 在畫面上的樣子只寫在這一張表；satisfies 讓新增狀態時漏填任何一格都編譯失敗。
// 主程序也要用的策略（優先序、通知、歷史結局）在 src/types/agent.ts 的 AGENT_STATE_POLICY。
// 不能在執行期依賴 i18n 或 Vue：表裡只放翻譯 key，由呼叫端翻譯。

export interface AgentStatePresentation {
  /**
   * 面板用的完整標籤。刻意不翻譯（跟 SOURCE_LABELS 一樣）：這是 agent 的技術狀態，
   * 翻成中文跟面板上其他英文的工具／session 字彙放在一起反而不一致，所以每個語系都是英文。
   */
  readonly label: string
  /** 面板 session 列狀態徽章上的短標籤；完整的 label 放在它的 title。 */
  readonly shortLabel: string
  /** tokens.css 語意層的 CSS 變數（不寫死顏色）；狀態一律搭配文字標籤，不只靠顏色。 */
  readonly color: string
  /** 給螢幕閱讀器的口語化（已翻譯）名稱。 */
  readonly ariaKey: TranslationKey
  /**
   * 寵物狀態列上的英文短字（使用者偏好，任何語系都一樣；不等同 shortLabel）。
   * 各家族狀態列的 aria-label 與 tooltip 仍用 ariaKey；沒有家族時的整體狀態列連 tooltip 都用這個字。
   */
  readonly lineWord: string
  /** 迷你模式的狀態徽章：圖示為 null 時畫一個圓點。 */
  readonly mini: { readonly icon: string | null; readonly labelKey: TranslationKey }
  /** 進入這個狀態時可能播的音效；何時真的播放仍由 store 依狀態轉換判斷。 */
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

/**
 * 不認得的狀態字串（舊歷史資料、原型鏈上的名稱）一律當 idle 呈現；
 * 需要區分「不認得」的地方改用 isAgentState。
 */
export function statePresentation(state: string): AgentStatePresentation {
  return isAgentState(state) ? AGENT_STATE_PRESENTATION[state] : AGENT_STATE_PRESENTATION.idle
}

export function stateLineLabel(state: string): string {
  return statePresentation(state).lineWord
}
