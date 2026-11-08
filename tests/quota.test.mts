import test from 'node:test'
import assert from 'node:assert/strict'
import { parseClaudeCliUsage, parseClaudeResetTime } from '../electron/quota.ts'
import { setLocale, translateBackendError } from '../src/i18n.ts'

const HOUR = 60 * 60_000
const DAY = 24 * HOUR

test('Claude Code /usage windows map to the canonical session and weekly ids', () => {
  const now = Date.parse('2026-10-23T03:00:00Z')
  const windows = parseClaudeCliUsage([
    'You are currently using your subscription to power your Claude Code usage',
    '',
    'Current session: 16% used · resets Oct 23 at 1:39pm (Asia/Taipei)',
    'Current week (all models): 51% used · resets Oct 27 at 5:59pm (Asia/Taipei)',
    'Current week (Sonnet): 3% used',
    'Current week (Fable): 0% used',
    '',
    "What's contributing to your limits usage?",
    '  57%  See what fills your context · run /context',
  ].join('\n'), now)
  assert.deepEqual(windows, [
    { id: 'session', label: 'Session', usedPercent: 16, remainingPercent: 84, resetsAt: '2026-10-23T05:39:00.000Z' },
    { id: 'weekly', label: 'Weekly', usedPercent: 51, remainingPercent: 49, resetsAt: '2026-10-27T09:59:00.000Z' },
    { id: 'sonnet', label: 'Sonnet', usedPercent: 3, remainingPercent: 97 },
    { id: 'week-scope-fable', label: 'Fable only', usedPercent: 0, remainingPercent: 100 },
  ])
})

test('a lapsed Claude Code sign-in is reported instead of an empty reading', () => {
  assert.throws(
    () => parseClaudeCliUsage('OAuth session expired and could not be refreshed. Please run /login.'),
    /Re-authenticate in Claude Code/,
  )
  assert.throws(() => parseClaudeCliUsage('Invalid API key · Please run /login'), /Re-authenticate in Claude Code/)
  assert.deepEqual(parseClaudeCliUsage('You are currently using your subscription to power your Claude Code usage'), [])
  assert.deepEqual(parseClaudeCliUsage('\u001b[1mCurrent session: 5% used\u001b[0m').map((window) => window.id), ['session'])
})

test('Claude reset times without a year or date resolve to the next window end', () => {
  const now = Date.parse('2026-12-31T20:00:00Z')
  assert.equal(parseClaudeResetTime('Jan 1 at 2am (UTC)', now, 5 * HOUR), '2027-01-01T02:00:00.000Z')
  assert.equal(parseClaudeResetTime('Jan 2, 2027, 2:30pm (UTC)', now, 7 * DAY), '2027-01-02T14:30:00.000Z')
  assert.equal(parseClaudeResetTime('Jan 6, 9am (UTC)', now, 7 * DAY), '2027-01-06T09:00:00.000Z')
  assert.equal(parseClaudeResetTime('11pm (UTC)', now, 5 * HOUR), '2026-12-31T23:00:00.000Z')
  assert.equal(parseClaudeResetTime('3pm (Asia/Taipei)', Date.parse('2026-10-23T03:00:00Z'), 5 * HOUR), '2026-10-23T07:00:00.000Z')
  assert.equal(parseClaudeResetTime('soon', now, 5 * HOUR), undefined)
  assert.equal(parseClaudeResetTime('13pm (UTC)', now, 5 * HOUR), undefined)
})

test('a CLI without a subscription sign-in asks the user to run /login', () => {
  const costSummary = [
    'Total cost:            $0.0000',
    'Total duration (API):  0s',
    'Usage:                 0 input, 0 output, 0 cache read, 0 cache write',
  ].join('\n')
  assert.throws(() => parseClaudeCliUsage(costSummary), (error: Error) => {
    assert.match(error.message, /not signed in to a subscription.*\/login/)
    setLocale('zh-TW')
    assert.equal(translateBackendError(error.message), 'Claude Code CLI 尚未登入訂閱帳號。請在終端機執行 `claude`，並以 /login 登入。')
    return true
  })
})

test('over-quota readings are clamped to [0, 100] with an overage flag instead of being dropped', async () => {
  const { clampedUsage, parseClaudeUsage, parseCodexUsage } = await import('../electron/quota.ts')
  assert.deepEqual(clampedUsage(105), { usedPercent: 100, remainingPercent: 0, overage: true })
  assert.deepEqual(clampedUsage(-3), { usedPercent: 0, remainingPercent: 100 })
  assert.deepEqual(clampedUsage('42'), { usedPercent: 42, remainingPercent: 58 })
  assert.equal(clampedUsage('abc'), null)
  assert.equal(clampedUsage(undefined), null)

  const claude = parseClaudeUsage({ five_hour: { utilization: 112 }, seven_day: { utilization: 41 } })
  assert.deepEqual(claude.map(w => [w.id, w.usedPercent, w.remainingPercent, w.overage ?? false]), [
    ['session', 100, 0, true],
    ['weekly', 41, 59, false],
  ])
  const codex = parseCodexUsage({ rate_limit: { primary_window: { used_percent: 130, limit_window_seconds: 18000 } } })
  assert.ok(codex.windows.every(w => w.remainingPercent === 0 && w.overage === true))
  assert.deepEqual(
    parseClaudeCliUsage('Current session: 105% used').map(w => [w.usedPercent, w.remainingPercent, w.overage]),
    [[100, 0, true]],
  )
})

