import { computed, onUnmounted, ref } from 'vue'
import type { AgentState } from '@/types/agent'

export function usePetFidget(isPaused: () => boolean, state: () => AgentState) {
  const isFidgeting = ref(false)
  let fidgetTimer: ReturnType<typeof setTimeout> | null = null
  let fidgetResetTimer: ReturnType<typeof setTimeout> | null = null

  function schedule() {
    if (isPaused()) return
    if (fidgetTimer) clearTimeout(fidgetTimer)
    const delay = 6000 + Math.random() * 9000
    fidgetTimer = setTimeout(() => {
      if (state() === 'idle') {
        isFidgeting.value = false
        requestAnimationFrame(() => {
          isFidgeting.value = true
          if (fidgetResetTimer) clearTimeout(fidgetResetTimer)
          fidgetResetTimer = setTimeout(() => { isFidgeting.value = false }, 700)
        })
      }
      schedule()
    }, delay)
  }

  function stop() {
    if (fidgetTimer) {
      clearTimeout(fidgetTimer)
      fidgetTimer = null
    }
    if (fidgetResetTimer) {
      clearTimeout(fidgetResetTimer)
      fidgetResetTimer = null
    }
    isFidgeting.value = false
  }

  onUnmounted(stop)

  return { isFidgeting, schedule, stop }
}

export function usePetUrgency(isPaused: () => boolean, state: () => AgentState, since: () => number | undefined) {
  const isWaiting = computed(() => state() === 'waiting-permission' || state() === 'waiting-input')
  const urgencyTick = ref(Date.now())
  let urgencyTimer: ReturnType<typeof setInterval> | null = null

  function start() {
    if (urgencyTimer || isPaused()) return
    urgencyTick.value = Date.now()
    urgencyTimer = setInterval(() => { urgencyTick.value = Date.now() }, 500)
  }

  function stop() {
    if (urgencyTimer) {
      clearInterval(urgencyTimer)
      urgencyTimer = null
    }
  }

  const urgencyLevel = computed<0 | 1 | 2>(() => {
    const startedAt = since()
    if (!isWaiting.value || !startedAt) return 0
    const elapsedSec = Math.max(0, urgencyTick.value - startedAt) / 1000
    if (elapsedSec >= 30) return 2
    if (elapsedSec >= 12) return 1
    return 0
  })

  onUnmounted(stop)

  return { isWaiting, urgencyLevel, start, stop }
}
