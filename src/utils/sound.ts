// 用 Web Audio 即時合成短音效：不必附帶或授權音檔，聲音也夠小、沒有載入延遲。
// 音形、節流與音量範圍都在 src/types/sound.ts 的 registry；這裡只負責排程。
// 測試會直接用 Node 執行這個檔案，執行期 import 必須是相對路徑（見 agent-pets-conventions §1）。
import {
  SOUND_CUE_REGISTRY,
  SOUND_DEFAULTS,
  SOUND_ENVELOPE,
  SOUND_POLICY,
  SOUND_VOLUME,
  type SoundCue,
  type SoundTone,
} from '../types/sound.ts'

type AudioContextConstructor = typeof AudioContext

let ctx: AudioContext | null = null

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const AudioCtx: AudioContextConstructor | undefined = window.AudioContext
      || (window as Window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext
    if (!AudioCtx) return null
    ctx = new AudioCtx()
  }
  return ctx
}

function volumeFraction(percent: number): number {
  return Math.min(1, Math.max(0, percent / SOUND_VOLUME.max))
}

let masterVolume = volumeFraction(SOUND_DEFAULTS.soundVolume)

/** 桌面偏好設定的 0–100；非有限數值會讓 Web Audio 排程丟出例外，所以直接忽略。 */
export function setSoundVolume(percent: number): void {
  if (!Number.isFinite(percent)) return
  masterVolume = volumeFraction(percent)
}

// Web Audio 的振盪器只能 start 一次，每個音一定要新建一組節點，不能重用。
// 播放時間基準由呼叫端傳入：同一個 cue 的每個音都對齊同一個 currentTime。
function scheduleTone(audio: AudioContext, now: number, tone: SoundTone): void {
  const gain = tone.gain * masterVolume * SOUND_ENVELOPE.gainScale
  const at = now + tone.startAt
  const osc = audio.createOscillator()
  const gainNode = audio.createGain()
  osc.type = tone.type
  osc.frequency.value = tone.freq
  gainNode.gain.setValueAtTime(0, at)
  gainNode.gain.linearRampToValueAtTime(gain, at + SOUND_ENVELOPE.attackSec)
  gainNode.gain.linearRampToValueAtTime(0, at + tone.duration)
  osc.connect(gainNode)
  gainNode.connect(audio.destination)
  osc.start(at)
  osc.stop(at + tone.duration + SOUND_ENVELOPE.stopTailSec)
}

const lastPlayed = new Map<SoundCue, number>()

export function playCue(cue: SoundCue, options: { preview?: boolean } = {}): void {
  const audio = getContext()
  if (!audio || masterVolume <= 0) return
  const nowMs = Date.now()
  if (!options.preview && nowMs - (lastPlayed.get(cue) ?? 0) < SOUND_POLICY.cueThrottleMs) return
  lastPlayed.set(cue, nowMs)
  // 已關閉的 context 會拒絕 resume；沒接住會變成未處理的 rejection。
  if (audio.state === 'suspended') audio.resume().catch(() => {})

  const now = audio.currentTime
  for (const tone of SOUND_CUE_REGISTRY[cue].tones) scheduleTone(audio, now, tone)
}
