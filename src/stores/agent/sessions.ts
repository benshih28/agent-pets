import type { AgentSession, AgentSource, AgentState, AgentStatusEvent } from '@/types/agent'
import { AGENT_STATE_POLICY, isAgentState, isQuotaCapableSource } from '@/types/agent'
import { isHostAppId, type AgentHost } from '@/types/host-app'
import type { SessionJumpAction, SessionJumpResult } from '@/types/session-jump'
import type { SoundCue } from '@/types/sound'
import { AgentSessionIndex } from '@/utils/agent-session-index'
import { AGENT_STATE_PRESENTATION } from '@/utils/agent-state-presentation'
import { SESSION_REMOVE_MS, sessionLifecycleAction } from '@/utils/session-lifecycle'
import { shouldPlaySuccessSound } from '@/utils/sound-policy'
import type { usePetMood } from '@/stores/agent/mood'
import { isUrgentForPresentation } from '@/stores/agent/presentation'
import type { useToastQueue } from '@/stores/agent/toast'
import type { useUnreadAlerts } from '@/stores/agent/unread-alerts'

const MAX_SESSION_COUNT = 200

function sanitizeHost(value: unknown): AgentHost | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  if (!isHostAppId(raw.app)) return undefined
  if (raw.kind !== 'terminal' && raw.kind !== 'ide' && raw.kind !== 'desktop' && raw.kind !== 'unknown') return undefined
  return { kind: raw.kind, app: raw.app, switchable: raw.switchable === true }
}

export interface SessionsDeps {
  sessionsByKey: Map<string, AgentSession>
  petMood: ReturnType<typeof usePetMood>
  showToast: ReturnType<typeof useToastQueue>['showToast']
  unreadAlerts: Pick<ReturnType<typeof useUnreadAlerts>, 'noteUnreadResult' | 'scheduleWaitingInputReminder' | 'cancelWaitingInputReminder'>
  clearPresentation: () => void
  markQuotaStale: () => void
  forgetDismissedNotice: (key: string) => void
  /** 權限模組在 session 之後才建立，所以用函式延後解析。 */
  hasPendingPermission: () => boolean
}

