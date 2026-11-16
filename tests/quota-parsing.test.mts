import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'
import {
  getQuotaUsage,
  parseClaudeUsage,
  parseCodexUsage,
  resetQuotaCacheForTests,
  type QuotaProvider,
} from '../electron/quota.ts'
import { removeTempTree } from './support/temp-dir.mts'

const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
const CODEX_REFRESH_URL = 'https://auth.openai.com/oauth/token'
const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'

test('Codex usage: labels follow the window length, numeric strings are accepted, invalid windows are dropped', () => {
  const parsed = parseCodexUsage({
    plan_type: 'chatgpt_pro_plus',
    rate_limit: {
      primary_window: { used_percent: '20', limit_window_seconds: '604800', reset_at: '1700000000' },
      secondary_window: { used_percent: 5, limit_window_seconds: 18_000, reset_at: 0 },
    },
    additional_rate_limits: [
      null,
      'junk',
      { limit_name: '  Codex Spark  ', rate_limit: { primary_window: { used_percent: 1 }, secondary_window: [] } },
      { metered_feature: 'review', rate_limit: { secondary_window: { used_percent: 2, limit_window_seconds: 18_000, reset_at: -5 } } },
      { rate_limit: { primary_window: { used_percent: 'n/a' } } },
      { rate_limit: { primary_window: { used_percent: 3, reset_at: 'soon' } } },
    ],
  })
  assert.equal(parsed.plan, 'Pro Plus')
  assert.deepEqual(parsed.windows, [
    { id: 'main-1', label: 'Session', usedPercent: 5, remainingPercent: 95 },
    { id: 'main-0', label: 'Weekly', usedPercent: 20, remainingPercent: 80, resetsAt: new Date(1_700_000_000_000).toISOString() },
    { id: 'additional-2-primary', label: 'Codex Spark', usedPercent: 1, remainingPercent: 99 },
    { id: 'additional-3-secondary', label: 'review', usedPercent: 2, remainingPercent: 98 },
    { id: 'additional-5-primary', label: 'Additional', usedPercent: 3, remainingPercent: 97 },
  ])
})

test('Codex usage: a missing or malformed body yields no windows and no plan', () => {
  assert.deepEqual(parseCodexUsage({}), { plan: undefined, windows: [] })
  assert.deepEqual(parseCodexUsage({ rate_limit: [], additional_rate_limits: {}, plan_type: 7 }), { plan: undefined, windows: [] })
  assert.deepEqual(parseCodexUsage({ rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 60 } } }).windows, [
    { id: 'main-0', label: 'Usage', usedPercent: 10, remainingPercent: 90 },
  ])
})

test('Codex usage: windows are capped per provider', () => {
  const additional = Array.from({ length: 40 }, () => ({
    rate_limit: { primary_window: { used_percent: 1 }, secondary_window: { used_percent: 2 } },
  }))
  const parsed = parseCodexUsage({
    rate_limit: { primary_window: { used_percent: 1 } },
    additional_rate_limits: additional,
  })
  assert.equal(parsed.windows.length, 32)
  assert.equal(parsed.windows.at(-1)!.id, 'additional-15-primary')
})

test('Claude usage: the first present key wins, percent is a fallback and reset times are normalized', () => {
  const windows = parseClaudeUsage({
    five_hour: { utilization: '12.5', resets_at: '2030-01-02T03:04:05+08:00' },
    seven_day: { percent: 40, resets_at: 'not a date' },
    seven_day_design: 'junk',
    seven_day_claude_design: { utilization: 7 },
    claude_design: { utilization: 99 },
    seven_day_routines: { utilization: null },
    routines: { utilization: 3, resets_at: 12 },
  })
  assert.deepEqual(windows, [
    { id: 'session', label: 'Session', usedPercent: 12.5, remainingPercent: 87.5, resetsAt: '2030-01-01T19:04:05.000Z' },
    { id: 'weekly', label: 'Weekly', usedPercent: 40, remainingPercent: 60 },
    { id: 'design', label: 'Designs', usedPercent: 7, remainingPercent: 93 },
    { id: 'routines', label: 'Daily Routines', usedPercent: 3, remainingPercent: 97 },
  ])
})

