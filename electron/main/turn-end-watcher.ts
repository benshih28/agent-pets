import { AGENT_STATE_POLICY, familyOfSource, type AgentFamilyKey, type AgentStatusEvent } from '../../src/types/agent.ts'
import type { TranscriptFingerprint, TranscriptProbe } from '../transcript-turn-end.ts'
import type { SessionSnapshotEntry } from './session-snapshot.ts'

// 補上 agent 沒送的結束事件：session 還停在進行中的狀態、又安靜了一小段時間，就去看它的對話紀錄檔；
// 紀錄檔說回合已經結束（被中斷或已完成）就送出一個正規的 idle 事件，走跟 hook 事件完全相同的路
// （寵物、面板、歷史、通知都收到同一個事件），不另開一條狀態管道。
//
// 這裡不分 agent、不分狀態：哪些狀態算「進行中」看狀態 registry 的 historyOutcome，
// 哪個家族有紀錄檔可讀、格式怎麼判斷都在 electron/transcript-turn-end.ts。

/** 多久檢查一次。沒有候選 session 時每次只是掃過一份很小的清單。 */
export const TURN_END_CHECK_INTERVAL_MS = 5_000
/** 最後一個事件過了這麼久才去看紀錄檔：正常情況下一個 hook 事件早就到了。 */
export const TURN_END_QUIET_MS = 8_000
/**
 * 結束紀錄的時間可以比最後一個事件早這麼多：hook 是另一個程序，送達時間可能比 agent 寫檔晚一點。
 * 更早的結束紀錄屬於上一個回合，不能拿來結束現在這個。
 */
export const TURN_END_CLOCK_SKEW_MS = 2_000
/** 找不到紀錄檔時隔這麼久再找一次（agent 可能晚一點才建立檔案）。 */
const LOCATE_RETRY_MS = 30_000
/** 送出事件的 originalEvent；不是任何 agent 的 hook 名稱。 */
export const TURN_END_EVENT = 'AgentPetsTurnEnded'

export interface TurnEndWatcherDeps {
  now(): number
  /** 主程序的 session 鏡像（最後狀態與最後事件時間）。 */
  sessions(): SessionSnapshotEntry[]
  /** 單一 session 的最新鏡像；已移除或過期時回傳 undefined。 */
  session(source: SessionSnapshotEntry['source'], sessionId: string): SessionSnapshotEntry | undefined
  /** 這個家族的 agent 設定目錄。 */
  configDir(family: AgentFamilyKey): string
  hasTranscript(family: AgentFamilyKey): boolean
  locate(family: AgentFamilyKey, configDir: string, sessionId: string): Promise<string | null>
  probe(family: AgentFamilyKey, filePath: string, previous?: TranscriptFingerprint): Promise<TranscriptProbe | null>
  /** 把事件送進跟 hook 事件相同的流程。 */
  dispatch(event: AgentStatusEvent): void
}

interface Tracked {
  filePath: string | null
  locatedAt: number
  fingerprint?: TranscriptFingerprint
}

export interface TurnEndWatcher {
  /** 檢查一輪；上一輪還沒跑完時直接略過。回傳這一輪送出了幾個事件。 */
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
        // 太久沒消息的交給狀態期限（轉離線），不再讀檔。
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
      // 不要因為這個計時器讓程序無法結束。
      timer.unref?.()
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = null
      tracked.clear()
    },
  }
}
