import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { translateBackendError } from '../src/i18n.ts'

const execFileAsync = promisify(execFile)

const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
const CODEX_REFRESH_URL = 'https://auth.openai.com/oauth/token'
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const CLAUDE_KEYCHAIN_SERVICE = 'Claude Code-credentials'
const REQUEST_TIMEOUT_MS = 15_000
const MAX_RESPONSE_BYTES = 1024 * 1024
// Deliberately shorter than the renderer's poll interval: at equal values a
// scheduled poll lands on a cache entry that is only just about to expire and
// gets served a stale reading, doubling the effective lag. This still
// coalesces the pet and panel windows asking at roughly the same moment.
const CACHE_TTL_MS = 90_000
const FORCE_REFRESH_COOLDOWN_MS = 10_000
const MAX_WINDOWS_PER_PROVIDER = 32
const MAX_DISPLAY_TEXT_LENGTH = 96
// Claude Code answers /usage itself without asking a model. Running it lets
// the CLI refresh (and rotate) its own login, which an expired Keychain token
// otherwise blocks; Agent Pets never refreshes or rewrites that login.
const CLAUDE_USAGE_ARGS = [
  '-p', '/usage', '--output-format', 'json',
  '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--no-session-persistence',
]
const CLAUDE_CLI_TIMEOUT_MS = 30_000
// Variables that would point the CLI at another endpoint or make it believe it
// runs inside a parent Claude Code session.
const CLAUDE_CLI_BLOCKED_ENV = new Set([
  'ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BETAS',
  'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT', 'CLAUDE_CODE_EXTRA_BODY',
])
const CLAUDE_USAGE_LINE = /^Current (session|week(?: \(([^)]+)\))?):\s*([0-9.]+)% used(?:\s*·\s*resets (.+))?$/
const CLAUDE_SIGN_IN_LAPSED = /\b(401|403)\b|not (logged|signed) in|signed out|log ?in again|re-?authenticate|sign-in (has )?expired|(oauth|session|token) (has )?expired|could not be refreshed|unauthorized|forbidden|authentication (failed|required)|invalid (access )?token|invalid api key|run \/login/i
// Without a subscription sign-in, /usage prints only the session's cost summary.
const CLAUDE_COST_SUMMARY = /^Total cost:/m
const CLAUDE_NOT_SIGNED_IN = 'Claude Code CLI is not signed in to a subscription. Run `claude` in a terminal and sign in with /login.'
const CLAUDE_RESET_TIME = /^(?:([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2})(?:,\s*(\d{4}))?(?:,\s*|\s+at\s+))?(\d{1,2})(?::(\d{2}))?\s*([ap]m)$/i
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const HOUR_MS = 60 * 60_000
const DAY_MS = 24 * HOUR_MS
const ALLOWED_ENDPOINTS = new Set([
  CODEX_USAGE_URL,
  CODEX_REFRESH_URL,
  CLAUDE_USAGE_URL,
])

export interface QuotaWindow {
  id: string
  label: string
  usedPercent: number
  remainingPercent: number
  resetsAt?: string
}

export interface QuotaProvider {
  id: 'codex' | 'claude'
  name: string
  plan?: string
  windows: QuotaWindow[]
  error?: string
}

export interface QuotaUsageResult {
  updatedAt: string
  providers: QuotaProvider[]
}

interface ClaudeCredential {
  root: Record<string, unknown>
  accessToken: string
  expiresAt?: number
  source: 'environment' | 'keychain' | 'file'
}

let cachedResult: QuotaUsageResult | null = null
let cachedAt = 0
let inFlight: Promise<QuotaUsageResult> | null = null
let tempSequence = 0
let lastFetchStartedAt = 0

class QuotaDisplayError extends Error {}
// The CLI could not answer; the stored-token request is tried instead.
class ClaudeCliUnavailable extends Error {}

function asObject(value: unknown): Record<string, any> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : null
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function finitePercent(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 100 ? numeric : null
}

function cleanPlan(value: unknown): string | undefined {
  const plan = nonEmptyString(value)
  if (!plan) return undefined
  return plan
    .replace(/^chatgpt[_-]?/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .slice(0, MAX_DISPLAY_TEXT_LENGTH)
}

function displayString(value: unknown, fallback: string): string {
  return (nonEmptyString(value) || fallback).slice(0, MAX_DISPLAY_TEXT_LENGTH)
}

function safeError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.name === 'AbortError') return translateBackendError('Request timed out. Try again.')
  if (error instanceof QuotaDisplayError && error.message) return translateBackendError(error.message)
  return translateBackendError(fallback)
}

