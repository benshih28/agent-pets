import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

/** Wall-clock ticker (1 Hz) that only runs while the component is mounted. */
export function usePermissionClock(): Ref<number> {
  const now = ref(Date.now())
  let timer: ReturnType<typeof setInterval> | null = null
  onMounted(() => {
    now.value = Date.now()
    timer = setInterval(() => { now.value = Date.now() }, 1000)
  })
  onBeforeUnmount(() => {
    if (timer) clearInterval(timer)
    timer = null
  })
  return now
}
