import { onScopeDispose, ref } from 'vue'
import type { AgentSession } from '@/types/agent'
import type { SoundCue } from '@/types/sound'
import type { useToastQueue } from '@/stores/agent/toast'
import { AGENT_STATE_PRESENTATION } from '@/utils/agent-state-presentation'
import { UNREAD_AWAY_MS, WAITING_INPUT_DELAY_MS } from '@/utils/pet-toast'
import { noteUnread } from '@/utils/unread-results'

export interface UnreadAlertsDeps {
  sessionByKey: (key: string) => AgentSession | undefined
  showToast: ReturnType<typeof useToastQueue>['showToast']
  /** 偏好設定模組在這之後才建立，所以用 getter 讀。 */
  completionMarkersEnabled: () => boolean
}

export function useUnreadAlerts(deps: UnreadAlertsDeps) {
  const unreadResults = ref({ count: 0, hasError: false })
  let lastPetInteractionAt = Date.now()
  let cueSink: ((cue: SoundCue) => void) | null = null
  const waitingInputTimers = new Map<string, ReturnType<typeof setTimeout>>()

  function markPetInteraction() {
    lastPetInteractionAt = Date.now()
  }

  function clearUnreadResults() {
    if (unreadResults.value.count === 0) return
    unreadResults.value = { count: 0, hasError: false }
  }

  function noteUnreadResult(tone: 'success' | 'error') {
    const away = Date.now() - lastPetInteractionAt >= UNREAD_AWAY_MS
    const next = noteUnread(unreadResults.value, tone, deps.completionMarkersEnabled(), away)
    if (next !== unreadResults.value) unreadResults.value = next
  }

  function setCueSink(sink: ((cue: SoundCue) => void) | null) {
    cueSink = sink
  }

  function cancelWaitingInputReminder(key: string) {
    const timer = waitingInputTimers.get(key)
    if (timer) clearTimeout(timer)
    waitingInputTimers.delete(key)
  }

  // Grace period so a question answered at once never flashes a bubble.
  function scheduleWaitingInputReminder(key: string) {
    cancelWaitingInputReminder(key)
    waitingInputTimers.set(key, setTimeout(() => {
      waitingInputTimers.delete(key)
      const session = deps.sessionByKey(key)
      if (!session || session.state !== 'waiting-input') return
      deps.showToast(session.source, session.project, 'waiting')
      cueSink?.(AGENT_STATE_PRESENTATION['waiting-input'].cue)
    }, WAITING_INPUT_DELAY_MS))
  }

  onScopeDispose(() => {
    for (const timer of waitingInputTimers.values()) clearTimeout(timer)
    waitingInputTimers.clear()
  })

  return {
    unreadResults,
    markPetInteraction,
    clearUnreadResults,
    noteUnreadResult,
    setCueSink,
    scheduleWaitingInputReminder,
    cancelWaitingInputReminder,
  }
}
