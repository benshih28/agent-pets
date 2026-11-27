// A user who ever flipped a switch has an explicit '0' / '1' stored and keeps that choice;
// only never-touched settings follow the new defaults.
import { STORAGE_KEYS } from './storage-keys.ts'

export interface PetPrefStorage {
  getItem(key: string): string | null
}

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

/** People with the old single "reactions" / "bubble" toggle on (legacy '1') keep ambient / activity on; everyone else gets them off. */
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