test('quota errors are classified, failures keep the last good reading, and failures are not cached for long', async () => {
  const quota = await import('../electron/quota.ts')
  quota.resetQuotaCacheForTests()
  const ok = (): Promise<import('../electron/quota.ts').QuotaProvider[]> => Promise.resolve([
    { id: 'codex', name: 'Codex', windows: [{ id: 'main-0', label: 'Session', usedPercent: 36, remainingPercent: 64 }] },
    { id: 'claude', name: 'Claude Code', windows: [] , error: 'x', errorKind: 'not-signed-in' },
  ])
  const first = await quota.getQuotaUsage(false, ok)
  const codexFirst = first.providers.find(p => p.id === 'codex')!
  assert.ok(codexFirst.fetchedAt && !codexFirst.stale)
  assert.equal(first.providers.find(p => p.id === 'claude')!.fetchedAt, undefined)

  // A forced refresh inside the cooldown is answered from cache and says so.
  const throttled = await quota.getQuotaUsage(true, ok)
  assert.ok(throttled.throttled && throttled.throttled.retryInSec >= 1 && throttled.throttled.retryInSec <= 10)
  assert.equal(throttled.updatedAt, first.updatedAt)
})

test('a failing provider keeps its previous windows marked stale and failures expire after a back-off', async (t) => {
  const quota = await import('../electron/quota.ts')
  quota.resetQuotaCacheForTests()
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-23T03:00:00Z') })
  const good = await quota.getQuotaUsage(false, async () => [
    { id: 'codex', name: 'Codex', plan: 'Plus', windows: [{ id: 'm', label: 'Session', usedPercent: 36, remainingPercent: 64 }] },
  ])
  assert.equal(good.providers[0].stale, undefined)

  t.mock.timers.tick(100_000) // past the 90s success TTL
  const failed = await quota.getQuotaUsage(false, async () => [
    { id: 'codex', name: 'Codex', windows: [], error: 'Expired', errorKind: 'expired' },
  ])
  const provider = failed.providers[0]
  assert.equal(provider.stale, true)
  assert.equal(provider.errorKind, 'expired')
  assert.equal(provider.plan, 'Plus')
  assert.deepEqual(provider.windows.map(w => w.remainingPercent), [64])
  assert.equal(provider.fetchedAt, good.providers[0].fetchedAt)

  // An auth failure is cached for 60s (not 10s, not the 90s success TTL).
  t.mock.timers.tick(30_000)
  const stillCached = await quota.getQuotaUsage(false, async () => { throw new Error('should not refetch') })
  assert.equal(stillCached.providers[0].errorKind, 'expired')
  t.mock.timers.tick(31_000)
  const recovered = await quota.getQuotaUsage(false, async () => [
    { id: 'codex', name: 'Codex', windows: [{ id: 'm', label: 'Session', usedPercent: 10, remainingPercent: 90 }] },
  ])
  assert.equal(recovered.providers[0].stale, undefined)
  assert.equal(recovered.providers[0].windows[0].remainingPercent, 90)
})

test('quota error kinds are derived from the sanitized failure', async () => {
  const { classifyQuotaError, QuotaDisplayError } = await import('../electron/quota.ts')
  const kind = (message: string) => classifyQuotaError(new QuotaDisplayError(message))
  assert.equal(kind('No existing Codex CLI subscription session was found. Agent Pets never asks for credentials.'), 'not-signed-in')
  assert.equal(kind('The existing Codex CLI session expired. Re-authenticate in Codex CLI.'), 'expired')
  assert.equal(kind('Claude quota is rate limited. Wait a minute and retry.'), 'rate-limited')
  assert.equal(kind('Request timed out. Try again.'), 'timeout')
  assert.equal(kind('Codex usage request failed (500).'), 'unavailable')
  const abort = new Error('x'); abort.name = 'AbortError'
  assert.equal(classifyQuotaError(abort), 'timeout')
})

test('failing providers back off exponentially and a success resets the ladder', async () => {
  const quota = await import('../electron/quota.ts')
  quota.resetQuotaCacheForTests()
  const provider = (errorKind?: string) => ({ id: 'claude', name: 'Claude', windows: [], ...(errorKind ? { error: 'x', errorKind } : {}) }) as never
  const ttl = (...providers: unknown[]) => quota.nextQuotaCacheTtl(providers as never)
  assert.deepEqual([1, 2, 3].map(() => ttl(provider('timeout'))), [10_000, 20_000, 40_000])
  assert.equal(ttl(provider()), 90_000)
  assert.deepEqual([1, 2, 3].map(() => ttl(provider('rate-limited'))), [60_000, 120_000, 240_000])
  for (let i = 0; i < 10; i += 1) ttl(provider('expired'))
  assert.equal(ttl(provider('not-signed-in')), 15 * 60_000)
  quota.resetQuotaCacheForTests()
})
