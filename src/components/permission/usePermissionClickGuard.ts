// 新請求出現後的短暫點擊保護：正伸向上一個請求按鈕的手指，不能落在這一個的「允許」上。
// 保護結束時呼叫 onArmed，讓呼叫端把焦點移到安全選項（拒絕）。
import { onBeforeUnmount, ref } from 'vue'
import { PERMISSION_CLICK_GUARD_MS } from '@/utils/permission-view'

export function usePermissionClickGuard(onArmed: () => void) {
  const armed = ref(false)
  let armTimer: ReturnType<typeof setTimeout> | null = null

  function arm(): void {
    armed.value = false
    if (armTimer) clearTimeout(armTimer)
    armTimer = setTimeout(() => {
      armTimer = null
      armed.value = true
      onArmed()
    }, PERMISSION_CLICK_GUARD_MS)
  }

  onBeforeUnmount(() => {
    if (armTimer) clearTimeout(armTimer)
  })

  return { armed, arm }
}
