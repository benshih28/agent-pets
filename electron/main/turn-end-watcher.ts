import { AGENT_STATE_POLICY, familyOfSource, type AgentFamilyKey, type AgentStatusEvent } from '../../src/types/agent.ts'
import type { TranscriptFingerprint, TranscriptProbe } from '../transcript-turn-end.ts'
import type { SessionSnapshotEntry } from './session-snapshot.ts'

export const TURN_END_CHECK_INTERVAL_MS = 5_000
// 正常情況下 hook 事件早就到了，過這麼久沒消息才去讀紀錄檔。
export const TURN_END_QUIET_MS = 8_000
// hook 是另一個程序，送達可能比 agent 寫檔晚；更早的結束紀錄屬於上一個回合，不能拿來結束現在這個。
export const TURN_END_CLOCK_SKEW_MS = 2_000
const LOCATE_RETRY_MS = 30_000
export const TURN_END_EVENT = 'AgentPetsTurnEnded'

export interface TurnEndWatcherDeps {
  now(): number
  sessions(): SessionSnapshotEntry[]
  /** 已移除或過期時回傳 undefined。 */
  session(source: SessionSnapshotEntry['source'], sessionId: string): SessionSnapshotEntry | undefined
  configDir(family: AgentFamilyKey): string
  hasTranscript(family: AgentFamilyKey): boolean
  locate(family: AgentFamilyKey, configDir: string, sessionId: string): Promise<string | null>
  probe(family: AgentFamilyKey, filePath: string, previous?: TranscriptFingerprint): Promise<TranscriptProbe | null>
  dispatch(event: AgentStatusEvent): void
}

interface Tracked {
  filePath: string | null
  locatedAt: number
  fingerprint?: TranscriptFingerprint
}

export interface TurnEndWatcher {
  /** 上一輪還沒跑完時直接略過。回傳送出的事件數。 */
  check(): Promise<number>
  start(): void
  stop(): void
}

export function createTurnEndWatcher(deps: TurnEndWatcherDeps): TurnEndWatcher {
  const tracked = new Map<string, Tracked>()
  let running = false
  let timer: ReturnType<typeof setInterval> | null = null

  const keyOf = (entry: Pick<SessionSnapshotEntry, 'source' | 'sessionId'>) => `${entry.source}:${entry.sessionId}`

  async function turnEndedFor(entry: SessionSnapshotEntry, family: AgentFamilyKey, now: number): Promise<boolean> {
    const key = keyOf(entry)
    let state = tracked.get(key)
    if (!state || (state.filePath === null && now - state.locatedAt >= LOCATE_RETRY_MS)) {
      state = { filePath: await deps.locate(family, deps.configDir(family), entry.sessionId), locatedAt: now }
      tracked.set(key, state)
    }
    if (state.filePath === null) return false
    const probe = await deps.probe(family, state.filePath, state.fingerprint)
    if (!probe) return false
    state.fingerprint = probe.fingerprint
    if (probe.turnEnd === 'unchanged' || probe.turnEnd === null) return false
    return probe.turnEnd.endedAt >= entry.lastSeenAt - TURN_END_CLOCK_SKEW_MS
  }

  async function check(): Promise<number> {
    if (running) return 0
    running = true
    let dispatched = 0
    try {
      const now = deps.now()
      const sessions = deps.sessions()
      const live = new Set(sessions.map(keyOf))
      for (const key of tracked.keys()) if (!live.has(key)) tracked.delete(key)

      for (const entry of sessions) {
        if (AGENT_STATE_POLICY[entry.state].historyOutcome !== 'open') continue
        const quietFor = now - entry.lastSeenAt
        if (quietFor < TURN_END_QUIET_MS || quietFor > AGENT_STATE_POLICY.idle.quiet.afterMs) continue
        const family = familyOfSource(entry.source)
        if (!family || !deps.hasTranscript(family)) continue
        let ended = false
        try { ended = await turnEndedFor(entry, family, now) } catch { ended = false }
        if (!ended) continue
        // 讀檔期間可能已經有新的 hook 事件進來；以新事件為準。
        const current = deps.session(entry.source, entry.sessionId)
        if (!current || current.lastSeenAt !== entry.lastSeenAt || current.state !== entry.state) continue
        deps.dispatch({
          // 少了 adapterId，歷史會把這個事件記到備用 adapter 底下的另一筆 session。
          ...(entry.adapterId ? { adapterId: entry.adapterId } : {}),
          source: entry.source,
          sessionId: entry.sessionId,
          state: 'idle',
          timestamp: deps.now(),
          originalEvent: TURN_END_EVENT,
          ...(entry.project ? { project: entry.project } : {}),
          ...(entry.projectId ? { projectId: entry.projectId } : {}),
          ...(entry.routedPetId ? { routedPetId: entry.routedPetId } : {}),
          ...(entry.host ? { host: { ...entry.host } } : {}),
        })
        dispatched += 1
      }
    } finally {
      running = false
    }
    return dispatched
  }

  return {
    check,
    start() {
      if (timer) return
      timer = setInterval(() => { void check().catch(() => undefined) }, TURN_END_CHECK_INTERVAL_MS)
      timer.unref?.()
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = null
      tracked.clear()
    },
  }
}
