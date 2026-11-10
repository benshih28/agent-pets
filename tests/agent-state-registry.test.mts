import assert from 'node:assert/strict'
import test from 'node:test'
import { AGENT_STATE_POLICY, AGENT_STATES, isAgentState, STATE_PRIORITY } from '../src/types/agent.ts'
import { AGENT_STATE_PRESENTATION, statePresentation } from '../src/utils/agent-state-presentation.ts'
import { shouldPlayCue, type SoundGate } from '../src/utils/sound-policy.ts'
import { classifyNotification } from '../electron/notification-policy.ts'
import { nextFinalState } from '../electron/history-sessions.ts'

// 特性測試：數值是重構成 registry 前各處散落常數與 switch 的實際輸出，任何一格變了都算外部契約改變。

const STATES = [
  'offline', 'idle', 'thinking', 'tool-running',
  'waiting-permission', 'waiting-input', 'success', 'error',
] as const

function column<K extends keyof (typeof AGENT_STATE_PRESENTATION)['idle']>(field: K) {
  return Object.fromEntries(AGENT_STATES.map(state => [state, AGENT_STATE_PRESENTATION[state][field]]))
}

test('priority, labels, colors and status-line words stay exactly as before', () => {
  assert.deepEqual(STATE_PRIORITY, {
    'waiting-permission': 100, error: 90, 'waiting-input': 85, 'tool-running': 80,
    thinking: 70, success: 60, idle: 20, offline: 0,
  })
  assert.deepEqual(column('label'), {
    offline: 'Offline', idle: 'Idle', thinking: 'Thinking', 'tool-running': 'Running Tool',
    'waiting-permission': 'Waiting Permission', 'waiting-input': 'Waiting Input', success: 'Success', error: 'Error',
  })
  assert.deepEqual(column('shortLabel'), {
    offline: 'Offline', idle: 'Idle', thinking: 'Thinking', 'tool-running': 'Running',
    'waiting-permission': 'Permission', 'waiting-input': 'Waiting', success: 'Success', error: 'Error',
  })
  assert.deepEqual(column('color'), {
    offline: 'var(--state-offline)', idle: 'var(--state-idle)',
    thinking: 'var(--state-active)', 'tool-running': 'var(--state-active)',
    'waiting-permission': 'var(--state-warn)', 'waiting-input': 'var(--state-warn)',
    success: 'var(--state-success)', error: 'var(--state-error)',
  })
  assert.deepEqual(column('lineWord'), {
    offline: 'Offline', idle: 'Idle', thinking: 'Thinking', 'tool-running': 'Working',
    'waiting-permission': 'Permission', 'waiting-input': 'Needs input', success: 'Done', error: 'Failed',
  })
})

test('desktop notifications per state are unchanged', () => {
  const base = { source: 'codex', sessionId: 's1', project: 'p', timestamp: 1 }
  const session = { source: 'codex', sessionId: 's1' }
  const expected: Record<string, unknown> = {
    offline: null,
    idle: null,
    thinking: null,
    'tool-running': null,
    'waiting-permission': { key: 'codex:s1:waiting-permission', kind: 'waiting-permission', title: 'Codex 需要你的權限確認', body: 'p', terminal: false, session },
    'waiting-input': { key: 'codex:s1:waiting-input', kind: 'waiting-input', title: 'Codex 正在等待輸入', body: 'p', terminal: false, session },
    success: { key: 'codex:s1:success', kind: 'success', title: 'Codex 工作已完成', body: 'p', terminal: true },
    error: { key: 'codex:s1:error', kind: 'error', title: 'Codex 工作失敗', body: 'p', terminal: true },
    // 事件字串不在 AgentState 內（含原型鏈上的名稱）一律不通知。
    bogus: null,
    constructor: null,
    toString: null,
  }
  for (const [state, value] of Object.entries(expected)) {
    assert.deepEqual(classifyNotification({ ...base, state } as any), value, state)
  }
  assert.deepEqual(classifyNotification({
    source: 'claude', sessionId: 's1', state: 'waiting-permission', timestamp: 1,
    permissionNotice: { responseMode: 'external_only' },
  } as any), {
    key: 'claude:s1:waiting-permission', kind: 'waiting-permission',
    title: 'Claude 等你核准（請回原工具處理）', body: 'Agent 工作', terminal: false,
    session: { source: 'claude', sessionId: 's1' },
  })
})

test('history final-state classification per state is unchanged', () => {
  const previous = [null, 'success', 'error', 'cancelled', 'open'] as const
  const expected: Record<string, string[]> = {
    offline: ['cancelled', 'cancelled', 'cancelled', 'cancelled', 'cancelled'],
    idle: ['open', 'success', 'error', 'cancelled', 'open'],
    thinking: ['open', 'open', 'open', 'open', 'open'],
    'tool-running': ['open', 'open', 'open', 'open', 'open'],
    'waiting-permission': ['open', 'open', 'open', 'open', 'open'],
    'waiting-input': ['open', 'open', 'open', 'open', 'open'],
    success: ['success', 'success', 'success', 'success', 'success'],
    error: ['error', 'error', 'error', 'error', 'error'],
    // 不認得的狀態沿用上一輪結果，跟 idle 相同。
    bogus: ['open', 'success', 'error', 'cancelled', 'open'],
    constructor: ['open', 'success', 'error', 'cancelled', 'open'],
  }
  for (const [state, values] of Object.entries(expected)) {
    assert.deepEqual(previous.map(p => nextFinalState(p, state as any)), values, state)
  }
})

