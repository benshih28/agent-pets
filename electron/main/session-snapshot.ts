import type { AgentSource, AgentState, AgentStatusEvent } from '../../src/types/agent.ts'
import type { AgentAdapterId } from '../../src/types/agent-adapter.ts'
import type { AgentHost } from '../../src/types/host-app.ts'
import { SESSION_REMOVE_MS } from '../../src/utils/session-lifecycle.ts'

export interface SessionSnapshotEntry {
  /** 事件來自哪個 adapter；主程序替這個 session 補送事件時要帶上，歷史才會記在同一筆。 */
  adapterId?: AgentAdapterId
  source: AgentSource
  sessionId: string
  project?: string
  projectId?: string
  routedPetId?: string
  state: AgentState
  lastSeenAt: number
  firstSeenAt?: number
  toolName?: string
  host?: AgentHost
}

const MAX_ENTRIES = 200
/** Matches the renderer removal horizon: older entries are useless after a reload. */
const MAX_AGE_MS = SESSION_REMOVE_MS

function snapshotKey(source: AgentSource, sessionId: string): string {
  return `${source}:${sessionId}`
}

// host 是巢狀物件，只做淺拷貝的話呼叫端改得到鏡像內容。
function cloneEntry(entry: SessionSnapshotEntry): SessionSnapshotEntry {
  return { ...entry, ...(entry.host ? { host: { ...entry.host } } : {}) }
}

/**
 * Tiny main-owned mirror of the latest state per session. The renderer owns
 * the live list, but a reloaded or crashed renderer asks for this to avoid
 * showing an idle pet while agents are still running.
 */
export class SessionSnapshotStore {
  private readonly entries = new Map<string, SessionSnapshotEntry>()

  private readonly now: () => number

  // 不用 parameter property：測試以 Node 的 strip-types 直接載入這個檔案。
  constructor(now: () => number = Date.now) {
    this.now = now
  }

  record(event: AgentStatusEvent): void {
    if (event.originalEvent === 'AgentPetsIntegrationTest') return
    const key = snapshotKey(event.source, event.sessionId)
    if (event.state === 'offline') {
      this.entries.delete(key)
      return
    }
    // Re-insert so Map order tracks recency for eviction.
    const previous = this.entries.get(key)
    const host = event.host ?? previous?.host
    this.entries.delete(key)
    this.entries.set(key, {
      ...(event.adapterId ? { adapterId: event.adapterId } : {}),
      source: event.source,
      sessionId: event.sessionId,
      project: event.project,
      projectId: event.projectId,
      routedPetId: event.routedPetId,
      state: event.state,
      lastSeenAt: event.timestamp,
      firstSeenAt: previous?.firstSeenAt ?? event.timestamp,
      toolName: event.toolName,
      ...(host ? { host: { ...host } } : {}),
    })
    while (this.entries.size > MAX_ENTRIES) {
      this.entries.delete(this.entries.keys().next().value as string)
    }
  }

  list(): SessionSnapshotEntry[] {
    const cutoff = this.now() - MAX_AGE_MS
    for (const [key, entry] of this.entries) if (entry.lastSeenAt < cutoff) this.entries.delete(key)
    return [...this.entries.values()].map(cloneEntry)
  }

  /**
   * 只取一筆，給只關心單一 session 的呼叫端用，避免每次都複製整份清單。
   * 過期判斷跟 list() 一致：list() 看不到的項目這裡也看不到，並同樣順手刪掉。
   */
  get(source: AgentSource, sessionId: string): SessionSnapshotEntry | undefined {
    const key = snapshotKey(source, sessionId)
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (entry.lastSeenAt < this.now() - MAX_AGE_MS) {
      this.entries.delete(key)
      return undefined
    }
    return cloneEntry(entry)
  }

  clear(): void {
    this.entries.clear()
  }
}
