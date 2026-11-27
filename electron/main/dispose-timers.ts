import type { MainState } from './state'

type TimerKey =
  | 'resizeAnimHandle' | 'dragPollHandle' | 'shimejiPersistHandle' | 'persistBoundsHandle'
  | 'edgeDwellHandle' | 'panelBlurHideHandle' | 'panelSettleTimer'
  | 'localUsageScanTimer' | 'achievementStoreRetryTimer' | 'pluginCatalogAutoCheckTimer'

export const MAIN_STATE_TIMER_KEYS: readonly TimerKey[] = [
  'resizeAnimHandle', 'dragPollHandle', 'shimejiPersistHandle', 'persistBoundsHandle',
  'edgeDwellHandle', 'panelBlurHideHandle', 'panelSettleTimer',
  'localUsageScanTimer', 'achievementStoreRetryTimer', 'pluginCatalogAutoCheckTimer',
]

export function disposeMainTimers(state: Pick<MainState, TimerKey>): void {
  for (const key of MAIN_STATE_TIMER_KEYS) {
    const handle = state[key] as ReturnType<typeof setTimeout> | null
    if (handle) {
      // clearTimeout and clearInterval are interchangeable for Node timers.
      clearTimeout(handle)
      ;(state as Record<TimerKey, unknown>)[key] = null
    }
  }
}