test('sound cues keep their per-cue switches and master gates', () => {
  const open: SoundGate = {
    soundEnabled: true, dndEnabled: false, petVisible: true,
    soundOnPermission: true, soundOnError: true, soundOnSuccess: true,
  }
  const closed: SoundGate = { ...open, soundOnPermission: false, soundOnError: false, soundOnSuccess: false }
  for (const cue of ['success', 'error', 'waiting-permission', 'waiting-input'] as const) {
    assert.equal(shouldPlayCue(cue, open), true, cue)
    // waiting-input 沒有自己的開關，只跟總開關。
    assert.equal(shouldPlayCue(cue, closed), cue === 'waiting-input', cue)
    assert.equal(shouldPlayCue(cue, { ...open, soundEnabled: false }), false, cue)
    assert.equal(shouldPlayCue(cue, { ...open, dndEnabled: true }), false, cue)
    assert.equal(shouldPlayCue(cue, { ...open, petVisible: false }), false, cue)
  }
  for (const [flag, cue] of [['soundOnPermission', 'waiting-permission'], ['soundOnError', 'error'], ['soundOnSuccess', 'success']] as const) {
    assert.equal(shouldPlayCue(cue, { ...open, [flag]: false }), false, cue)
  }
})

test('aria keys, mini badges and sound cues match the switches they replaced', () => {
  assert.deepEqual(column('ariaKey'), {
    offline: 'pet.stateOffline', idle: 'pet.stateIdle', thinking: 'pet.stateThinking',
    'tool-running': 'pet.stateWorking', 'waiting-permission': 'pet.statePermission',
    'waiting-input': 'pet.stateWaitingInput', success: 'pet.stateSuccess', error: 'pet.stateError',
  })
  assert.deepEqual(column('mini'), {
    offline: { icon: null, labelKey: 'pet.miniIdle' },
    idle: { icon: null, labelKey: 'pet.miniIdle' },
    thinking: { icon: null, labelKey: 'pet.miniWorking' },
    'tool-running': { icon: null, labelKey: 'pet.miniWorking' },
    'waiting-permission': { icon: 'lock', labelKey: 'pet.miniPermission' },
    'waiting-input': { icon: 'bell', labelKey: 'pet.miniWaiting' },
    success: { icon: 'check', labelKey: 'pet.miniSuccess' },
    error: { icon: 'warning', labelKey: 'pet.miniError' },
  })
  assert.deepEqual(column('cue'), {
    offline: null, idle: null, thinking: null, 'tool-running': null,
    'waiting-permission': 'waiting-permission', 'waiting-input': 'waiting-input', success: 'success', error: 'error',
  })
  // 不認得的狀態（含原型鏈上的名稱）一律當 idle 呈現，跟原本各處的 default 分支相同。
  for (const state of ['bogus', 'constructor', 'toString', '__proto__']) {
    assert.equal(statePresentation(state), AGENT_STATE_PRESENTATION.idle, state)
    assert.equal(isAgentState(state), false, state)
  }
})

test('both registries cover every AgentState and nothing else', () => {
  const states = [...STATES].sort()
  assert.deepEqual([...AGENT_STATES].sort(), states)
  assert.deepEqual(Object.keys(AGENT_STATE_POLICY).sort(), states)
  assert.deepEqual(Object.keys(AGENT_STATE_PRESENTATION).sort(), states)
  assert.deepEqual(Object.keys(STATE_PRIORITY).sort(), states)
  for (const state of STATES) assert.equal(isAgentState(state), true, state)
  // 表是全程式共用的單一來源：整張表、每一列與列裡的巢狀物件都凍結，誤改會直接丟錯。
  for (const table of [AGENT_STATE_POLICY, AGENT_STATE_PRESENTATION, STATE_PRIORITY, AGENT_STATES]) {
    assert.equal(Object.isFrozen(table), true)
  }
  for (const row of [...Object.values(AGENT_STATE_POLICY), ...Object.values(AGENT_STATE_PRESENTATION)]) {
    assert.equal(Object.isFrozen(row), true)
    for (const value of Object.values(row)) if (value && typeof value === 'object') assert.equal(Object.isFrozen(value), true)
  }
  assert.throws(() => { (AGENT_STATE_POLICY.error as { priority: number }).priority = 0 }, TypeError)
  assert.throws(() => { (AGENT_STATE_PRESENTATION.error.mini as { icon: string }).icon = 'x' }, TypeError)
  for (const entry of Object.values(AGENT_STATE_PRESENTATION)) {
    assert.match(entry.color, /^var\(--state-[a-z]+\)$/)
  }
})
