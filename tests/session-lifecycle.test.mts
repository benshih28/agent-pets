import assert from 'node:assert/strict'
import test from 'node:test'
import { AGENT_STATE_POLICY, AGENT_STATES, type AgentState } from '../src/types/agent.ts'
import { SUCCESS_DISPLAY_MS } from '../src/utils/pet-motion-plan.ts'
import { SESSION_REMOVE_MS, SESSION_STALE_MS, sessionLifecycleAction } from '../src/utils/session-lifecycle.ts'

const MINUTE = 60_000
const free = { hasPendingPermission: false }
const after = (state: AgentState, silentMs: number, context = free) =>
  sessionLifecycleAction({ state, lastSeenAt: 0 }, silentMs, context)

test('every state has a quiet limit, and each step down waits longer than the one before', () => {
  for (const state of AGENT_STATES) {
    const rule = AGENT_STATE_POLICY[state].quiet
    assert.ok(rule.afterMs > 0, state)
    if (rule.to === 'remove') continue
    // 期限都從最後一個真實事件算起，所以下一站的期限必須更長，否則會一路掉到底。
    assert.ok(AGENT_STATE_POLICY[rule.to].quiet.afterMs > rule.afterMs, `${state} -> ${rule.to}`)
  }
})

test('every state eventually leaves the list', () => {
  for (const start of AGENT_STATES) {
    let state: AgentState = start
    const seen = new Set<AgentState>()
    for (;;) {
      assert.equal(seen.has(state), false, `${start} loops at ${state}`)
      seen.add(state)
      const next: AgentState | 'remove' = AGENT_STATE_POLICY[state].quiet.to
      if (next === 'remove') break
      state = next
    }
  }
})

test('the limits are the measured ones', () => {
  const limits = Object.fromEntries(AGENT_STATES.map(state => [state, AGENT_STATE_POLICY[state].quiet]))
  assert.deepEqual(limits, {
    offline: { afterMs: 45 * MINUTE, to: 'remove' },
    idle: { afterMs: 15 * MINUTE, to: 'offline' },
    thinking: { afterMs: 5 * MINUTE, to: 'idle' },
    'tool-running': { afterMs: 15 * MINUTE, to: 'offline' },
    'waiting-permission': { afterMs: 15 * MINUTE, to: 'offline', heldByPendingPermission: true },
    'waiting-input': { afterMs: 15 * MINUTE, to: 'offline' },
    success: { afterMs: 4_000, to: 'idle' },
    error: { afterMs: 15 * MINUTE, to: 'offline' },
  })
  assert.equal(SESSION_STALE_MS, 15 * MINUTE)
  assert.equal(SESSION_REMOVE_MS, 45 * MINUTE)
  assert.equal(SUCCESS_DISPLAY_MS, 4_000)
})

test('nothing changes inside the limit, and the limit itself is still inside', () => {
  for (const state of AGENT_STATES) {
    assert.equal(after(state, 0), null, state)
    assert.equal(after(state, AGENT_STATE_POLICY[state].quiet.afterMs), null, state)
  }
})

test('a turn that never reported its end settles to idle, then offline, then leaves', () => {
  assert.equal(after('thinking', 5 * MINUTE + 1), 'idle')
  assert.equal(after('thinking', 15 * MINUTE + 1), 'offline')
  assert.equal(after('thinking', 45 * MINUTE + 1), 'remove')
  assert.equal(after('success', 4_001), 'idle')
  assert.equal(after('success', 20 * MINUTE), 'offline')
  // 工具可以合法地跑很久：期限內不動，到期直接視為程序不在了。
  assert.equal(after('tool-running', 14 * MINUTE), null)
  assert.equal(after('tool-running', 15 * MINUTE + 1), 'offline')
  for (const state of ['idle', 'waiting-input', 'error'] as const) {
    assert.equal(after(state, 15 * MINUTE + 1), 'offline', state)
    assert.equal(after(state, 45 * MINUTE + 1), 'remove', state)
  }
  assert.equal(after('offline', 44 * MINUTE), null)
  assert.equal(after('offline', 45 * MINUTE + 1), 'remove')
})

test('a permission prompt someone still has to answer is not timed out, others are', () => {
  const pending = { hasPendingPermission: true }
  assert.equal(after('waiting-permission', 60 * MINUTE, pending), null)
  assert.equal(after('waiting-permission', 15 * MINUTE + 1), 'offline')
  // 只有等權限的 session 受保護，其他狀態不受影響。
  assert.equal(after('thinking', 5 * MINUTE + 1, pending), 'idle')
  assert.equal(after('tool-running', 15 * MINUTE + 1, pending), 'offline')
})

test('sleep or a clock jump backwards never produces a change', () => {
  for (const state of AGENT_STATES) {
    assert.equal(sessionLifecycleAction({ state, lastSeenAt: 10_000 }, 0, free), null, state)
  }
})
