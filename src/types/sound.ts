import type { TranslationKey } from '@/i18n'
import type { DesktopPreferences } from '@/types/desktop'
import { deepFreeze } from './freeze.ts'

// 主程序、Node 測試、renderer 都會載入這個檔案，所以只放純資料；唯一的執行期 import 是同樣沒有相依的 ./freeze.ts。

export type SoundCue = 'waiting-permission' | 'error' | 'success' | 'waiting-input'

export type SoundWaveform = 'sine' | 'triangle'

export interface SoundTone {
  /** Hz。 */
  readonly freq: number
  /** 相對於播放當下的秒數。 */
  readonly startAt: number
  /** 秒；音量在這段時間內從峰值線性降到 0。 */
  readonly duration: number
  /** 音量 100% 之前的峰值增益，實際峰值再乘上 SOUND_ENVELOPE.gainScale。 */
  readonly gain: number
  readonly type: SoundWaveform
}

export type SoundCueSwitch = 'soundOnPermission' | 'soundOnError' | 'soundOnSuccess'

export interface SoundCueSpec {
  readonly tones: readonly SoundTone[]
  /** null 表示只跟總開關（waiting-input 沒有獨立開關，設定頁也不列）。 */
  readonly toggle: { readonly key: SoundCueSwitch; readonly labelKey: TranslationKey } | null
  readonly previewKey: TranslationKey | null
}

// key 的順序就是設定頁開關與試聽按鈕的順序。
export const SOUND_CUE_REGISTRY = deepFreeze({
  'waiting-permission': {
    tones: [
      { freq: 988, startAt: 0, duration: 0.09, gain: 0.1, type: 'triangle' },
      { freq: 740, startAt: 0.12, duration: 0.09, gain: 0.1, type: 'triangle' },
      { freq: 988, startAt: 0.24, duration: 0.14, gain: 0.1, type: 'triangle' },
    ],
    toggle: { key: 'soundOnPermission', labelKey: 'permission.soundOnPermission' },
    previewKey: 'permission.soundPreviewPermission',
  },
  error: {
    tones: [
      { freq: 330, startAt: 0, duration: 0.12, gain: 0.1, type: 'triangle' },
      { freq: 220, startAt: 0.13, duration: 0.2, gain: 0.1, type: 'triangle' },
    ],
    toggle: { key: 'soundOnError', labelKey: 'permission.soundOnError' },
    previewKey: 'permission.soundPreviewError',
  },
  success: {
    tones: [
      { freq: 660, startAt: 0, duration: 0.09, gain: 0.12, type: 'sine' },
      { freq: 880, startAt: 0.09, duration: 0.13, gain: 0.12, type: 'sine' },
    ],
    toggle: { key: 'soundOnSuccess', labelKey: 'permission.soundOnSuccess' },
    previewKey: 'permission.soundPreviewSuccess',
  },
  'waiting-input': {
    tones: [
      { freq: 440, startAt: 0, duration: 0.08, gain: 0.08, type: 'sine' },
      { freq: 587, startAt: 0.1, duration: 0.12, gain: 0.08, type: 'sine' },
    ],
    toggle: null,
    previewKey: null,
  },
} as const satisfies Record<SoundCue, SoundCueSpec>)

export const SOUND_CUES: readonly SoundCue[] = Object.freeze(Object.keys(SOUND_CUE_REGISTRY) as SoundCue[])

export const SOUND_CUE_TOGGLES = deepFreeze(SOUND_CUES.flatMap(cue => {
  const toggle = SOUND_CUE_REGISTRY[cue].toggle
  return toggle ? [toggle] : []
}))

export const SOUND_CUE_PREVIEWS = deepFreeze(SOUND_CUES.flatMap(cue => {
  const labelKey = SOUND_CUE_REGISTRY[cue].previewKey
  return labelKey ? [{ cue, labelKey }] : []
}))

export const SOUND_ENVELOPE = deepFreeze({
  attackSec: 0.01,
  /** 音量降到 0 之後再多留一點才停振盪器，避免截斷時爆音。 */
  stopTailSec: 0.02,
  gainScale: 1.6,
})

export const SOUND_POLICY = deepFreeze({
  /** 同一個 cue 在這段時間內只播一次，多個請求同時到達時不會疊成一連串嗶聲；試聽不受限。 */
  cueThrottleMs: 3_000,
  /** 短任務在使用者來得及離開前就結束了，不值得出聲；不知道耗時的仍然播。 */
  successMinElapsedMs: 15_000,
})

export const SOUND_VOLUME = deepFreeze({ min: 0, max: 100, step: 5 })

type SoundPreferenceKey = 'soundEnabled' | 'soundVolume' | SoundCueSwitch

export const SOUND_DEFAULTS: Readonly<Pick<DesktopPreferences, SoundPreferenceKey>> = deepFreeze({
  // 預設關閉，不讓 App 突然出聲；使用者在設定頁自己打開。
  soundEnabled: false,
  soundVolume: 60,
  soundOnPermission: true,
  soundOnError: true,
  soundOnSuccess: true,
})
