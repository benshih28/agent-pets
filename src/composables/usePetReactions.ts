import { onUnmounted, ref } from 'vue'
import type { PresentationReaction } from '@/types/presentation'

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
// 經 --pet-mark-duration 帶進 CSS 動畫，計時器與動畫共用這一個來源。
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
