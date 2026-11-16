// 泡泡內的鍵盤操作（只在焦點位於泡泡內時生效，絕不是全域）：Esc／N 拒絕，Y 允許。
// 低／中風險以外的請求要按住 Y，避免誤觸核准有風險的動作。
import { computed, onBeforeUnmount, ref, type ComputedRef } from 'vue'

const HOLD_TO_ALLOW_MS = 600

export function usePermissionKeyboard(options: {
  risk: ComputedRef<string | undefined>
  decide: (decision: 'allow_once' | 'deny', viaKeyboard?: boolean) => void
}) {
  const needsHold = computed(() => options.risk.value !== 'low' && options.risk.value !== 'medium')
  const holdProgress = ref(false)
  let holdTimer: ReturnType<typeof setTimeout> | null = null

  function cancelHold(): void {
    if (holdTimer) clearTimeout(holdTimer)
    holdTimer = null
    holdProgress.value = false
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return
    const key = event.key.toLowerCase()
    if (key === 'escape' || key === 'n') {
      event.preventDefault()
      options.decide('deny', true)
      return
    }
    if (key !== 'y') return
    event.preventDefault()
    if (!needsHold.value) {
      if (!event.repeat) options.decide('allow_once')
      return
    }
    if (event.repeat || holdTimer) return
    holdProgress.value = true
    holdTimer = setTimeout(() => {
      holdTimer = null
      holdProgress.value = false
      options.decide('allow_once')
    }, HOLD_TO_ALLOW_MS)
  }

  function onKeyup(event: KeyboardEvent): void {
    if (event.key.toLowerCase() === 'y') cancelHold()
  }

  onBeforeUnmount(cancelHold)

  return { needsHold, holdProgress, cancelHold, onKeydown, onKeyup }
}