async function readLimitedResponse(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new QuotaDisplayError('The quota service returned an unexpectedly large response.')
  }
  if (!response.body) return ''

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new QuotaDisplayError('The quota service returned an unexpectedly large response.')
    }
    chunks.push(value)
  }
  const joined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(joined)
}

async function requestJson(
  url: string,
  init: RequestInit,
): Promise<{ status: number; body: Record<string, any> }> {
  if (!ALLOWED_ENDPOINTS.has(url) || new URL(url).protocol !== 'https:') {
    throw new QuotaDisplayError('Refused an untrusted quota endpoint.')
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      ...init,
      redirect: 'error',
      signal: controller.signal,
    })
    const text = await readLimitedResponse(response)
    let body: Record<string, any> = {}
    if (text) {
      try {
        body = asObject(JSON.parse(text)) ?? {}
      } catch {
        if (response.ok) throw new QuotaDisplayError('Usage response was not valid JSON.')
      }
    }
    return { status: response.status, body }
  } finally {
    clearTimeout(timer)
  }
}

function atomicWriteJson(filePath: string, value: Record<string, unknown>): void {
  const directory = path.dirname(filePath)
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.agent-pets-${process.pid}-${tempSequence++}.tmp`,
  )
  const data = `${JSON.stringify(value, null, 2)}\n`
  let wroteTemp = false
  try {
    const descriptor = fs.openSync(tempPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600)
    wroteTemp = true
    try {
      fs.writeFileSync(descriptor, data, 'utf8')
      fs.fsyncSync(descriptor)
    } finally {
      fs.closeSync(descriptor)
    }
    fs.renameSync(tempPath, filePath)
  } finally {
    if (wroteTemp && fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath) } catch {}
    }
  }
}

function codexAuthPath(): string {
  const configuredHome = nonEmptyString(process.env.CODEX_HOME)
  return path.join(configuredHome || path.join(os.homedir(), '.codex'), 'auth.json')
}

function loadCodexCredential(): {
  filePath: string
  root: Record<string, any>
  accessToken: string
  refreshToken?: string
  accountId?: string
} {
  const filePath = codexAuthPath()
  let root: Record<string, any>
  try {
    root = asObject(JSON.parse(fs.readFileSync(filePath, 'utf8'))) ?? {}
  } catch {
    throw new QuotaDisplayError('No existing Codex CLI subscription session was found. Agent Pets never asks for credentials.')
  }
  if (nonEmptyString(root.OPENAI_API_KEY)) {
    throw new QuotaDisplayError('Codex CLI is using API-key mode; subscription quota requires an existing Codex CLI subscription session.')
  }
  const tokens = asObject(root.tokens)
  const accessToken = nonEmptyString(tokens?.access_token ?? tokens?.accessToken)
  if (!tokens || !accessToken) {
    throw new QuotaDisplayError('The existing Codex CLI subscription session is unavailable. Agent Pets never asks for credentials.')
  }
  return {
    filePath,
    root,
    accessToken,
    refreshToken: nonEmptyString(tokens.refresh_token ?? tokens.refreshToken),
    accountId: nonEmptyString(tokens.account_id ?? tokens.accountId),
  }
}

function codexNeedsRefresh(root: Record<string, any>): boolean {
  const lastRefresh = Date.parse(String(root.last_refresh ?? ''))
  return !Number.isFinite(lastRefresh) || Date.now() - lastRefresh > 8 * 24 * 60 * 60_000
}

async function refreshCodexCredential(
  credential: ReturnType<typeof loadCodexCredential>,
): Promise<ReturnType<typeof loadCodexCredential>> {
  if (!credential.refreshToken) return credential
  const { status, body } = await requestJson(CODEX_REFRESH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_id: CODEX_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: credential.refreshToken,
      scope: 'openid profile email',
    }),
  })
  if (status < 200 || status >= 300) {
    throw new QuotaDisplayError('The existing Codex CLI session expired. Re-authenticate in Codex CLI.')
  }
  const accessToken = nonEmptyString(body.access_token ?? body.accessToken)
  if (!accessToken) throw new QuotaDisplayError('Codex refresh response did not contain an access token.')

  // Do not overwrite a login that changed while the refresh request was in flight.
  const current = loadCodexCredential()
  if (current.accessToken !== credential.accessToken) return current
  const currentTokens = asObject(current.root.tokens) ?? {}
  const nextRoot = {
    ...current.root,
    last_refresh: new Date().toISOString(),
    tokens: {
      ...currentTokens,
      access_token: accessToken,
      refresh_token: nonEmptyString(body.refresh_token ?? body.refreshToken) || credential.refreshToken,
      id_token: nonEmptyString(body.id_token ?? body.idToken) || currentTokens.id_token,
    },
  }
  atomicWriteJson(credential.filePath, nextRoot)
  return loadCodexCredential()
}

function mapCodexWindow(id: string, raw: unknown, fallbackLabel?: string): QuotaWindow | null {
  const window = asObject(raw)
  const used = finitePercent(window?.used_percent)
  if (!window || used === null) return null
  const duration = Number(window.limit_window_seconds)
  const label = displayString(
    fallbackLabel,
    duration === 18_000 ? 'Session' : duration === 604_800 ? 'Weekly' : 'Usage',
  )
  const resetSeconds = Number(window.reset_at)
  return {
    id,
    label,
    usedPercent: used,
    remainingPercent: 100 - used,
    ...(Number.isFinite(resetSeconds) && resetSeconds > 0
      ? { resetsAt: new Date(resetSeconds * 1000).toISOString() }
      : {}),
  }
}

export function parseCodexUsage(body: Record<string, any>): Pick<QuotaProvider, 'plan' | 'windows'> {
  const windows: QuotaWindow[] = []
  const rateLimit = asObject(body.rate_limit)
  const mainWindows = [rateLimit?.primary_window, rateLimit?.secondary_window]
    .map((window, index) => mapCodexWindow(`main-${index}`, window))
    .filter((window): window is QuotaWindow => window !== null)
    .sort((a, b) => (a.label === 'Session' ? -1 : b.label === 'Session' ? 1 : 0))
  windows.push(...mainWindows)

  if (Array.isArray(body.additional_rate_limits)) {
    for (let entryIndex = 0; entryIndex < body.additional_rate_limits.length; entryIndex += 1) {
      if (windows.length >= MAX_WINDOWS_PER_PROVIDER) break
      const entry: unknown = body.additional_rate_limits[entryIndex]
      const additional = asObject(entry)
      const additionalRate = asObject(additional?.rate_limit)
      const label = displayString(additional?.limit_name ?? additional?.metered_feature, 'Additional')
      for (const [slot, raw] of [
        ['primary', additionalRate?.primary_window],
        ['secondary', additionalRate?.secondary_window],
      ] as const) {
        if (windows.length >= MAX_WINDOWS_PER_PROVIDER) break
        const mapped = mapCodexWindow(`additional-${entryIndex}-${slot}`, raw, label)
        if (mapped) windows.push(mapped)
      }
    }
  }
  return { plan: cleanPlan(body.plan_type), windows: windows.slice(0, MAX_WINDOWS_PER_PROVIDER) }
}

async function fetchCodexQuota(): Promise<QuotaProvider> {
  try {
    let credential = loadCodexCredential()
    if (codexNeedsRefresh(credential.root) && credential.refreshToken) {
      credential = await refreshCodexCredential(credential)
    }
    const headers: Record<string, string> = {
      accept: 'application/json',
      authorization: `Bearer ${credential.accessToken}`,
      'user-agent': 'Agent Pets',
    }
    if (credential.accountId) headers['ChatGPT-Account-Id'] = credential.accountId
    const { status, body } = await requestJson(CODEX_USAGE_URL, { headers })
    if (status === 401 || status === 403) {
      throw new QuotaDisplayError('The existing Codex CLI session expired. Re-authenticate in Codex CLI.')
    }
    if (status < 200 || status >= 300) throw new QuotaDisplayError(`Codex usage request failed (${status}).`)
    const parsed = parseCodexUsage(body)
    if (parsed.windows.length === 0) throw new QuotaDisplayError('Codex returned no quota windows.')
    return { id: 'codex', name: 'Codex', ...parsed }
  } catch (error) {
    return { id: 'codex', name: 'Codex', windows: [], error: safeError(error, 'Could not load Codex usage.') }
  }
}

async function findClaudeKeychainAccount(): Promise<string | undefined> {
  if (process.platform !== 'darwin') return undefined
  try {
    const { stdout } = await execFileAsync('/usr/bin/security', [
      'find-generic-password', '-s', CLAUDE_KEYCHAIN_SERVICE,
    ], { timeout: 5_000, maxBuffer: 1024 * 1024 })
    for (const line of stdout.split(/\r?\n/)) {
      const match = line.trimStart().match(/^"acct"[^=]*=(.+)$/)
      const raw = match?.[1]?.trim()
      if (raw && !raw.startsWith('0x')) {
        const account = raw.replace(/^"|"$/g, '')
        if (account && account !== '<NULL>') return account
      }
    }
  } catch {}
  return undefined
}

async function readClaudeKeychain(account?: string): Promise<string | undefined> {
  if (process.platform !== 'darwin') return undefined
  try {
    const args = ['find-generic-password', '-s', CLAUDE_KEYCHAIN_SERVICE]
    if (account) args.push('-a', account)
    args.push('-w')
    const { stdout } = await execFileAsync('/usr/bin/security', args, {
      timeout: 5_000,
      maxBuffer: MAX_RESPONSE_BYTES,
    })
    return nonEmptyString(stdout)
  } catch {
    return undefined
  }
}

function parseClaudeCredential(
  raw: string,
  source: ClaudeCredential['source'],
): ClaudeCredential {
  const root = asObject(JSON.parse(raw))
  const oauth = asObject(root?.claudeAiOauth)
  const accessToken = nonEmptyString(oauth?.accessToken)
  if (!root || !oauth || !accessToken) throw new QuotaDisplayError('Claude OAuth credentials are unavailable.')
  const expiresAt = Number(oauth.expiresAt)
  return {
    root,
    accessToken,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : undefined,
    source,
  }
}

async function loadClaudeCredential(): Promise<ClaudeCredential> {
  const environmentToken = nonEmptyString(process.env.CLAUDE_CODE_OAUTH_TOKEN)
  if (environmentToken) {
    return { root: {}, accessToken: environmentToken, source: 'environment' }
  }

  if (process.platform === 'darwin') {
    const raw = await readClaudeKeychain(await findClaudeKeychainAccount())
    if (raw) return parseClaudeCredential(raw, 'keychain')
  }

  const filePath = path.join(os.homedir(), '.claude', '.credentials.json')
  try {
    return parseClaudeCredential(fs.readFileSync(filePath, 'utf8'), 'file')
  } catch {
    throw new QuotaDisplayError('No existing Claude Code subscription session was found. Agent Pets never asks for credentials.')
  }
}

function mapClaudeWindow(id: string, label: string, raw: unknown): QuotaWindow | null {
  const window = asObject(raw)
  const used = finitePercent(window?.utilization ?? window?.percent)
  if (!window || used === null) return null
  const resetValue = nonEmptyString(window.resets_at)
  const resetMillis = resetValue ? Date.parse(resetValue) : NaN
  return {
    id,
    label,
    usedPercent: used,
    remainingPercent: 100 - used,
    ...(Number.isFinite(resetMillis) ? { resetsAt: new Date(resetMillis).toISOString() } : {}),
  }
}

export function parseClaudeUsage(body: Record<string, any>): QuotaWindow[] {
  const windows: QuotaWindow[] = []
  const definitions: Array<[string, string, string[]]> = [
    ['session', 'Session', ['five_hour']],
    ['weekly', 'Weekly', ['seven_day']],
    ['oauth-apps', 'OAuth Apps', ['seven_day_oauth_apps']],
    ['sonnet', 'Sonnet', ['seven_day_sonnet']],
    ['opus', 'Opus', ['seven_day_opus']],
    ['design', 'Designs', ['seven_day_design', 'seven_day_claude_design', 'claude_design', 'design', 'seven_day_omelette', 'omelette']],
    ['routines', 'Daily Routines', ['seven_day_routines', 'seven_day_claude_routines', 'claude_routines', 'routines', 'routine', 'seven_day_cowork', 'cowork']],
  ]
  for (const [id, label, keys] of definitions) {
    for (const key of keys) {
      const mapped = mapClaudeWindow(id, label, body[key])
      if (mapped) {
        windows.push(mapped)
        break
      }
    }
  }
  if (Array.isArray(body.limits)) {
    const existingLabels = new Set(windows.map((window) => window.label.toLowerCase()))
    for (let index = 0; index < body.limits.length; index += 1) {
      if (windows.length >= MAX_WINDOWS_PER_PROVIDER) break
      const raw: unknown = body.limits[index]
      const limit = asObject(raw)
      if (limit?.group !== 'weekly' || limit?.kind !== 'weekly_scoped') continue
      const scope = asObject(limit?.scope)
      const model = asObject(scope?.model)
      const displayName = nonEmptyString(model?.display_name)?.slice(0, MAX_DISPLAY_TEXT_LENGTH)
      if (!displayName || /(^|[-_ ])all[-_ ]models$/i.test(displayName)) continue
      const label = ['sonnet', 'opus', 'designs', 'daily routines'].includes(displayName.toLowerCase())
        ? displayName
        : `${displayName} only`
      if (existingLabels.has(displayName.toLowerCase()) || existingLabels.has(label.toLowerCase())) continue
      const mapped = mapClaudeWindow(`limit-${index}`, label, limit)
      if (mapped) {
        windows.push(mapped)
        existingLabels.add(label.toLowerCase())
      }
    }
  }
  return windows.slice(0, MAX_WINDOWS_PER_PROVIDER)
}

function claudeBinaryCandidates(): string[] {
  const home = os.homedir()
  const name = process.platform === 'win32' ? 'claude.exe' : 'claude'
  const directories = [
    ...(process.env.PATH ?? '').split(path.delimiter),
    // A GUI launch does not inherit the login shell's PATH, so also look
    // where the Claude Code installers put the command.
    path.join(home, '.local', 'bin'),
    path.join(home, '.claude', 'local'),
    ...(process.platform === 'win32'
      ? []
      : ['/opt/homebrew/bin', '/usr/local/bin', path.join(home, '.npm-global', 'bin'), path.join(home, '.bun', 'bin')]),
  ]
  // Relative PATH entries would resolve against the working directory.
  return [...new Set(directories.filter((directory) => path.isAbsolute(directory)))]
    .map((directory) => path.join(directory, name))
}

function findClaudeBinary(): string | undefined {
  for (const candidate of claudeBinaryCandidates()) {
    try {
      if (!fs.statSync(candidate).isFile()) continue
      if (process.platform !== 'win32') fs.accessSync(candidate, fs.constants.X_OK)
      return candidate
    } catch {}
  }
  return undefined
}

function claudeCliEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (!CLAUDE_CLI_BLOCKED_ENV.has(key)) env[key] = value
  }
  return { ...env, DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1', DISABLE_AUTOUPDATER: '1' }
}

function runClaudeCliUsage(binary: string): Promise<string> {
  // An empty working directory keeps project settings and memory out of the run.
  const workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-claude-'))
  return new Promise<string>((resolvePromise, reject) => {
    const child = execFile(binary, CLAUDE_USAGE_ARGS, {
      cwd: workDirectory,
      env: claudeCliEnv(),
      timeout: CLAUDE_CLI_TIMEOUT_MS,
      maxBuffer: MAX_RESPONSE_BYTES,
      windowsHide: true,
    }, (error, stdout) => {
      // A failed run can still print its JSON result with is_error set.
      if (error && !stdout) reject(new ClaudeCliUnavailable())
      else resolvePromise(String(stdout))
    })
    child.stdin?.end()
  }).finally(() => {
    try { fs.rmSync(workDirectory, { recursive: true, force: true }) } catch {}
  })
}

function zoneOffsetMillis(utcMillis: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(utcMillis))
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value)
  const wall = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour') % 24, part('minute'), part('second'))
  return wall - Math.floor(utcMillis / 1000) * 1000
}

// The instant a wall-clock time in timeZone names (local time without one).
function zonedMillis(year: number, month: number, day: number, hour: number, minute: number, timeZone?: string): number {
  if (!timeZone) return new Date(year, month, day, hour, minute).getTime()
  const wall = Date.UTC(year, month, day, hour, minute)
  return wall - zoneOffsetMillis(wall - zoneOffsetMillis(wall, timeZone), timeZone)
}

function validTimeZone(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return value
  } catch {
    return undefined
  }
}

// Reads "Oct 23 at 1:39pm (Asia/Taipei)", "Oct 9, 2:59pm (UTC)" or
// "3pm (Asia/Taipei)". A date without a year, or a time without a date, is
// the next one that ends a window of spanMs from now.
export function parseClaudeResetTime(raw: string, now: number, spanMs: number): string | undefined {
  const zoneMatch = raw.trim().match(/^(.*?)\s*\(([^)]+)\)$/)
  const timeZone = validTimeZone(zoneMatch?.[2]?.trim())
  const match = (zoneMatch ? zoneMatch[1] : raw.trim()).match(CLAUDE_RESET_TIME)
  if (!match) return undefined
  const [, monthName, dayText, yearText, hourText, minuteText, meridiem] = match
  const hour = (Number(hourText) % 12) + (meridiem.toLowerCase() === 'pm' ? 12 : 0)
  const minute = Number(minuteText ?? 0)
  if (hour > 23 || minute > 59) return undefined
  const latest = now + spanMs + HOUR_MS
  const today = new Date(now + (timeZone ? zoneOffsetMillis(now, timeZone) : -new Date(now).getTimezoneOffset() * 60_000))
  const pick = (candidates: number[], earliest: number) =>
    candidates.find((value) => value > earliest && value <= latest)

  let resetMillis: number | undefined
  if (monthName) {
    const month = MONTHS.indexOf(monthName.toLowerCase())
    const day = Number(dayText)
    if (month < 0 || day < 1 || day > 31) return undefined
    const years = yearText
      ? [Number(yearText)]
      : [today.getUTCFullYear() - 1, today.getUTCFullYear(), today.getUTCFullYear() + 1]
    const candidates = years.map((year) => zonedMillis(year, month, day, hour, minute, timeZone))
    resetMillis = yearText ? candidates[0] : pick(candidates, now - DAY_MS)
  } else {
    resetMillis = pick([0, 1, 2].map((offset) => zonedMillis(
      today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + offset, hour, minute, timeZone,
    )), now)
  }
  return resetMillis !== undefined && Number.isFinite(resetMillis)
    ? new Date(resetMillis).toISOString()
    : undefined
}

function claudeScopeWindow(scope: string): Pick<QuotaWindow, 'id' | 'label'> {
  const displayName = scope.slice(0, MAX_DISPLAY_TEXT_LENGTH)
  const known = ['sonnet', 'opus', 'designs', 'daily routines'].includes(displayName.toLowerCase())
  return {
    id: known
      ? displayName.toLowerCase().replace(/\s+/g, '-')
      : `week-scope-${displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
    label: known ? displayName : `${displayName} only`,
  }
}

