import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

/** 倒數條的 width transition 以同一個間隔補間，兩者必須一致（PermissionCountdown.vue）。 */
export const PERMISSION_CLOCK_INTERVAL_MS = 1000

/** Wall-clock ticker (1 Hz) that only runs while the component is mounted. */
export function usePermissionClock(): Ref<number> {
  const now = ref(Date.now())
  let timer: ReturnType<typeof setInterval> | null = null
  onMounted(() => {
    now.value = Date.now()
    timer = setInterval(() => { now.value = Date.now() }, PERMISSION_CLOCK_INTERVAL_MS)
  })
  onBeforeUnmount(() => {
    if (timer) clearInterval(timer)
    timer = null
  })
  return now
}
