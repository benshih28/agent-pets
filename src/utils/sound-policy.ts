import type { SoundCue } from '@/utils/sound'

export interface SoundGate {
  soundEnabled: boolean
  dndEnabled: boolean
  soundOnPermission: boolean
  soundOnError: boolean
  soundOnSuccess: boolean
  /** The pet window is actually on screen (not hidden by fullscreen / tray). */
  petVisible: boolean
}

/** Whether a cue may be heard: master switch, DND, per-cue switch and visibility. */
export function shouldPlayCue(cue: SoundCue, gate: SoundGate): boolean {
  if (!gate.soundEnabled || gate.dndEnabled || !gate.petVisible) return false
  switch (cue) {
    case 'waiting-permission': return gate.soundOnPermission
    case 'error': return gate.soundOnError
    case 'success': return gate.soundOnSuccess
    // Cues added by other features only follow the master gates above.
    default: return true
  }
}