// Reads the windows Claude Code's /usage prints. An empty list means the CLI
// gave no reading; a lapsed sign-in is reported instead of falling back.
export function parseClaudeCliUsage(text: string, now = Date.now()): QuotaWindow[] {
  const lines = text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').split(/\r?\n/).map((line) => line.trim())
  const windows: QuotaWindow[] = []
  for (const line of lines) {
    if (windows.length >= MAX_WINDOWS_PER_PROVIDER) break
    const match = line.match(CLAUDE_USAGE_LINE)
    const used = finitePercent(match?.[3])
    if (!match || used === null) continue
    const scope = nonEmptyString(match[2])
    const isSession = match[1] === 'session'
    const identity = isSession
      ? { id: 'session', label: 'Session' }
      : !scope || /^all models$/i.test(scope)
        ? { id: 'weekly', label: 'Weekly' }
        : claudeScopeWindow(scope)
    if (windows.some((window) => window.label === identity.label)) continue
    const resetsAt = match[4]
      ? parseClaudeResetTime(match[4], now, isSession ? 5 * HOUR_MS : 7 * DAY_MS)
      : undefined
    windows.push({
      ...identity,
      usedPercent: used,
      remainingPercent: 100 - used,
      ...(resetsAt ? { resetsAt } : {}),
    })
  }
  if (windows.length === 0 && lines.some((line) => CLAUDE_SIGN_IN_LAPSED.test(line))) {
    throw new QuotaDisplayError('The existing Claude Code session expired. Re-authenticate in Claude Code.')
  }
  if (windows.length === 0 && CLAUDE_COST_SUMMARY.test(lines.join('\n'))) {
    throw new QuotaDisplayError(CLAUDE_NOT_SIGNED_IN)
  }
  return windows
}

