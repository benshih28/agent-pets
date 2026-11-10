import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SOUND_CUE_PREVIEWS,
  SOUND_CUE_REGISTRY,
  SOUND_CUE_TOGGLES,
  SOUND_CUES,
  SOUND_DEFAULTS,
  SOUND_ENVELOPE,
  SOUND_POLICY,
  SOUND_VOLUME,
  type SoundCue,
} from '../src/types/sound.ts'
import { AGENT_STATES } from '../src/types/agent.ts'
import { AGENT_STATE_PRESENTATION } from '../src/utils/agent-state-presentation.ts'
import { shouldPlaySuccessSound } from '../src/utils/sound-policy.ts'

// --- 假的 Web Audio：記下每個呼叫，用來比對實際排程出去的聲音 -------------------------

const CURRENT_TIME = 12.5
type Call = readonly unknown[]
const calls: Call[] = []
let currentTimeReads = 0
let nodeId = 0

function param(owner: string, name: string) {
  return {
    set value(v: number) { calls.push([owner, `${name}.value`, v]) },
    setValueAtTime(v: number, at: number) { calls.push([owner, `${name}.set`, v, at]) },
    linearRampToValueAtTime(v: number, at: number) { calls.push([owner, `${name}.ramp`, v, at]) },
  }
}

class FakeAudioContext {
  state = 'suspended'
  destination = { id: 'destination' }
  resumes = 0
  get currentTime() { currentTimeReads++; return CURRENT_TIME }
  resume() { this.resumes++; return Promise.reject(new Error('closed')) }
  createOscillator() {
    const id = `osc${nodeId++}`
    return {
      id,
      set type(v: string) { calls.push([id, 'type', v]) },
      frequency: param(id, 'frequency'),
      connect(target: { id: string }) { calls.push([id, 'connect', target.id]) },
      start(at: number) { calls.push([id, 'start', at]) },
      stop(at: number) { calls.push([id, 'stop', at]) },
    }
  }
  createGain() {
    const id = `gain${nodeId++}`
    return { id, gain: param(id, 'gain'), connect(target: { id: string }) { calls.push([id, 'connect', target.id]) } }
  }
}

;(globalThis as any).window = { AudioContext: FakeAudioContext }
const { playCue, setSoundVolume } = await import('../src/utils/sound.ts')

function reset() {
  calls.length = 0
  currentTimeReads = 0
  nodeId = 0
}

/** 把呼叫紀錄還原成 [波形, 頻率, start, 峰值, 峰值時間, 降到 0 的時間, stop]。 */
function tonesFromCalls(): unknown[][] {
  const tones: unknown[][] = []
  for (let i = 0; i < calls.length; i += 9) {
    const [osc, gain] = [`osc${(i / 9) * 2}`, `gain${(i / 9) * 2 + 1}`]
    assert.deepEqual(calls.slice(i, i + 9).map(c => c.slice(0, 2)), [
      [osc, 'type'], [osc, 'frequency.value'], [gain, 'gain.set'], [gain, 'gain.ramp'], [gain, 'gain.ramp'],
      [osc, 'connect'], [gain, 'connect'], [osc, 'start'], [osc, 'stop'],
    ])
    const c = calls.slice(i, i + 9)
    assert.deepEqual(c[2], [gain, 'gain.set', 0, c[7][2]], '每個音都從 0 起音')
    assert.equal(c[4][2], 0, '每個音最後都降到 0')
    assert.equal(c[5][2], gain, '振盪器接到自己的增益節點')
    assert.equal(c[6][2], 'destination')
    tones.push([c[0][2], c[1][2], c[7][2], c[3][2], c[3][3], c[4][3], c[8][2]])
  }
  return tones
}

