// renderer 不自己核准、拒絕或延長任何請求；決定權全在主程序的 Permission Broker。
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
  const permissionRequests = shallowRef<PermissionRequestView[]>([])
  const permissionRequest = computed(() => permissionRequests.value[0] ?? null)

  const permissionOutcome = shallowRef<PermissionOutcome | null>(null)
  let permissionOutcomeTimer: ReturnType<typeof setTimeout> | null = null
  // The broker's broadcast can land before the decide() IPC result, and that result decides what the UI says.
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
    // A request that drops out of the set is done blocking its session even without an explicit outcome (TTL expiry has no decidePermission caller).
    const stillPending = new Set(next.map(request => request.requestId))
    for (const request of permissionRequests.value) {
      if (stillPending.has(request.requestId)) continue
      if (decidingRequestIds.has(request.requestId)) continue
      settleWaitingPermission(request.agentId, request.sessionId)
      showPermissionOutcome(request, inferVanishedOutcome(request, now))
    }
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
    // A failed delivery or IPC error must keep the wait showing: the agent is still blocked.
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