test('Claude usage: scoped weekly limits add model windows once and skip all-models or malformed entries', () => {
  const scoped = (displayName: unknown, utilization: unknown) => ({
    group: 'weekly', kind: 'weekly_scoped', utilization, scope: { model: { display_name: displayName } },
  })
  const windows = parseClaudeUsage({
    seven_day_sonnet: { utilization: 10 },
    limits: [
      scoped('Sonnet', 50),
      scoped('Haiku', 20),
      scoped('Haiku', 30),
      scoped('All models', 60),
      scoped('claude-all-models', 60),
      scoped('Opus', 'x'),
      scoped(42, 5),
      { group: 'daily', kind: 'weekly_scoped', utilization: 1, scope: { model: { display_name: 'Daily' } } },
      { group: 'weekly', kind: 'weekly_scoped', utilization: 1, scope: [] },
      null,
      scoped('  Designs  ', 4),
    ],
  })
  assert.deepEqual(windows, [
    { id: 'sonnet', label: 'Sonnet', usedPercent: 10, remainingPercent: 90 },
    { id: 'limit-1', label: 'Haiku only', usedPercent: 20, remainingPercent: 80 },
    { id: 'limit-10', label: 'Designs', usedPercent: 4, remainingPercent: 96 },
  ])
  assert.deepEqual(parseClaudeUsage({ limits: 'nope', five_hour: [] }), [])
})

interface RecordedRequest {
  url: string
  headers: Record<string, string>
  body?: unknown
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

// 憑證流程只能端到端測：讀取與 refresh 都是私有函式。把家目錄、PATH、設定目錄全導到暫存資料夾，
// 確保不會讀到或執行本機真正的 Codex／Claude 登入與 CLI。
function isolateEnvironment(t: TestContext, responder: (request: RecordedRequest) => Response): {
  root: string
  codexHome: string
  claudeHome: string
  requests: RecordedRequest[]
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-quota-'))
  const codexHome = path.join(root, 'codex')
  const claudeHome = path.join(root, 'claude')
  fs.mkdirSync(codexHome)
  fs.mkdirSync(claudeHome)
  const saved = new Map<string, string | undefined>()
  const setEnv = (name: string, value: string | undefined) => {
    if (!saved.has(name)) saved.set(name, process.env[name])
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  setEnv('HOME', root)
  setEnv('USERPROFILE', root)
  setEnv('PATH', '')
  setEnv('CODEX_HOME', codexHome)
  setEnv('CLAUDE_CONFIG_DIR', claudeHome)
  setEnv('CLAUDE_CODE_OAUTH_TOKEN', undefined)
  const requests: RecordedRequest[] = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request: RecordedRequest = {
      url: String(input),
      headers: { ...(init?.headers as Record<string, string> | undefined) },
      ...(typeof init?.body === 'string' ? { body: JSON.parse(init.body) } : {}),
    }
    requests.push(request)
    return responder(request)
  }) as typeof fetch
  resetQuotaCacheForTests()
  t.after(() => {
    globalThis.fetch = originalFetch
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    resetQuotaCacheForTests()
    removeTempTree(root)
  })
  return { root, codexHome, claudeHome, requests }
}

function provider(providers: QuotaProvider[], id: QuotaProvider['id']): QuotaProvider {
  const found = providers.find(entry => entry.id === id)
  assert.ok(found, `missing provider ${id}`)
  return found
}

test('Codex refresh rewrites only the token fields and keeps every other field of auth.json', async t => {
  const env = isolateEnvironment(t, request => {
    if (request.url === CODEX_REFRESH_URL) return jsonResponse(200, { access_token: ' fresh-token ' })
    if (request.url === CODEX_USAGE_URL) {
      return jsonResponse(200, { plan_type: 'plus', rate_limit: { primary_window: { used_percent: 30, limit_window_seconds: 18_000 } } })
    }
    if (request.url === CLAUDE_USAGE_URL) return jsonResponse(200, { five_hour: { utilization: 1 } })
    return jsonResponse(404, {})
  })
  process.env.CLAUDE_CODE_OAUTH_TOKEN = 'env-claude-token'
  const authPath = path.join(env.codexHome, 'auth.json')
  fs.writeFileSync(authPath, JSON.stringify({
    keep: { nested: true },
    last_refresh: '2000-01-01T00:00:00.000Z',
    tokens: { accessToken: 'stale-token', refreshToken: 'refresh-1', accountId: 'account-7', id_token: 'id-1', extra: 1 },
  }))

  const before = Date.now()
  const result = await getQuotaUsage(false)
  const codex = provider(result.providers, 'codex')
  assert.equal(codex.error, undefined)
  assert.equal(codex.plan, 'Plus')
  assert.deepEqual(codex.windows.map(window => window.id), ['main-0'])

  const refresh = env.requests.find(request => request.url === CODEX_REFRESH_URL)
  assert.deepEqual(refresh?.body, {
    client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
    grant_type: 'refresh_token',
    refresh_token: 'refresh-1',
    scope: 'openid profile email',
  })
  const usage = env.requests.find(request => request.url === CODEX_USAGE_URL)
  assert.equal(usage?.headers.authorization, 'Bearer fresh-token')
  assert.equal(usage?.headers['ChatGPT-Account-Id'], 'account-7')

  const written = JSON.parse(fs.readFileSync(authPath, 'utf8'))
  assert.ok(Date.parse(written.last_refresh) >= before - 1_000)
  assert.deepEqual({ ...written, last_refresh: '<now>' }, {
    keep: { nested: true },
    last_refresh: '<now>',
    tokens: {
      accessToken: 'stale-token',
      refreshToken: 'refresh-1',
      accountId: 'account-7',
      id_token: 'id-1',
      extra: 1,
      access_token: 'fresh-token',
      refresh_token: 'refresh-1',
    },
  })

  const claude = provider(result.providers, 'claude')
  assert.equal(claude.error, undefined)
  assert.equal(claude.plan, undefined)
  const claudeRequest = env.requests.find(request => request.url === CLAUDE_USAGE_URL)
  assert.equal(claudeRequest?.headers.authorization, 'Bearer env-claude-token')
  assert.equal(claudeRequest?.headers['user-agent'], 'claude-code/2.1.0')
})

