import * as fs from 'node:fs'
import * as path from 'node:path'
import { redactText, redactValue, type RedactOptions } from './redact.ts'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }
const MAX_LINE_CHARS = 2_000

export interface LoggerOptions {
  directory: string
  fileName?: string
  maxBytes?: number
  maxFiles?: number
  minLevel?: LogLevel
  flushIntervalMs?: number
  now?: () => number
  redact?: RedactOptions
  /** Per-source line budgets so one noisy source (plugin, renderer) cannot evict the rest. */
  sourceQuotas?: SourceQuota[]
  /** Size cap of the separate crash-evidence file that normal rotation can never evict. */
  evidenceMaxBytes?: number
}

export interface SourceQuota {
  /** Matches the log channel, e.g. `plugin:` prefix. */
  prefix: string
  perMinute: number
}

export const DEFAULT_SOURCE_QUOTAS: SourceQuota[] = [
  { prefix: 'plugin:', perMinute: 30 },
  { prefix: 'renderer', perMinute: 20 },
]

export interface Logger {
  log(level: LogLevel, channel: string, message: string, detail?: unknown): void
  flush(): void
  /** Last `lines` log lines across rotated files, newest last. Already redacted when written. */
  readRecent(lines?: number): string[]
  close(): void
}

/**
 * Minimal rotating file logger. Lines are redacted before they are buffered
 * and are written only to the local userData directory; nothing is uploaded.
 */
export function createLogger(options: LoggerOptions): Logger {
  const fileName = options.fileName ?? 'main.log'
  const maxBytes = options.maxBytes ?? 1024 * 1024
  const maxFiles = options.maxFiles ?? 3
  const minRank = LEVEL_RANK[options.minLevel ?? 'info']
  const now = options.now ?? Date.now
  const filePath = path.join(options.directory, fileName)
  let buffer: string[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let size = -1
  let closed = false
  const quotas = options.sourceQuotas ?? DEFAULT_SOURCE_QUOTAS
  const evidencePath = path.join(options.directory, `${fileName.replace(/\.log$/, "")}-evidence.log`)
  const evidenceMax = options.evidenceMaxBytes ?? 256 * 1024
  let evidenceBuffer: string[] = []
  const usage = new Map<string, { windowStart: number, count: number, dropped: number }>()

  const quotaFor = (channel: string): SourceQuota | undefined => quotas.find(quota => channel.startsWith(quota.prefix))

  // Returns false when the source is over budget. A single summary line is written once the
  // window rolls over so the drop itself is visible.
  const admit = (channel: string, quota: SourceQuota): { ok: boolean, summary?: string } => {
    const current = now()
    let entry = usage.get(channel)
    if (!entry || current - entry.windowStart >= 60_000) {
      const dropped = entry?.dropped ?? 0
      entry = { windowStart: current, count: 0, dropped: 0 }
      usage.set(channel, entry)
      if (usage.size > 200) usage.delete(usage.keys().next().value as string)
      entry.count = 1
      return { ok: true, ...(dropped > 0 ? { summary: `${dropped} log lines dropped (quota ${quota.perMinute}/min)` } : {}) }
    }
    entry.count += 1
    if (entry.count > quota.perMinute) {
      entry.dropped += 1
      return { ok: false }
    }
    return { ok: true }
  }

  const flushEvidence = () => {
    if (evidenceBuffer.length === 0) return
    const chunk = evidenceBuffer.join('')
    evidenceBuffer = []
    try {
      fs.mkdirSync(options.directory, { recursive: true })
      let existing = ''
      try { existing = fs.readFileSync(evidencePath, 'utf8') } catch {}
      let next = existing + chunk
      if (Buffer.byteLength(next) > evidenceMax) {
        // Keep the newest half; whole lines only.
        const tail = next.slice(-Math.floor(evidenceMax / 2))
        next = tail.slice(tail.indexOf('\n') + 1)
      }
      fs.writeFileSync(evidencePath, next, { mode: 0o600 })
    } catch {
      // Logging must never throw into the caller.
    }
  }

  const rotate = () => {
    for (let index = maxFiles - 1; index >= 1; index -= 1) {
      const from = index === 1 ? filePath : `${filePath}.${index - 1}`
      const to = `${filePath}.${index}`
      try { fs.renameSync(from, to) } catch {}
    }
    size = 0
  }

  const flush = () => {
    if (timer) clearTimeout(timer)
    timer = null
    flushEvidence()
    if (buffer.length === 0) return
    const chunk = buffer.join('')
    buffer = []
    try {
      fs.mkdirSync(options.directory, { recursive: true })
      if (size < 0) {
        try { size = fs.statSync(filePath).size } catch { size = 0 }
      }
      if (size + Buffer.byteLength(chunk) > maxBytes && size > 0) rotate()
      fs.appendFileSync(filePath, chunk, { mode: 0o600 })
      size += Buffer.byteLength(chunk)
    } catch {
      // Logging must never throw into the caller.
    }
  }

  return {
    log(level, channel, message, detail) {
      if (closed || LEVEL_RANK[level] < minRank) return
      const quota = quotaFor(channel)
      if (quota) {
        const verdict = admit(channel, quota)
        if (verdict.summary) buffer.push(`${new Date(now()).toISOString()} WARN [${channel}] ${verdict.summary}\n`)
        if (!verdict.ok) return
      }
      let line = `${new Date(now()).toISOString()} ${level.toUpperCase()} [${channel}] ${redactText(message, options.redact)}`
      if (detail !== undefined) {
        const safe = redactValue(detail, options.redact)
        line += ` ${typeof safe === 'string' ? safe : JSON.stringify(safe)}`
      }
      line = `${line.replace(/\r?\n/g, '\\n').slice(0, MAX_LINE_CHARS)}\n`
      buffer.push(line)
      // Crash evidence from trusted sources is mirrored to its own bounded file.
      if (!quota && (level === 'error' || channel === 'startup')) evidenceBuffer.push(line)
      if (level === 'error' || buffer.length >= 50) flush()
      else if (!timer) {
        timer = setTimeout(flush, options.flushIntervalMs ?? 500)
        timer.unref?.()
      }
    },
    flush,
    readRecent(lines = 200) {
      flush()
      const collected: string[] = []
      for (let index = maxFiles - 1; index >= 0; index -= 1) {
        const file = index === 0 ? filePath : `${filePath}.${index}`
        try { collected.push(...fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)) } catch {}
      }
      // Evidence lines that rotation already evicted from the main files are merged back in.
      const seen = new Set(collected)
      try {
        for (const line of fs.readFileSync(evidencePath, 'utf8').split('\n')) {
          if (line && !seen.has(line)) { collected.push(line); seen.add(line) }
        }
      } catch {}
      collected.sort((a, b) => (a.slice(0, 24) < b.slice(0, 24) ? -1 : a.slice(0, 24) > b.slice(0, 24) ? 1 : 0))
      return collected.slice(-lines)
    },
    close() {
      flush()
      closed = true
    },
  }
}