export function useSessions(deps: SessionsDeps) {
  const { sessionsByKey, petMood, showToast, unreadAlerts } = deps
  const sessionIndex = new AgentSessionIndex(sessionsByKey)
  const quietSettledFrom = new Map<string, AgentState>()

  function getSessionKey(source: AgentSource, sessionId: string): string {
    return `${source}:${sessionId}`
  }

  // 兩個視窗都跑同一份 store，音效只能由其中一個發出，否則會播兩次；所以只回傳 cue，由 App.vue 決定播不播。
  function handleEvent(event: AgentStatusEvent): SoundCue | null {
    const key = getSessionKey(event.source, event.sessionId)
    const existing = sessionIndex.get(key)
    const prevState = existing?.state
    const host = sanitizeHost(event.host)

    if (event.originalEvent === 'AgentPetsIntegrationTest' && event.state === 'offline') {
      removeSession(key)
      return null
    }

    if (existing) {
      if (event.state !== prevState) existing.stateChangedAt = event.timestamp
      existing.state = event.state
      existing.lastSeenAt = event.timestamp
      existing.project = event.project
      existing.projectId = event.projectId
      existing.routedPetId = event.routedPetId
      existing.toolName = event.toolName
      existing.permissionNotice = event.permissionNotice
      if (host) existing.host = host
      sessionIndex.updatePriority(key, event.state, event.timestamp)
    } else {
      const evicted = sessionIndex.upsert({
        key,
        source: event.source,
        sessionId: event.sessionId,
        project: event.project,
        projectId: event.projectId,
        routedPetId: event.routedPetId,
        state: event.state,
        lastSeenAt: event.timestamp,
        firstSeenAt: event.timestamp,
        stateChangedAt: event.timestamp,
        toolName: event.toolName,
        permissionNotice: event.permissionNotice,
        ...(host ? { host } : {}),
      }, MAX_SESSION_COUNT)
      if (evicted) petMood.forgetTask(evicted.key)
    }

    if (isUrgentForPresentation(event.state)) deps.clearPresentation()

    // Read before awardTaskProgress clears it on a terminal state.
    const taskStartedAt = petMood.taskStartedAt(key)
    const taskElapsedMs = taskStartedAt === undefined ? undefined : Date.now() - taskStartedAt

    // 清理降到閒置後才來的事件代表工作沒停：用降級前的狀態算進度，工作計時才不會重來。
    petMood.awardTaskProgress(event, key, quietSettledFrom.get(key) ?? prevState)
    quietSettledFrom.delete(key)

    if (event.state === 'waiting-input') {
      if (prevState !== 'waiting-input') unreadAlerts.scheduleWaitingInputReminder(key)
    } else {
      unreadAlerts.cancelWaitingInputReminder(key)
    }

    if ((event.state === 'success' || event.state === 'error') && prevState !== event.state) {
      if (isQuotaCapableSource(event.source)) deps.markQuotaStale()
      showToast(
        event.source,
        event.project,
        event.state,
        taskElapsedMs,
      )
      unreadAlerts.noteUnreadResult(event.state)
      petMood.rewardOutcome(event.state)
      if (event.state === 'success' && !shouldPlaySuccessSound(taskElapsedMs)) return null
      return AGENT_STATE_PRESENTATION[event.state].cue
    }

    if (event.state !== 'waiting-permission') deps.forgetDismissedNotice(key)

    if (event.state === 'waiting-permission' && prevState !== 'waiting-permission') {
      return AGENT_STATE_PRESENTATION['waiting-permission'].cue
    }

    return null
  }

  // 只改顯示：不發通知、不播音效、不動 lastSeenAt，下一個真實事件會直接蓋過。
  function sweepQuietSessions() {
    const now = Date.now()
    const hasPendingPermission = deps.hasPendingPermission()
    for (const session of [...sessionIndex.values()]) {
      const next = sessionLifecycleAction(session, now, { hasPendingPermission })
      if (next === null) continue
      unreadAlerts.cancelWaitingInputReminder(session.key)
      if (next === 'remove') {
        sessionIndex.delete(session.key)
        petMood.forgetTask(session.key)
        quietSettledFrom.delete(session.key)
        continue
      }
      if (!quietSettledFrom.has(session.key)) quietSettledFrom.set(session.key, session.state)
      session.state = next
      session.permissionNotice = undefined
      sessionIndex.updatePriority(session.key, session.state, session.lastSeenAt)
      // 降到閒置時工作可能還在跑，保留計時；判定程序不在了才放掉。
      if (AGENT_STATE_POLICY[next].historyOutcome === 'cancelled') petMood.forgetTask(session.key)
    }
  }

  // Merge main's mirror without replaying events (no toasts, mood or sound) and never over live data.
  function restoreSessionSnapshot(entries: unknown): number {
    if (!Array.isArray(entries)) return 0
    const now = Date.now()
    let restored = 0
    for (const raw of entries.slice(0, MAX_SESSION_COUNT)) {
      if (!raw || typeof raw !== 'object') continue
      const entry = raw as Partial<AgentSession>
      if (typeof entry.source !== 'string' || typeof entry.sessionId !== 'string') continue
      if (!isAgentState(entry.state)) continue
      if (typeof entry.lastSeenAt !== 'number' || !Number.isFinite(entry.lastSeenAt)) continue
      if (now - entry.lastSeenAt > SESSION_REMOVE_MS) continue
      const key = getSessionKey(entry.source as AgentSource, entry.sessionId)
      if (sessionIndex.get(key)) continue
      const restoredHost = sanitizeHost(entry.host)
      sessionIndex.upsert({
        key,
        source: entry.source as AgentSource,
        sessionId: entry.sessionId,
        project: typeof entry.project === 'string' ? entry.project : undefined,
        projectId: typeof entry.projectId === 'string' ? entry.projectId : undefined,
        routedPetId: typeof entry.routedPetId === 'string' ? entry.routedPetId : undefined,
        state: entry.state,
        lastSeenAt: entry.lastSeenAt,
        firstSeenAt: typeof entry.firstSeenAt === 'number' && Number.isFinite(entry.firstSeenAt) ? entry.firstSeenAt : entry.lastSeenAt,
        stateChangedAt: typeof entry.stateChangedAt === 'number' && Number.isFinite(entry.stateChangedAt) ? entry.stateChangedAt : entry.lastSeenAt,
        toolName: typeof entry.toolName === 'string' ? entry.toolName : undefined,
        ...(restoredHost ? { host: restoredHost } : {}),
      }, MAX_SESSION_COUNT)
      restored += 1
    }
    return restored
  }

  function removeSession(key: string) {
    quietSettledFrom.delete(key)
    unreadAlerts.cancelWaitingInputReminder(key)
    sessionIndex.delete(key)
    petMood.forgetTask(key)
  }

  function clearOfflineSessions() {
    for (const session of [...sessionIndex.values()]) {
      if (session.state === 'offline') {
        quietSettledFrom.delete(session.key)
        sessionIndex.delete(session.key)
        petMood.forgetTask(session.key)
      }
    }
  }
  // The broker's agentId is the literal AgentSource string, so a request and the session it blocks share getSessionKey().
  function settleWaitingPermission(agentId: string, sessionId: string): void {
    const key = getSessionKey(agentId as AgentSource, sessionId)
    const session = sessionIndex.get(key)
    if (!session || session.state !== 'waiting-permission') return
    // Codex/Claude may never send a follow-up hook event after the request resolves; without this
    // the pet stays on "Waiting Permission". Visual-only fallback: any real event overwrites it.
    session.state = 'idle'
    session.permissionNotice = undefined
    sessionIndex.updatePriority(key, session.state, session.lastSeenAt)
  }

  function sessionByKey(key: string): AgentSession | undefined {
    return sessionsByKey.get(key)
  }

  /** The main process holds the path and app id. */
  async function runSessionJump(key: string, action: SessionJumpAction): Promise<SessionJumpResult> {
    const session = sessionIndex.get(key)
    const run = window.electronAPI?.runSessionJump
    if (!session || !run) return { ok: false, error: 'unknown_session' }
    try {
      return await run({ action, source: session.source, sessionId: session.sessionId })
    } catch {
      return { ok: false, error: 'failed' }
    }
  }

  return {
    sessionIndex,
    getSessionKey,
    handleEvent,
    cleanupStale: sweepQuietSessions,
    restoreSessionSnapshot,
    handleSuccessTimeout: sweepQuietSessions,
    removeSession,
    clearOfflineSessions,
    settleWaitingPermission,
    sessionByKey,
    runSessionJump,
  }
}