// 重構前（main f8965ae）的 src/utils/sound.ts 以 currentTime = 12.5 實際排程出去的值；
// 浮點數末位也照抄，代表加總的順序沒有變。任何一格不同，使用者聽到的聲音就變了。
const LEGACY_OUTPUT: Record<string, unknown[][]> = {
  '60:success': [['sine', 660, 12.5, 0.1152, 12.51, 12.59, 12.61], ['sine', 880, 12.59, 0.1152, 12.6, 12.72, 12.74]],
  '60:error': [['triangle', 330, 12.5, 0.096, 12.51, 12.62, 12.639999999999999], ['triangle', 220, 12.63, 0.096, 12.64, 12.83, 12.85]],
  '60:waiting-input': [['sine', 440, 12.5, 0.07680000000000001, 12.51, 12.58, 12.6], ['sine', 587, 12.6, 0.07680000000000001, 12.61, 12.719999999999999, 12.739999999999998]],
  '60:waiting-permission': [['triangle', 988, 12.5, 0.096, 12.51, 12.59, 12.61], ['triangle', 740, 12.62, 0.096, 12.629999999999999, 12.709999999999999, 12.729999999999999], ['triangle', 988, 12.74, 0.096, 12.75, 12.88, 12.9]],
  '100:success': [['sine', 660, 12.5, 0.192, 12.51, 12.59, 12.61], ['sine', 880, 12.59, 0.192, 12.6, 12.72, 12.74]],
  '100:error': [['triangle', 330, 12.5, 0.16000000000000003, 12.51, 12.62, 12.639999999999999], ['triangle', 220, 12.63, 0.16000000000000003, 12.64, 12.83, 12.85]],
  '100:waiting-input': [['sine', 440, 12.5, 0.128, 12.51, 12.58, 12.6], ['sine', 587, 12.6, 0.128, 12.61, 12.719999999999999, 12.739999999999998]],
  '100:waiting-permission': [['triangle', 988, 12.5, 0.16000000000000003, 12.51, 12.59, 12.61], ['triangle', 740, 12.62, 0.16000000000000003, 12.629999999999999, 12.709999999999999, 12.729999999999999], ['triangle', 988, 12.74, 0.16000000000000003, 12.75, 12.88, 12.9]],
  '35:success': [['sine', 660, 12.5, 0.0672, 12.51, 12.59, 12.61], ['sine', 880, 12.59, 0.0672, 12.6, 12.72, 12.74]],
  '35:error': [['triangle', 330, 12.5, 0.055999999999999994, 12.51, 12.62, 12.639999999999999], ['triangle', 220, 12.63, 0.055999999999999994, 12.64, 12.83, 12.85]],
  '35:waiting-input': [['sine', 440, 12.5, 0.0448, 12.51, 12.58, 12.6], ['sine', 587, 12.6, 0.0448, 12.61, 12.719999999999999, 12.739999999999998]],
  '35:waiting-permission': [['triangle', 988, 12.5, 0.055999999999999994, 12.51, 12.59, 12.61], ['triangle', 740, 12.62, 0.055999999999999994, 12.629999999999999, 12.709999999999999, 12.729999999999999], ['triangle', 988, 12.74, 0.055999999999999994, 12.75, 12.88, 12.9]],
}

// 狀態 → cue 只由 AGENT_STATE_PRESENTATION 決定；這裡是重構前 store 與 App.vue 的實際對應。
const LEGACY_STATE_CUES = {
  offline: null, idle: null, thinking: null, 'tool-running': null,
  'waiting-permission': 'waiting-permission', 'waiting-input': 'waiting-input', success: 'success', error: 'error',
} as const

function isDeepFrozen(value: unknown, path = 'root'): void {
  if (!value || typeof value !== 'object') return
  assert.ok(Object.isFrozen(value), `${path} 沒有凍結`)
  for (const [key, child] of Object.entries(value)) isDeepFrozen(child, `${path}.${key}`)
}

test('every state still produces exactly the sound it did before the registry', () => {
  assert.deepEqual(Object.fromEntries(AGENT_STATES.map(s => [s, AGENT_STATE_PRESENTATION[s].cue])), LEGACY_STATE_CUES)
  for (const volume of [60, 100, 35]) {
    setSoundVolume(volume)
    for (const state of AGENT_STATES) {
      const cue = AGENT_STATE_PRESENTATION[state].cue
      if (!cue) continue
      reset()
      playCue(cue, { preview: true })
      assert.deepEqual(tonesFromCalls(), LEGACY_OUTPUT[`${volume}:${cue}`], `${volume}% ${state}`)
    }
  }
  setSoundVolume(SOUND_DEFAULTS.soundVolume)
})

test('one cue reads the audio clock once so its tones share a time base', () => {
  reset()
  playCue('waiting-permission', { preview: true })
  assert.equal(currentTimeReads, 1)
  assert.equal(nodeId, SOUND_CUE_REGISTRY['waiting-permission'].tones.length * 2, '每個音一組振盪器與增益節點')
})

