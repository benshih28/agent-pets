// tests 用 Node 直接執行這個檔案，值 import 必須是相對路徑。
import { AGENT_STATE_POLICY, AGENT_STATES, type AgentSession, type AgentState } from '../types/agent.ts'

// 每個狀態的期限寫在狀態 registry（AGENT_STATE_POLICY 的 quiet），這裡只負責套用；
// 不要在這裡加針對某個狀態或某個 agent 的判斷。

/** 這麼久沒有事件的 session 視為 agent 程序已經不在，轉成離線。 */
export const SESSION_STALE_MS = AGENT_STATE_POLICY.idle.quiet.afterMs
/** 這麼久沒有事件的 session 從清單移除（之前已經轉成離線）。 */
export const SESSION_REMOVE_MS = AGENT_STATE_POLICY.offline.quiet.afterMs

/** 定期清理要把 session 改成的狀態；'remove' 是移除，null 是不動。 */
export type SessionLifecycleAction = AgentState | 'remove' | null

export interface SessionLifecycleContext {
  /** 權限中介還有未回覆的請求。 */
  hasPendingPermission: boolean
}

/**
 * 依安靜時間沿著狀態表一路降級，回傳最後停在哪裡。安靜時間一律從最後一個真實事件算起，
 * 所以睡眠喚醒或 renderer 重載後一次就能走到正確的狀態，不用等好幾輪清理。
 */
export function sessionLifecycleAction(
  session: Pick<AgentSession, 'state' | 'lastSeenAt'>,
  now: number,
  context: SessionLifecycleContext,
): SessionLifecycleAction {
  const silentFor = now - session.lastSeenAt
  let state = session.state
  let action: SessionLifecycleAction = null
  // 步數上限等於狀態數：表若被改成有循環也不會卡住。
  for (let step = 0; step < AGENT_STATES.length; step += 1) {
    const rule = AGENT_STATE_POLICY[state].quiet
    if (silentFor <= rule.afterMs) break
    if ('heldByPendingPermission' in rule && context.hasPendingPermission) break
    if (rule.to === 'remove') return 'remove'
    state = rule.to
    action = state
  }
  return action
}
