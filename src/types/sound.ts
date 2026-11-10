import type { TranslationKey } from '@/i18n'
import type { DesktopPreferences } from '@/types/desktop'
import { deepFreeze } from './freeze.ts'

// --- 音效 registry --------------------------------------------------------------
// 每個 cue 的音形、跟哪個開關、設定頁怎麼試聽，以及節流、音量、預設值，都只寫在這個檔案。
// 哪個 Agent 狀態播哪個 cue 不在這裡：那是 AGENT_STATE_PRESENTATION 的 cue 欄位，store 依狀態轉換決定何時播。
// 主程序（desktop-preferences）、Node 測試、renderer 都會載入這個檔案，所以這裡只放純資料；唯一的執行期 import 是同樣沒有相依的 ./freeze.ts。

export type SoundCue = 'waiting-permission' | 'error' | 'success' | 'waiting-input'

/** 只列實際用到的波形；新增前先確認聽起來跟既有 cue 分得開。 */
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

/** DesktopPreferences 裡各 cue 自己的開關。 */
export type SoundCueSwitch = 'soundOnPermission' | 'soundOnError' | 'soundOnSuccess'

export interface SoundCueSpec {
  readonly tones: readonly SoundTone[]
  /** null 表示只跟總開關（waiting-input 沒有獨立開關，設定頁也不列）。 */
  readonly toggle: { readonly key: SoundCueSwitch; readonly labelKey: TranslationKey } | null
  /** 設定頁試聽按鈕的文字；null 表示不提供試聽。 */
  readonly previewKey: TranslationKey | null
}

// key 的順序就是設定頁開關與試聽按鈕的順序。
export const SOUND_CUE_REGISTRY = deepFreeze({
  // 上升再下降的三音，和兩音上升的成功音效明顯不同。
  'waiting-permission': {
    tones: [
      { freq: 988, startAt: 0, duration: 0.09, gain: 0.1, type: 'triangle' },
      { freq: 740, startAt: 0.12, duration: 0.09, gain: 0.1, type: 'triangle' },
      { freq: 988, startAt: 0.24, duration: 0.14, gain: 0.1, type: 'triangle' },
    ],
    toggle: { key: 'soundOnPermission', labelKey: 'permission.soundOnPermission' },
    previewKey: 'permission.soundPreviewPermission',
  },
  // 兩個下降音聽起來像「糟糕」，比單一刺耳的嗡聲溫和。
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
  // 輕柔的上升兩音：agent 是在詢問，不是警報。
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

/** 設定頁的各 cue 開關，依 registry 順序。 */
export const SOUND_CUE_TOGGLES = deepFreeze(SOUND_CUES.flatMap(cue => {
  const toggle = SOUND_CUE_REGISTRY[cue].toggle
  return toggle ? [toggle] : []
}))

/** 設定頁的試聽按鈕，依 registry 順序。 */
export const SOUND_CUE_PREVIEWS = deepFreeze(SOUND_CUES.flatMap(cue => {
  const labelKey = SOUND_CUE_REGISTRY[cue].previewKey
  return labelKey ? [{ cue, labelKey }] : []
}))

/** 每個音共用的包絡（秒）與整體增益倍率。 */
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

/** 音量設定的範圍與滑桿步進（百分比）。 */
export const SOUND_VOLUME = deepFreeze({ min: 0, max: 100, step: 5 })

type SoundPreferenceKey = 'soundEnabled' | 'soundVolume' | SoundCueSwitch

/** 持久化設定的預設值；主程序的 DEFAULTS 與 renderer store 的初始值都從這裡來。 */
export const SOUND_DEFAULTS: Readonly<Pick<DesktopPreferences, SoundPreferenceKey>> = deepFreeze({
  // 預設關閉，不讓 App 突然出聲；使用者在設定頁自己打開。
  soundEnabled: false,
  soundVolume: 60,
  soundOnPermission: true,
  soundOnError: true,
  soundOnSuccess: true,
})