async function readClaudeCliUsage(binary: string): Promise<QuotaWindow[]> {
  const stdout = await runClaudeCliUsage(binary)
  let result: Record<string, any> | null = null
  try {
    result = asObject(JSON.parse(stdout))
  } catch {}
  const text = nonEmptyString(result?.result) ?? stdout
  if (result?.is_error === true) {
    if (CLAUDE_SIGN_IN_LAPSED.test(text)) {
      throw new QuotaDisplayError('The existing Claude Code session expired. Re-authenticate in Claude Code.')
    }
    throw new ClaudeCliUnavailable()
  }
  return parseClaudeCliUsage(text)
}

async function claudePlan(): Promise<string | undefined> {
  try {
    const oauth = asObject((await loadClaudeCredential()).root.claudeAiOauth)
    return cleanPlan(oauth?.subscriptionType ?? oauth?.rateLimitTier)
  } catch {
    return undefined
  }
}

async function claudeUserAgent(binary: string | undefined): Promise<string> {
  if (binary) {
    try {
      const { stdout } = await execFileAsync(binary, ['--version'], { timeout: 3_000, windowsHide: true })
      const version = stdout.trim().split(/\s+/)[0]
      if (version) return `claude-code/${version}`
    } catch {}
  }
  return 'claude-code/2.1.0'
}

