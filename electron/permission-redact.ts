const REDACTED = '[redacted]'

// Ordered: the specific token shapes run before the generic key=value rule.
const SECRET_PATTERNS: ReadonlyArray<RegExp> = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\bAIza[A-Za-z0-9_-]{30,}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi,
]

const KEY_VALUE_PATTERN =
  /((?:--?)?[A-Za-z0-9_.-]*(?:password|passwd|secret|token|api[_-]?key|apikey|auth|credential)[A-Za-z0-9_.-]*\s*[=:]\s*|--(?:password|token|secret|api-key)\s+)("[^"]*"|'[^']*'|\S+)/gi

const URL_CREDENTIALS_PATTERN = /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi

const COMMAND_SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/(\s(?:-u|--user)[\s=]+)[^\s:]+:\S+/g, `$1${REDACTED}`],
  // mysql family only: `mkdir -p dir` must stay readable
  [/\b(mysql\w*|mariadb\w*|mongo\w*|redis-cli)\b([^\n|;&]*?\s)-p\s*(?!-)(\S+)/gi, `$1$2-p ${REDACTED}`],
  [/\b(export|set|setenv)(\s+[A-Za-z0-9_]*(?:password|passwd|secret|token|api[_-]?key|credential)[A-Za-z0-9_]*)\s+(?!=)(\S+)/gi, `$1$2 ${REDACTED}`],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g, '[email]'],
]

const HOME_PATTERNS: ReadonlyArray<RegExp> = [
  /\/Users\/(?:[^/\n'"]{1,64}(?=\/)|[^/\s'"]+)/g,
  /\/home\/(?:[^/\n'"]{1,64}(?=\/)|[^/\s'"]+)/g,
  /\b[A-Za-z]:[\\/]+Users[\\/]+(?:[^\\/\n'"]{1,64}(?=[\\/])|[^\\/\s'"]+)/g,
]

export function redactSensitiveText(value: string): string {
  let result = value
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, (match, scheme: unknown) => (
      typeof scheme === 'string' && /^(bearer|basic)$/i.test(scheme) ? `${scheme} ${REDACTED}` : REDACTED
    ))
  }
  result = result.replace(URL_CREDENTIALS_PATTERN, `$1${REDACTED}@`)
  result = result.replace(KEY_VALUE_PATTERN, `$1${REDACTED}`)
  for (const [pattern, replacement] of COMMAND_SECRET_PATTERNS) result = result.replace(pattern, replacement)
  for (const pattern of HOME_PATTERNS) result = result.replace(pattern, '~')
  return result
}
