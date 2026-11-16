// Pet feedback defaults. Key events (finish / fail / waiting) give feedback out
// of the box; decorative ambient motion and the tool-activity bubble stay
// opt-in. A user who ever flipped a switch has an explicit '0' / '1' stored and
// keeps that choice; only never-touched settings follow the new defaults.
import { STORAGE_KEYS } from './storage-keys.ts'

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
  const { reactions, bubble, ambient, activityBubble } = STORAGE_KEYS
  const legacyFx = storage.getItem(reactions.key) === '1'
  const legacyBubble = storage.getItem(bubble.key) === '1'
  return {
    reactions: readBooleanPref(storage, reactions.key, true),
    bubble: readBooleanPref(storage, bubble.key, true),
    ambient: readBooleanPref(storage, ambient.key, legacyFx),
    activity: readBooleanPref(storage, activityBubble.key, legacyBubble),
  }
}
