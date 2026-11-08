// Tracks what currently needs the user — not what has happened. Entries are
// removed when the underlying state clears, so the tray count can go down on
// its own and cannot double count one permission wait that is visible both as
// a broker request and as an agent status event.

export interface AttentionSummary {
  /** Pending broker requests that can be answered in Agent Pets. */
  permission: number
  /** Permission waits that must be answered in the agent's own tool. */
  external: number
  /** Sessions waiting for the user to type something. */
  input: number
  total: number
}

export interface AttentionEventLike {
  source: string
  sessionId: string
  state: string
  timestamp?: number
  originalEvent?: string
}

export interface AttentionRequestLike {
  requestId: string
  agentId: string
  sessionId: string
}

const MAX_TRACKED = 500
// A wait that never got a follow-up event is treated as gone after this long.
const STALE_MS = 30 * 60_000

export const EMPTY_ATTENTION: AttentionSummary = Object.freeze({ permission: 0, external: 0, input: 0, total: 0 })

export class AttentionTracker {
  private readonly waiting = new Map<string, { kind: 'input' | 'permission'; at: number }>()
  private requests: AttentionRequestLike[] = []

  /** Returns true when the tracked set changed. */
  observeEvent(event: AttentionEventLike, now = Date.now()): boolean {
    if (event.originalEvent === 'AgentPetsIntegrationTest') return false
    const key = `${event.source}:${event.sessionId}`
    if (event.state === 'waiting-input' || event.state === 'waiting-permission') {
      const kind = event.state === 'waiting-input' ? 'input' : 'permission'
      const previous = this.waiting.get(key)
      this.waiting.set(key, { kind, at: now })
      if (this.waiting.size > MAX_TRACKED) this.waiting.delete(this.waiting.keys().next().value as string)
      return previous?.kind !== kind
    }
    return this.waiting.delete(key)
  }

  setRequests(requests: ReadonlyArray<AttentionRequestLike>): boolean {
    const next = requests.map(({ requestId, agentId, sessionId }) => ({ requestId, agentId, sessionId }))
    const same = next.length === this.requests.length
      && next.every((request, index) => request.requestId === this.requests[index]?.requestId)
    this.requests = next
    return !same
  }

  summary(now = Date.now()): AttentionSummary {
    const answerable = new Set(this.requests.map((request) => `${request.agentId}:${request.sessionId}`))
    let external = 0
    let input = 0
    for (const [key, entry] of this.waiting) {
      if (now - entry.at > STALE_MS) {
        this.waiting.delete(key)
        continue
      }
      if (entry.kind === 'input') input += 1
      else if (!answerable.has(key)) external += 1
    }
    const permission = this.requests.length
    return { permission, external, input, total: permission + external + input }
  }
}
