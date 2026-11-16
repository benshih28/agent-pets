// 寵物視窗的本機顯示偏好：大小、多寵物，以及反應／泡泡／ambient／activity 四個回饋開關。
// 這些只影響這台機器的畫面，所以存在 renderer 的 localStorage，不經過主程序。
//
// - 事件輸入：面板設定頁呼叫各個 setter。
// - 計時器：無。
// - storage：`agent-pet-scale`、`-multi`、`-fx`、`-bubble`、`-ambient`、`-activity`；
//   回饋開關的啟動預設與舊 key 遷移規則在 `readPetFeedbackDefaults()`。
// - 跨視窗同步：App.vue 的 storage 事件直接寫入這些 ref（不再寫回 storage）。
import { ref } from 'vue'
import { readStored, safeStorageReader, writeStored } from '@/utils/local-storage'
import { readPetFeedbackDefaults } from '@/utils/pet-defaults'
import { STORAGE_KEYS } from '@/utils/storage-keys'

export function usePetDisplayPreferences() {
  const petScale = ref(readStored(STORAGE_KEYS.petScale))

  // Off by default — showing one pet per active tool family is a bigger
  // visual/layout change than the other additions, so it stays opt-in
  // rather than silently changing behavior for people with 2+ tools running.
  const multiPetEnabled = ref(readStored(STORAGE_KEYS.multiPet))

  // On by default (key-event feedback: reaction bounce, urgency shake, reward
  // glow). Decorative ambient motion is a separate, opt-in switch below.
  // Off leaves the core sprite state animation (and frame speed-up / mood glow) untouched.
  const feedbackDefaults = readPetFeedbackDefaults(safeStorageReader)
  const reactionsEnabled = ref(feedbackDefaults.reactions)

  // On by default — completion / failure / waiting bubbles. The noisier
  // "what's it doing" tool-activity bubble is its own opt-in switch.
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
