// 測試會直接用 Node 執行這個檔案，執行期 import 必須是相對路徑（見 agent-pets-conventions §1）。
import { SOUND_CUE_REGISTRY, SOUND_POLICY, type SoundCue, type SoundCueSwitch } from '../types/sound.ts'

export interface SoundGate extends Readonly<Record<SoundCueSwitch, boolean>> {
  readonly soundEnabled: boolean
  readonly dndEnabled: boolean
  /** 寵物視窗確實在螢幕上（沒有被全螢幕或收進系統匣）。 */
  readonly petVisible: boolean
}

/** 這個音效能不能播：總開關、勿擾、可見性與 registry 指定的 cue 開關都要通過。 */
export function shouldPlayCue(cue: SoundCue, gate: SoundGate): boolean {
  if (!gate.soundEnabled || gate.dndEnabled || !gate.petVisible) return false
  const toggle = SOUND_CUE_REGISTRY[cue].toggle
  return toggle ? gate[toggle.key] : true
}

/** 完成的任務值不值得出聲；不知道耗時（undefined 或非有限值）時照樣播。 */
export function shouldPlaySuccessSound(elapsedMs: number | undefined): boolean {
  return elapsedMs === undefined || !Number.isFinite(elapsedMs) || elapsedMs >= SOUND_POLICY.successMinElapsedMs
}