test('Codex credentials: API-key mode, missing tokens and a recent login without refresh are handled without writing', async t => {
  const env = isolateEnvironment(t, request => request.url === CODEX_USAGE_URL
    ? jsonResponse(200, { rate_limit: { primary_window: { used_percent: 5 } } })
    : jsonResponse(401, {}))
  const authPath = path.join(env.codexHome, 'auth.json')

  fs.writeFileSync(authPath, JSON.stringify({ OPENAI_API_KEY: 'sk-x', tokens: { access_token: 'a' } }))
  let codex = provider((await getQuotaUsage(false)).providers, 'codex')
  assert.equal(codex.errorKind, 'not-signed-in')
  assert.match(codex.error ?? '', /API|API 金鑰|api-key/i)

  for (const root of [[], { tokens: [] }, { tokens: { access_token: '   ' } }, 'text']) {
    resetQuotaCacheForTests()
    fs.writeFileSync(authPath, JSON.stringify(root))
    codex = provider((await getQuotaUsage(false)).providers, 'codex')
    assert.equal(codex.errorKind, 'not-signed-in', JSON.stringify(root))
  }

  resetQuotaCacheForTests()
  const recent = { last_refresh: new Date().toISOString(), tokens: { access_token: 'current', refresh_token: 'r' } }
  fs.writeFileSync(authPath, JSON.stringify(recent))
  codex = provider((await getQuotaUsage(false)).providers, 'codex')
  assert.equal(codex.error, undefined)
  assert.ok(!env.requests.some(request => request.url === CODEX_REFRESH_URL))
  assert.deepEqual(JSON.parse(fs.readFileSync(authPath, 'utf8')), recent)
})

test('Claude credential file: expiry, plan and malformed roots', { skip: process.platform === 'darwin' ? 'macOS reads the Keychain first' : false }, async t => {
  const env = isolateEnvironment(t, request => request.url === CLAUDE_USAGE_URL
    ? jsonResponse(200, { seven_day: { utilization: 9 } })
    : jsonResponse(401, {}))
  const credentialPath = path.join(env.claudeHome, '.credentials.json')

  fs.writeFileSync(credentialPath, JSON.stringify({
    claudeAiOauth: { accessToken: ' file-token ', expiresAt: String(Date.now() + 3_600_000), rateLimitTier: 'default_claude_max_20x' },
  }))
  let claude = provider((await getQuotaUsage(false)).providers, 'claude')
  assert.equal(claude.error, undefined)
  assert.equal(claude.plan, 'Default Claude Max 20x')
  assert.equal(env.requests.find(request => request.url === CLAUDE_USAGE_URL)?.headers.authorization, 'Bearer file-token')

  resetQuotaCacheForTests()
  fs.writeFileSync(credentialPath, JSON.stringify({ claudeAiOauth: { accessToken: 't', expiresAt: '1000' } }))
  claude = provider((await getQuotaUsage(false)).providers, 'claude')
  assert.equal(claude.errorKind, 'expired')

  for (const root of [[], { claudeAiOauth: [] }, { claudeAiOauth: { accessToken: 7 } }]) {
    resetQuotaCacheForTests()
    fs.writeFileSync(credentialPath, JSON.stringify(root))
    claude = provider((await getQuotaUsage(false)).providers, 'claude')
    assert.equal(claude.errorKind, 'not-signed-in', JSON.stringify(root))
  }

  resetQuotaCacheForTests()
  fs.writeFileSync(credentialPath, JSON.stringify({ claudeAiOauth: { accessToken: 't', expiresAt: 'never', subscriptionType: 'pro' } }))
  claude = provider((await getQuotaUsage(false)).providers, 'claude')
  assert.equal(claude.error, undefined)
  assert.equal(claude.plan, 'Pro')
})
