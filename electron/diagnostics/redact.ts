import { homedir } from 'node:os'

const SENSITIVE_KEY = /token|secret|password|passwd|authorization|api[-_]?key|credential|cookie|prompt|content|message|text|body|input|command/i
const REDACTED = '[redacted]'

export interface RedactOptions {
  home?: string
}

/**
 * Removes anything that could identify the user or leak agent content from a
 * string headed for the local log or a diagnostics export: bearer/API
 * tokens, long opaque secrets, and absolute paths into a home directory.
 */
export function redactText(input: string, options: RedactOptions = {}): string {
  let text = input
  const home = options.home ?? safeHome()
  if (home && home.length > 1) text = text.split(home).join('~')
  return text
    // Home directories on any platform, even if they are not ours.
    // A user name may contain spaces ("Jane Doe"); when a separator follows within 64 chars the
    // whole segment is the name, otherwise the first word is.
    .replace(/\/Users\/(?:[^/\n"'`:]{1,64}(?=\/)|[^/\s"'`:]+)/g, '~')
    .replace(/\/home\/(?:[^/\n"'`:]{1,64}(?=\/)|[^/\s"'`:]+)/g, '~')
    .replace(/[A-Za-z]:[\\/]+Users[\\/]+(?:[^\\/\n"'`:]{1,64}(?=[\\/])|[^\\/\s"'`:]+)/gi, '~')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g, '[email]')
    // Header / assignment style secrets.
    .replace(/(authorization|x-agent-pets-token|x-api-key|api[-_]?key|token|secret|password)(["']?\s*[:=]\s*["']?)(?:Bearer\s+)?[^\s"',;&]+/gi, `$1$2${REDACTED}`)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/g, `Bearer ${REDACTED}`)
    // Well-known key shapes and long opaque strings.
    .replace(/\b(?:sk|pk|ghp|gho|ghs|xox[abp])[-_][A-Za-z0-9_-]{16,}\b/g, REDACTED)
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, REDACTED)
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, REDACTED)
}

function safeHome(): string {
  try { return homedir() } catch { return '' }
}

/** Serialises a value for logging, dropping content-bearing/secret keys outright. */
export function redactValue(value: unknown, options: RedactOptions = {}, depth = 0): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return redactText(value, options)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Error) return redactText(value.stack ?? value.message, options)
  if (depth >= 4) return '[truncated]'
  if (Array.isArray(value)) return value.slice(0, 20).map(item => redactValue(item, options, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
      out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactValue(item, options, depth + 1)
    }
    return out
  }
  return String(typeof value)
}
