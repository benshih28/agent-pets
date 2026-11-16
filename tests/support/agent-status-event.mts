import type { AgentState, AgentStatusEvent } from '../../src/types/agent.ts'

// 預設值刻意帶 project：通知文案的 body 取自 project，少了它斷言會悄悄改測到備用文字。
export function makeAgentStatusEvent(state: AgentState, overrides: Partial<AgentStatusEvent> = {}): AgentStatusEvent {
  return {
    source: 'codex',
    sessionId: 'session-1',
    project: 'agent-pets',
    state,
    timestamp: Date.now(),
    ...overrides,
  }
}
