// Short synthesized cues via Web Audio — no audio asset files to ship or
// license, and the sounds stay tiny and instant.
let ctx: AudioContext | null = null

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
    if (!AudioCtx) return null
    ctx = new AudioCtx()
  }
  return ctx
}

let masterVolume = 0.6

/** 0-100 from the desktop preference. */
export function setSoundVolume(percent: number): void {
  masterVolume = Math.min(1, Math.max(0, percent / 100))
}

function beep(freq: number, startAt: number, duration: number, baseGain: number, type: OscillatorType = 'sine') {
  const gain = baseGain * masterVolume * 1.6
  const audio = getContext()
  if (!audio) return
  const osc = audio.createOscillator()
  const gainNode = audio.createGain()
  osc.type = type
  osc.frequency.value = freq
  gainNode.gain.setValueAtTime(0, audio.currentTime + startAt)
  gainNode.gain.linearRampToValueAtTime(gain, audio.currentTime + startAt + 0.01)
  gainNode.gain.linearRampToValueAtTime(0, audio.currentTime + startAt + duration)
  osc.connect(gainNode)
  gainNode.connect(audio.destination)
  osc.start(audio.currentTime + startAt)
  osc.stop(audio.currentTime + startAt + duration + 0.02)
}

export type SoundCue = 'success' | 'error' | 'waiting-permission' | 'waiting-input'

// Several requests arriving together must not stack into a burst of beeps.
const CUE_THROTTLE_MS = 3_000
const lastPlayed = new Map<SoundCue, number>()

export function playCue(cue: SoundCue, options: { preview?: boolean } = {}) {
  const audio = getContext()
  if (!audio || masterVolume <= 0) return
  const nowMs = Date.now()
  if (!options.preview && nowMs - (lastPlayed.get(cue) ?? 0) < CUE_THROTTLE_MS) return
  lastPlayed.set(cue, nowMs)
  if (audio.state === 'suspended') audio.resume()

  switch (cue) {
    case 'success':
      beep(660, 0, 0.09, 0.12)
      beep(880, 0.09, 0.13, 0.12)
      break
    case 'error':
      // Two falling notes read as "oh no" rather than a single harsh buzz.
      beep(330, 0, 0.12, 0.1, 'triangle')
      beep(220, 0.13, 0.2, 0.1, 'triangle')
      break
    case 'waiting-input':
      // A soft rising pair: the agent is asking, not alarming.
      beep(440, 0, 0.08, 0.08)
      beep(587, 0.1, 0.12, 0.08)
      break
    case 'waiting-permission':
      // Rising-falling three-note figure, clearly different from the
      // two-note rising success cue.
      beep(988, 0, 0.09, 0.1, 'triangle')
      beep(740, 0.12, 0.09, 0.1, 'triangle')
      beep(988, 0.24, 0.14, 0.1, 'triangle')
      break
  }
}
