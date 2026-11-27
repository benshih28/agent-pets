// tests 用 Node 直接執行這個檔案，值 import 必須是相對路徑。
import { AGENT_STATE_POLICY, AGENT_STATES, type AgentSession, type AgentState } from '../types/agent.ts'

// 期限寫在狀態 registry；不要在這裡加針對某個狀態或某個 agent 的判斷。

export const SESSION_STALE_MS = AGENT_STATE_POLICY.idle.quiet.afterMs
export const SESSION_REMOVE_MS = AGENT_STATE_POLICY.offline.quiet.afterMs

/** 'remove' 是移除，null 是不動。 */
export type SessionLifecycleAction = AgentState | 'remove' | null

export interface SessionLifecycleContext {
  hasPendingPermission: boolean
}

/** 安靜時間一律從最後一個真實事件算起，所以睡眠喚醒或 renderer 重載後一次就能走到正確的狀態。 */
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