test('the registry is exhaustive: every cue is reachable from a state and every state cue is registered', () => {
  assert.deepEqual([...SOUND_CUES].sort(), ['error', 'success', 'waiting-input', 'waiting-permission'])
  const stateCues = new Set(AGENT_STATES.map(s => AGENT_STATE_PRESENTATION[s].cue).filter(Boolean))
  assert.deepEqual([...stateCues].sort(), [...SOUND_CUES].sort())
  for (const cue of SOUND_CUES) {
    const spec = SOUND_CUE_REGISTRY[cue]
    assert.ok(spec.tones.length > 0, cue)
    for (const tone of spec.tones) {
      assert.ok(tone.freq > 0 && tone.duration > SOUND_ENVELOPE.attackSec && tone.gain > 0 && tone.startAt >= 0, cue)
      // 峰值在音量 100% 時也不能超過 1，否則會削波。
      assert.ok(tone.gain * SOUND_ENVELOPE.gainScale <= 1, cue)
    }
  }
  const toggleKeys = SOUND_CUE_TOGGLES.map(t => t.key)
  assert.equal(new Set(toggleKeys).size, toggleKeys.length, '每個開關只對應一個 cue')
  for (const key of toggleKeys) assert.equal(typeof SOUND_DEFAULTS[key], 'boolean', key)
})

test('the registry and its derived lists are deeply frozen', () => {
  for (const [name, value] of Object.entries({
    SOUND_CUE_REGISTRY, SOUND_CUES, SOUND_CUE_TOGGLES, SOUND_CUE_PREVIEWS,
    SOUND_ENVELOPE, SOUND_POLICY, SOUND_VOLUME, SOUND_DEFAULTS,
  })) isDeepFrozen(value, name)
  assert.throws(() => { (SOUND_CUE_REGISTRY.success.tones[0] as { freq: number }).freq = 1 }, TypeError)
  assert.throws(() => { (SOUND_POLICY as { cueThrottleMs: number }).cueThrottleMs = 0 }, TypeError)
})

test('settings rows, previews, defaults and limits stay as before', () => {
  assert.deepEqual(SOUND_CUE_TOGGLES, [
    { key: 'soundOnPermission', labelKey: 'permission.soundOnPermission' },
    { key: 'soundOnError', labelKey: 'permission.soundOnError' },
    { key: 'soundOnSuccess', labelKey: 'permission.soundOnSuccess' },
  ])
  assert.deepEqual(SOUND_CUE_PREVIEWS, [
    { cue: 'waiting-permission', labelKey: 'permission.soundPreviewPermission' },
    { cue: 'error', labelKey: 'permission.soundPreviewError' },
    { cue: 'success', labelKey: 'permission.soundPreviewSuccess' },
  ])
  assert.deepEqual({ ...SOUND_DEFAULTS }, {
    soundEnabled: false, soundVolume: 60, soundOnPermission: true, soundOnError: true, soundOnSuccess: true,
  })
  assert.deepEqual({ ...SOUND_VOLUME }, { min: 0, max: 100, step: 5 })
  assert.deepEqual({ ...SOUND_POLICY }, { cueThrottleMs: 3_000, successMinElapsedMs: 15_000 })
  assert.deepEqual({ ...SOUND_ENVELOPE }, { attackSec: 0.01, stopTailSec: 0.02, gainScale: 1.6 })
})

test('a cue is throttled per cue for cueThrottleMs, but previews always play', () => {
  const realNow = Date.now
  // 前面的試聽已用真實時間寫入節流紀錄，假時鐘要從那之後開始。
  let now = realNow() + 60_000
  Date.now = () => now
  try {
    const played = (cue: SoundCue, preview = false) => { reset(); playCue(cue, { preview }); return nodeId > 0 }
    assert.equal(played('error'), true)
    now += SOUND_POLICY.cueThrottleMs - 1
    assert.equal(played('error'), false)
    assert.equal(played('success'), true, '節流是各 cue 分開算的')
    assert.equal(played('error', true), true, '試聽不受節流')
    now += SOUND_POLICY.cueThrottleMs
    assert.equal(played('error'), true)
  } finally {
    Date.now = realNow
  }
})

test('volume 0 is silent and a non-finite volume is ignored instead of breaking playback', () => {
  setSoundVolume(0)
  reset()
  playCue('success', { preview: true })
  assert.equal(nodeId, 0)
  setSoundVolume(Number.NaN)
  reset()
  playCue('success', { preview: true })
  assert.equal(nodeId, 0, 'NaN 不覆蓋先前的 0')
  setSoundVolume(SOUND_DEFAULTS.soundVolume)
  reset()
  playCue('success', { preview: true })
  assert.deepEqual(tonesFromCalls(), LEGACY_OUTPUT['60:success'])
})

test('a short success stays silent; unknown duration still plays', () => {
  assert.equal(shouldPlaySuccessSound(undefined), true)
  assert.equal(shouldPlaySuccessSound(Number.NaN), true)
  assert.equal(shouldPlaySuccessSound(SOUND_POLICY.successMinElapsedMs - 1), false)
  assert.equal(shouldPlaySuccessSound(SOUND_POLICY.successMinElapsedMs), true)
})
