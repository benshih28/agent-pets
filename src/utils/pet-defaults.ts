// Pet feedback defaults. Key events (finish / fail / waiting) give feedback out
// of the box; decorative ambient motion and the tool-activity bubble stay
// opt-in. A user who ever flipped a switch has an explicit '0' / '1' stored and
// keeps that choice; only never-touched settings follow the new defaults.

export interface PetPrefStorage {
  getItem(key: string): string | null
}

/** Explicit '1' / '0' wins; a missing key falls back to `fallback`. */
export function readBooleanPref(storage: PetPrefStorage, key: string, fallback: boolean): boolean {
  let raw: string | null = null
  try {
    raw = storage.getItem(key)
  } catch {
    return fallback
  }
  if (raw === '1') return true
  if (raw === '0') return false
  return fallback
}

export interface PetFeedbackDefaults {
  reactions: boolean
  bubble: boolean
  ambient: boolean
  activity: boolean
}

/**
 * Ambient animation and the activity bubble are new switches. People who had
 * the old single "reactions" / "bubble" toggle on keep the behaviour they
 * opted into (legacy '1'), everyone else gets them off.
 */
export function readPetFeedbackDefaults(storage: PetPrefStorage): PetFeedbackDefaults {
  const legacyFx = storage.getItem('agent-pet-fx') === '1'
  const legacyBubble = storage.getItem('agent-pet-bubble') === '1'
  return {
    reactions: readBooleanPref(storage, 'agent-pet-fx', true),
    bubble: readBooleanPref(storage, 'agent-pet-bubble', true),
    ambient: readBooleanPref(storage, 'agent-pet-ambient', legacyFx),
    activity: readBooleanPref(storage, 'agent-pet-activity', legacyBubble),
  }
}
