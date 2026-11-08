import type { AgentSource, AgentState, AgentStatusEvent } from '../../src/types/agent.ts'
import type { AgentHost } from '../../src/types/host-app.ts'

export interface SessionSnapshotEntry {
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
const MAX_AGE_MS = 45 * 60_000

/**
 * Tiny main-owned mirror of the latest state per session. The renderer owns
 * the live list, but a reloaded or crashed renderer asks for this to avoid
 * showing an idle pet while agents are still running.
 */
export class SessionSnapshotStore {
  private readonly entries = new Map<string, SessionSnapshotEntry>()

  constructor(private readonly now: () => number = Date.now) {}

  record(event: AgentStatusEvent): void {
    if (event.originalEvent === 'AgentPetsIntegrationTest') return
    const key = `${event.source}:${event.sessionId}`
    if (event.state === 'offline') {
      this.entries.delete(key)
      return
    }
    // Re-insert so Map order tracks recency for eviction.
    const previous = this.entries.get(key)
    const host = event.host ?? previous?.host
    this.entries.delete(key)
    this.entries.set(key, {
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
    return [...this.entries.values()].map(entry => ({ ...entry, ...(entry.host ? { host: { ...entry.host } } : {}) }))
  }

  clear(): void {
    this.entries.clear()
  }
}