async function fetchClaudeApiQuota(binary: string | undefined): Promise<QuotaProvider> {
  const credential = await loadClaudeCredential()
  // Only Claude Code refreshes its own login: a refresh here would rotate the
  // refresh token out from under the CLI.
  if (credential.expiresAt && credential.expiresAt <= Date.now()) {
    throw new QuotaDisplayError('The existing Claude Code session expired. Re-authenticate in Claude Code.')
  }
  const { status, body } = await requestJson(CLAUDE_USAGE_URL, {
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${credential.accessToken}`,
      'anthropic-beta': 'oauth-2025-04-20',
      'user-agent': await claudeUserAgent(binary),
    },
  })
  if (status === 401) throw new QuotaDisplayError('The existing Claude Code session expired. Re-authenticate in Claude Code.')
  if (status === 403) throw new QuotaDisplayError('The existing Claude Code session cannot access quota. Re-authenticate in Claude Code.')
  if (status === 429) throw new QuotaDisplayError('Claude quota is rate limited. Wait a minute and retry.')
  if (status < 200 || status >= 300) throw new QuotaDisplayError(`Claude usage request failed (${status}).`)
  const windows = parseClaudeUsage(body)
  if (windows.length === 0) throw new QuotaDisplayError('Claude returned no quota windows.')
  const oauth = asObject(credential.root.claudeAiOauth)
  return {
    id: 'claude',
    name: 'Claude Code',
    plan: cleanPlan(oauth?.subscriptionType ?? oauth?.rateLimitTier),
    windows,
  }
}

async function fetchClaudeQuota(): Promise<QuotaProvider> {
  try {
    const binary = findClaudeBinary()
    if (binary) {
      try {
        const windows = await readClaudeCliUsage(binary)
        if (windows.length > 0) return { id: 'claude', name: 'Claude Code', plan: await claudePlan(), windows }
      } catch (error) {
        if (!(error instanceof ClaudeCliUnavailable)) throw error
      }
    }
    return await fetchClaudeApiQuota(binary)
  } catch (error) {
    return { id: 'claude', name: 'Claude Code', windows: [], error: safeError(error, 'Could not load Claude usage.') }
  }
}

export async function getQuotaUsage(force = false): Promise<QuotaUsageResult> {
  const now = Date.now()
  if (!force && cachedResult && now - cachedAt < CACHE_TTL_MS) return cachedResult
  if (force && cachedResult && now - lastFetchStartedAt < FORCE_REFRESH_COOLDOWN_MS) return cachedResult
  if (inFlight) return inFlight
  lastFetchStartedAt = now
  inFlight = (async () => {
    const providers = await Promise.all([fetchCodexQuota(), fetchClaudeQuota()])
    const result = { updatedAt: new Date().toISOString(), providers }
    cachedResult = result
    cachedAt = Date.now()
    return result
  })()
  try {
    return await inFlight
  } finally {
    inFlight = null
  }
}
