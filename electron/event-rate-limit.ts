export interface EventRateLimiterOptions {
  now?: () => number
  windowMs?: number
  /** Pre-parse ceiling across all callers; only protects the process from a request flood. */
  globalLimit?: number
  /** Ordinary events (heartbeats, tool use) per source session per window. */
  perSessionLimit?: number
  /** Terminal events (success/error/permission) get their own, separate budget per session. */
  terminalPerSessionLimit?: number
  maxTrackedSessions?: number
  /** Budget for all ordinary events combined, whatever their session ids (rotating ids cannot bypass it). */
  globalEventLimit?: number
  /** Same, for terminal events. */
  globalTerminalLimit?: number
}

export interface EventRateLimiter {
  allowRequest(): boolean
  allowEvent(sessionKey: string, terminal: boolean): boolean
}

export function createEventRateLimiter(options: EventRateLimiterOptions = {}): EventRateLimiter {
  const now = options.now ?? Date.now
  const windowMs = options.windowMs ?? 10_000
  const globalLimit = options.globalLimit ?? 2_000
  const perSession = options.perSessionLimit ?? 500
  const terminalPerSession = options.terminalPerSessionLimit ?? 60
  const maxTracked = options.maxTrackedSessions ?? 500
  const globalEvents = options.globalEventLimit ?? 2_000
  const globalTerminal = options.globalTerminalLimit ?? 300

  let windowStartedAt = now()
  let requests = 0
  let normalEvents = 0
  let terminalEvents = 0
  const overflow = { normal: 0, terminal: 0 }
  let counters = new Map<string, { normal: number; terminal: number }>()

  const roll = () => {
    const current = now()
    if (current - windowStartedAt >= windowMs) {
      windowStartedAt = current
      requests = 0
      normalEvents = 0
      terminalEvents = 0
      overflow.normal = 0
      overflow.terminal = 0
      counters = new Map()
    }
  }

  return {
    allowRequest() {
      roll()
      requests += 1
      return requests <= globalLimit
    },
    allowEvent(sessionKey, terminal) {
      roll()
      // Global event budgets apply to every caller regardless of the session id they claim.
      if (terminal) {
        terminalEvents += 1
        if (terminalEvents > globalTerminal) return false
      } else {
        normalEvents += 1
        if (normalEvents > globalEvents) return false
      }
      let entry = counters.get(sessionKey)
      if (!entry) {
        // Fail closed: once the table is full, unknown sessions share one overflow bucket
        // instead of getting a free pass or a fresh budget each.
        entry = counters.size >= maxTracked ? overflow : { normal: 0, terminal: 0 }
        if (entry !== overflow) counters.set(sessionKey, entry)
      }
      if (terminal) {
        entry.terminal += 1
        return entry.terminal <= terminalPerSession
      }
      entry.normal += 1
      return entry.normal <= perSession
    },
  }
}
