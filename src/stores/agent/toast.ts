import { onScopeDispose, ref } from 'vue'
import { t } from '@/i18n'
import { SOURCE_LABELS, type AgentSource } from '@/types/agent'
import { formatProject } from '@/utils/format'
import { formatElapsedShort, toastDurationFor, type ToastTone } from '@/utils/pet-toast'
import { createToastCountdown, type ToastCountdown } from '@/utils/toast-countdown'

export interface PetToast {
  id: number
  tone: ToastTone
  title: string
  meta: string
  detail?: string
  count: number
  countdown: ToastCountdown
}

const TOAST_TITLE_KEYS = {
  success: 'pet.toastDone',
  error: 'pet.toastFailed',
  waiting: 'pet.toastWaiting',
} as const satisfies Record<ToastTone, string>

const TOAST_PROGRESS_TICK_MS = 100

export function useToastQueue() {
  const toast = ref<PetToast | null>(null)
  const toastPaused = ref(false)
  const toastRemainingMs = ref(0)
  let toastPausedRemainingMs: number | null = null
  let toastTimer: ReturnType<typeof setTimeout> | null = null
  let toastProgressTimer: ReturnType<typeof setTimeout> | null = null
  let toastSequence = 0

  function clearToastTimers() {
    if (toastTimer) clearTimeout(toastTimer)
    if (toastProgressTimer) clearTimeout(toastProgressTimer)
    toastTimer = null
    toastProgressTimer = null
  }

  function armToastTimers(toastId: number, remainingMs: number) {
    clearToastTimers()
    toastRemainingMs.value = remainingMs
    const startedAt = Date.now()
    const tick = () => {
      if (toast.value?.id !== toastId) return
      const remaining = Math.max(0, remainingMs - (Date.now() - startedAt))
      toastRemainingMs.value = remaining
      toastProgressTimer = remaining > 0 ? setTimeout(tick, Math.min(TOAST_PROGRESS_TICK_MS, remaining)) : null
    }
    toastProgressTimer = setTimeout(tick, TOAST_PROGRESS_TICK_MS)
    toastTimer = setTimeout(() => {
      if (toast.value?.id !== toastId) return
      dismissToast()
    }, remainingMs)
  }

  function dismissToast() {
    clearToastTimers()
    toast.value = null
    toastRemainingMs.value = 0
    toastPaused.value = false
    toastPausedRemainingMs = null
  }

  function pauseToast() {
    if (!toast.value || toastPaused.value) return
    toastPausedRemainingMs = toastRemainingMs.value
    toastPaused.value = true
    clearToastTimers()
  }

  function resumeToast() {
    const current = toast.value
    if (!current || !toastPaused.value) return
    const remaining = toastPausedRemainingMs ?? 0
    toastPaused.value = false
    toastPausedRemainingMs = null
    if (remaining <= 0) dismissToast()
    else armToastTimers(current.id, remaining)
  }

  function showToast(
    source: AgentSource,
    project: string | undefined,
    tone: ToastTone,
    elapsedMs?: number,
  ) {
    const label = SOURCE_LABELS[source]
    const proj = formatProject(project)
    const durationMs = toastDurationFor(tone)
    const countdown = createToastCountdown(tone, Date.now(), durationMs)
    if (!countdown) return

    const previous = toast.value
    const count = tone === 'success' && previous?.tone === 'success' ? previous.count + 1 : 1
    const elapsed = formatElapsedShort(elapsedMs)
    const nextToast: PetToast = {
      id: ++toastSequence,
      tone,
      title: count > 1 ? t('pet.toastManyDone', { count }) : t(TOAST_TITLE_KEYS[tone]),
      meta: count > 1 ? '' : proj ? `${label} · ${proj}` : label,
      ...(count === 1 && elapsed ? { detail: t('pet.toastElapsed', { time: elapsed }) } : {}),
      count,
      countdown,
    }

    toast.value = nextToast
    toastPaused.value = false
    toastPausedRemainingMs = null
    armToastTimers(nextToast.id, durationMs)
  }

  onScopeDispose(clearToastTimers)

  return {
    toast,
    toastPaused,
    toastRemainingMs,
    showToast,
    dismissToast,
    pauseToast,
    resumeToast,
  }
}
