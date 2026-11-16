// 首次啟動的 coach mark：只在從未看過、且沒有其他泡泡佔用時顯示，20 秒後或第一次按下寵物就收起。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useAgentStore } from '@/stores/agentStore'
import type { BubbleKind } from '@/utils/feed-arbiter'
import { STORAGE_KEYS } from '@/utils/storage-keys'
import { readStored, writeStored } from '@/utils/local-storage'

const COACH_VISIBLE_MS = 20_000

export function usePetCoachMark(bubbleSelection: () => BubbleKind | null) {
  const store = useAgentStore()
  const armed = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null

  function dismiss(): void {
    if (timer) clearTimeout(timer)
    timer = null
    if (!armed.value) return
    armed.value = false
    writeStored(STORAGE_KEYS.coachSeen, true)
  }

  function arm(): void {
    if (readStored(STORAGE_KEYS.coachSeen)) return
    armed.value = true
    timer = setTimeout(dismiss, COACH_VISIBLE_MS)
  }

  const shown = computed(() => (
    armed.value
    && bubbleSelection() === null
    && store.petWindowMode.mode === 'normal'
    && store.desktopPreferencesReady
    && !store.dndEnabled
  ))

  onMounted(arm)
  onBeforeUnmount(() => {
    if (timer) clearTimeout(timer)
  })

  return { shown, dismiss }
}
