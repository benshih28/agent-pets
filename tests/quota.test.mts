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
