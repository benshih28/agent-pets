// 權限泡泡的畫面狀態。Permission Broker 在主程序：它決定有哪些請求、何時到期、決定是否送達；
// 這裡只顯示 broker 廣播的佇列、把使用者按的選項原樣轉給主程序，並在請求離開佇列時短暫顯示結果。
// renderer 不自己核准、拒絕或延長任何請求。
//
// - 事件輸入：`setPermissionRequests()`（broker 廣播的完整佇列，先在這裡重新驗證形狀）、
//   `decidePermission()`（使用者按下的選項）、`dismissPermissionOutcome()`。
// - 對外依賴：`settleWaitingPermission(agentId, sessionId)`，由主 store 把被擋住的 session 改回 idle（只影響畫面）。
// - 計時器：結果卡片一個，換新結果或關掉時清掉，store 的 effect scope 結束時也會清掉。
// - storage：無。
// - 跨視窗同步：無；主程序把同一份佇列廣播給寵物與面板兩個視窗。
import { computed, onScopeDispose, shallowRef } from 'vue'
import type {
  PermissionDecideResult,
  PermissionDecisionValue,
  PermissionOutcome,
  PermissionOutcomeKind,
  PermissionRequestView,
} from '@/types/permission'
import { classifyDecideResponse, inferVanishedOutcome, outcomeVisibleMs } from '@/utils/permission-view'

type OutcomeSubject = Pick<PermissionRequestView, 'requestId' | 'agentId' | 'action' | 'projectId'>

function isActiveRequestView(request: unknown, now: number): request is PermissionRequestView {
  if (!request || typeof request !== 'object') return false
  const candidate = request as Partial<PermissionRequestView>
  return typeof candidate.requestId === 'string'
    && typeof candidate.action === 'string'
    && typeof candidate.description === 'string'
    && typeof candidate.expiresAt === 'number'
    && Number.isFinite(candidate.expiresAt)
    && candidate.expiresAt > now
    && (candidate.status === 'pending' || candidate.status === 'deciding')
    && Array.isArray(candidate.allowedDecisions)
}

export function usePermissionUi(settleWaitingPermission: (agentId: string, sessionId: string) => void) {
  // shallowRef: always replaced wholesale by setPermissionRequests, never mutated in place.
  const permissionRequests = shallowRef<PermissionRequestView[]>([])
  const permissionRequest = computed(() => permissionRequests.value[0] ?? null)

  // Result of the most recent request that left the broker's active queue
  // (expired, handled elsewhere, delivery failed). Shown briefly so a bubble
  // never just vanishes silently.
  const permissionOutcome = shallowRef<PermissionOutcome | null>(null)
  let permissionOutcomeTimer: ReturnType<typeof setTimeout> | null = null
  // Requests with a decide() call in flight: the broker's broadcast can land
  // before the IPC result does, and that result decides what the UI says.
  const decidingRequestIds = new Set<string>()

  function clearOutcomeTimer() {
    if (permissionOutcomeTimer) clearTimeout(permissionOutcomeTimer)
    permissionOutcomeTimer = null
  }

  function showPermissionOutcome(request: OutcomeSubject, kind: PermissionOutcomeKind): void {
    clearOutcomeTimer()
    permissionOutcome.value = {
      kind,
      requestId: request.requestId,
      agentId: request.agentId,
      action: request.action,
      ...(request.projectId ? { projectId: request.projectId } : {}),
      at: Date.now(),
    }
    permissionOutcomeTimer = setTimeout(dismissPermissionOutcome, outcomeVisibleMs(kind))
  }

  function dismissPermissionOutcome(): void {
    clearOutcomeTimer()
    permissionOutcome.value = null
  }

  function setPermissionRequests(value: unknown): void {
    if (!Array.isArray(value)) {
      permissionRequests.value = []
      return
    }
    const now = Date.now()
    const next = value.filter((request): request is PermissionRequestView => isActiveRequestView(request, now))
    // A request that drops out of the pending/deciding set — decided,
    // expired, or cancelled — is done blocking its session even if we were
    // never told the outcome explicitly (e.g. TTL expiry has no decidePermission
    // caller at all).
    const stillPending = new Set(next.map(request => request.requestId))
    for (const request of permissionRequests.value) {
      if (stillPending.has(request.requestId)) continue
      // decidePermission() reports and settles these itself once the IPC returns.
      if (decidingRequestIds.has(request.requestId)) continue
      settleWaitingPermission(request.agentId, request.sessionId)
      showPermissionOutcome(request, inferVanishedOutcome(request, now))
    }
    // A new request supersedes any result card for an older one.
    if (next.length > 0 && permissionOutcome.value?.kind !== 'error') dismissPermissionOutcome()
    permissionRequests.value = next
  }

  async function initializePermissionRequests(): Promise<void> {
    try {
      setPermissionRequests(await window.electronAPI?.initializePermissionRequests())
    } catch {
      permissionRequests.value = []
    }
  }

  async function decidePermission(
    requestId: string,
    decision: PermissionDecisionValue,
  ): Promise<PermissionDecideResult> {
    // The broker queue is a handful of entries at most; a linear find is cheaper than keeping an index in sync.
    const request = permissionRequests.value.find(candidate => candidate.requestId === requestId)
    if (!request) return { ok: false, kind: 'cancelled' }
    decidingRequestIds.add(requestId)
    let result: PermissionDecideResult
    try {
      result = classifyDecideResponse(await window.electronAPI?.decidePermission(requestId, decision))
    } catch (error) {
      console.warn('[permission] decision IPC failed', error instanceof Error ? error.name : 'unknown')
      result = { ok: false, kind: 'error' }
    } finally {
      decidingRequestIds.delete(requestId)
    }
    // Only a delivered decision means the agent is no longer waiting. For a
    // failed delivery or IPC error the pet must keep showing the wait — the
    // agent really is still blocked.
    if (result.ok || result.kind === 'cancelled' || result.kind === 'expired') {
      settleWaitingPermission(request.agentId, request.sessionId)
    }
    if (!result.ok) showPermissionOutcome(request, result.kind)
    return result
  }

  onScopeDispose(clearOutcomeTimer)

  return {
    permissionRequests,
    permissionRequest,
    permissionOutcome,
    dismissPermissionOutcome,
    setPermissionRequests,
    initializePermissionRequests,
    decidePermission,
  }
}
