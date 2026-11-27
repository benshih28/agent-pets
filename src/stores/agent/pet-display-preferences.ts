import { ref } from 'vue'
import { readStored, safeStorageReader, writeStored } from '@/utils/local-storage'
import { readPetFeedbackDefaults } from '@/utils/pet-defaults'
import { STORAGE_KEYS } from '@/utils/storage-keys'

export function usePetDisplayPreferences() {
  const petScale = ref(readStored(STORAGE_KEYS.petScale))

  const multiPetEnabled = ref(readStored(STORAGE_KEYS.multiPet))

  const feedbackDefaults = readPetFeedbackDefaults(safeStorageReader)
  const reactionsEnabled = ref(feedbackDefaults.reactions)

  const bubbleEnabled = ref(feedbackDefaults.bubble)
  const ambientEnabled = ref(feedbackDefaults.ambient)
  const activityBubbleEnabled = ref(feedbackDefaults.activity)

  function setScale(scale: number) {
    petScale.value = scale
    writeStored(STORAGE_KEYS.petScale, scale)
  }

  function setMultiPetEnabled(enabled: boolean) {
    multiPetEnabled.value = enabled
    writeStored(STORAGE_KEYS.multiPet, enabled)
  }

  function setReactionsEnabled(enabled: boolean) {
    reactionsEnabled.value = enabled
    writeStored(STORAGE_KEYS.reactions, enabled)
  }

  function setBubbleEnabled(enabled: boolean) {
    bubbleEnabled.value = enabled
    writeStored(STORAGE_KEYS.bubble, enabled)
  }

  function setAmbientEnabled(enabled: boolean) {
    ambientEnabled.value = enabled
    writeStored(STORAGE_KEYS.ambient, enabled)
  }

  function setActivityBubbleEnabled(enabled: boolean) {
    activityBubbleEnabled.value = enabled
    writeStored(STORAGE_KEYS.activityBubble, enabled)
  }

  return {
    petScale,
    multiPetEnabled,
    reactionsEnabled,
    bubbleEnabled,
    ambientEnabled,
    activityBubbleEnabled,
    setScale,
    setMultiPetEnabled,
    setReactionsEnabled,
    setBubbleEnabled,
    setAmbientEnabled,
    setActivityBubbleEnabled,
  }
}
