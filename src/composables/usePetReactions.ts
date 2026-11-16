// 一次性的視覺回饋：反應（擠壓彈跳 + 飄起的小圖示）、成就獎勵、游標注視。
// 用 CSS class 疊在循環動畫上，而不是額外的 sprite 格，所以不管圖集有幾列，每隻寵物都能用。
import { onUnmounted, ref } from 'vue'
import type { PresentationReaction } from '@/types/presentation'

// 每種反應有自己的動作（CSS class）和一個往上飄的小圖示；關閉動態效果時圖示仍會顯示。
const REACTION_MARKS: Record<PresentationReaction, string> = {
  happy: 'sparkle',
  curious: 'question',
  thinking: 'dots',
  surprised: 'exclaim',
  encouraging: 'heart',
}
const REACTION_DURATION_MS: Record<PresentationReaction, number> = {
  happy: 560, curious: 760, thinking: 900, surprised: 420, encouraging: 700,
}
// 反應標記的 CSS 動畫長度由這個常數經 --pet-mark-duration 帶進去，計時器與動畫只有一個來源。
export const REACTION_MARK_MS = 1400

export function usePetReactions() {
  const isReacting = ref(false)
  const reactionKind = ref<PresentationReaction | null>(null)
  const reactionMark = ref<{ id: number; icon: string } | null>(null)
  const isRewarding = ref(false)
  const cursorLookDirection = ref<-1 | 0 | 1>(0)
  let reactionTimer: ReturnType<typeof setTimeout> | null = null
  let reactionMarkTimer: ReturnType<typeof setTimeout> | null = null
  let rewardTimer: ReturnType<typeof setTimeout> | null = null
  let cursorLookTimer: ReturnType<typeof setTimeout> | null = null
  let reactionMarkId = 0

  function playReaction(kind?: PresentationReaction) {
    isReacting.value = false
    reactionKind.value = kind ?? null
    requestAnimationFrame(() => {
      isReacting.value = true
      if (reactionTimer) clearTimeout(reactionTimer)
      reactionTimer = setTimeout(() => { isReacting.value = false }, kind ? REACTION_DURATION_MS[kind] : 260)
    })
    if (kind) {
      reactionMark.value = { id: ++reactionMarkId, icon: REACTION_MARKS[kind] }
      if (reactionMarkTimer) clearTimeout(reactionMarkTimer)
      reactionMarkTimer = setTimeout(() => { reactionMark.value = null }, REACTION_MARK_MS)
    }
  }

  // 成就解鎖用獨立的視覺掛勾，新規則可以獎勵寵物，但不會改動狀態動畫或給予任何產品能力。
  function playReward() {
    isRewarding.value = false
    requestAnimationFrame(() => {
      isRewarding.value = true
      if (rewardTimer) clearTimeout(rewardTimer)
      rewardTimer = setTimeout(() => { isRewarding.value = false }, 900)
    })
  }

  function playCursorLook(direction: -1 | 1): void {
    cursorLookDirection.value = direction
    if (cursorLookTimer) clearTimeout(cursorLookTimer)
    cursorLookTimer = setTimeout(() => { cursorLookDirection.value = 0 }, 420)
  }

  onUnmounted(() => {
    for (const timer of [reactionTimer, rewardTimer, cursorLookTimer, reactionMarkTimer]) {
      if (timer !== null) clearTimeout(timer)
    }
  })

  return {
    isReacting, reactionKind, reactionMark, isRewarding, cursorLookDirection,
    playReaction, playReward, playCursorLook,
  }
}
