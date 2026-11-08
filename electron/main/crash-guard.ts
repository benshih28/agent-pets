import { EventEmitter } from 'node:events'

export type CrashLevel = 'error' | 'warn'

export interface CrashRecord {
  kind: string
  message: string
  stack?: string
  count: number
}

export interface CrashGuardProcess {
  on(event: 'uncaughtException', listener: (error: Error) => void): unknown
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown
  off?(event: string, listener: (...args: never[]) => void): unknown
}

export interface CrashEscalationPolicy {
  /** Sliding window in which occurrences are counted. */
  windowMs: number
  /** This many distinct errors inside the window escalate. */
  distinctThreshold: number
  /** The same error this many times inside the window escalates. */
  repeatThreshold: number
}

export const DEFAULT_CRASH_ESCALATION: CrashEscalationPolicy = {
  windowMs: 120_000,
  distinctThreshold: 5,
  repeatThreshold: 20,
}

export interface CrashOccurrence {
  signature: string
  at: number
}

/**
 * Pure escalation policy: given the recorded occurrences (including the newest),
 * decide whether the process is crashing repeatedly enough to ask the user to restart.
 */
export function shouldEscalateCrashes(
  occurrences: readonly CrashOccurrence[],
  now: number,
  policy: CrashEscalationPolicy = DEFAULT_CRASH_ESCALATION,
): boolean {
  const counts = new Map<string, number>()
  for (const occurrence of occurrences) {
    if (now - occurrence.at > policy.windowMs) continue
    counts.set(occurrence.signature, (counts.get(occurrence.signature) ?? 0) + 1)
  }
  if (counts.size >= policy.distinctThreshold) return true
  for (const count of counts.values()) if (count >= policy.repeatThreshold) return true
  return false
}

export interface CrashGuardOptions {
  proc?: CrashGuardProcess
  /** Sink for log lines. Callers are expected to redact before persisting. */
  log: (level: CrashLevel, message: string, detail?: unknown) => void
  /** Called at most once per `toastIntervalMs` so users are told, never spammed. */
  onUserVisibleError?: (record: CrashRecord) => void
  /** Called at most once per run when uncaught errors keep repeating (see shouldEscalateCrashes). */
  onEscalate?: (record: CrashRecord) => void
  escalation?: CrashEscalationPolicy
  now?: () => number
  toastIntervalMs?: number
  /** Maximum distinct log writes per window; a crash loop must not fill the disk. */
  maxLogsPerWindow?: number
  windowMs?: number
}

export interface CrashGuard {
  dispose(): void
  stats(): { total: number; suppressed: number; distinct: number }
}

const DEFAULT_TOAST_INTERVAL_MS = 60_000
const DEFAULT_MAX_LOGS = 20
const DEFAULT_WINDOW_MS = 60_000
const MAX_TRACKED_SIGNATURES = 200
const MAX_TRACKED_OCCURRENCES = 500

function describe(value: unknown): { message: string; stack?: string } {
  if (value instanceof Error) return { message: value.message, stack: value.stack }
  if (typeof value === 'string') return { message: value }
  try {
    return { message: JSON.stringify(value) ?? String(value) }
  } catch {
    return { message: String(value) }
  }
}

/**
 * Installs process-level error boundaries for the Electron main process.
 * Registering an `uncaughtException` listener also stops Electron from showing
 * its native crash dialog; failures go to the log sink and a throttled notice.
 */
export function installCrashGuard(options: CrashGuardOptions): CrashGuard {
  const proc = options.proc ?? (process as unknown as CrashGuardProcess)
  const now = options.now ?? Date.now
  const toastIntervalMs = options.toastIntervalMs ?? DEFAULT_TOAST_INTERVAL_MS
  const maxLogs = options.maxLogsPerWindow ?? DEFAULT_MAX_LOGS
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS

  const signatures = new Map<string, number>()
  let windowStartedAt = now()
  let logsInWindow = 0
  let lastToastAt = Number.NEGATIVE_INFINITY
  let total = 0
  let suppressed = 0
  let escalated = false
  let occurrences: CrashOccurrence[] = []
  const escalation = options.escalation ?? DEFAULT_CRASH_ESCALATION

  const handle = (kind: string, value: unknown): void => {
    total += 1
    const { message, stack } = describe(value)
    const signature = `${kind}:${message}`
    const count = (signatures.get(signature) ?? 0) + 1
    if (signatures.size >= MAX_TRACKED_SIGNATURES && !signatures.has(signature)) {
      signatures.delete(signatures.keys().next().value as string)
    }
    signatures.set(signature, count)

    const current = now()
    // Only true uncaught exceptions count; stray promise rejections are logged but never prompt.
    if (kind === 'uncaughtException') {
      occurrences.push({ signature, at: current })
      occurrences = occurrences.filter(item => current - item.at <= escalation.windowMs).slice(-MAX_TRACKED_OCCURRENCES)
    }
    if (!escalated && kind === 'uncaughtException' && shouldEscalateCrashes(occurrences, current, escalation)) {
      escalated = true
      try {
        options.onEscalate?.({ kind, message, stack, count })
      } catch {
        // The escalation prompt must never re-enter the handler.
      }
    }
    if (current - windowStartedAt >= windowMs) {
      windowStartedAt = current
      logsInWindow = 0
    }
    // Only log the first occurrence and then powers of two for a repeating error.
    const repeated = count > 1 && (count & (count - 1)) !== 0
    if (repeated || logsInWindow >= maxLogs) {
      suppressed += 1
      return
    }
    logsInWindow += 1
    try {
      options.log('error', `${kind}: ${message}${count > 1 ? ` (x${count})` : ''}`, stack)
    } catch {
      // The log sink itself must never re-enter the handler.
    }
    if (current - lastToastAt >= toastIntervalMs) {
      lastToastAt = current
      try {
        options.onUserVisibleError?.({ kind, message, stack, count })
      } catch {
        // Notification failures are non-fatal.
      }
    }
  }

  const onException = (error: Error): void => handle('uncaughtException', error)
  const onRejection = (reason: unknown): void => handle('unhandledRejection', reason)
  proc.on('uncaughtException', onException)
  proc.on('unhandledRejection', onRejection)

  return {
    dispose() {
      proc.off?.('uncaughtException', onException as never)
      proc.off?.('unhandledRejection', onRejection as never)
    },
    stats: () => ({ total, suppressed, distinct: signatures.size }),
  }
}

export interface StartupStepResult {
  name: string
  ok: boolean
  error?: unknown
}

/**
 * Runs one startup step in isolation: a failure is logged and reported but
 * never prevents later, independent services from starting.
 */
export async function runStartupStep(
  name: string,
  step: () => void | Promise<void>,
  log: CrashGuardOptions['log'],
  results?: StartupStepResult[],
): Promise<boolean> {
  try {
    await step()
    results?.push({ name, ok: true })
    return true
  } catch (error) {
    results?.push({ name, ok: false, error })
    const { message, stack } = describe(error)
    log('error', `startup step "${name}" failed: ${message}`, stack)
    return false
  }
}

export interface ChildProcessGoneDetails {
  type?: string
  reason?: string
  exitCode?: number
  name?: string
}

export function installChildProcessGoneLogger(
  emitter: Pick<EventEmitter, 'on'>,
  log: CrashGuardOptions['log'],
): void {
  emitter.on('child-process-gone', (_event: unknown, details: ChildProcessGoneDetails) => {
    const type = typeof details?.type === 'string' ? details.type : 'unknown'
    const reason = typeof details?.reason === 'string' ? details.reason : 'unknown'
    const exitCode = typeof details?.exitCode === 'number' ? details.exitCode : -1
    log('error', `child-process-gone: type=${type} reason=${reason} exitCode=${exitCode}`)
  })
}
