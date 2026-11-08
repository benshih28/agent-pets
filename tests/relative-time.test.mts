import assert from 'node:assert/strict'
import test from 'node:test'
import { formatRelativeTime, linkHost } from '../src/utils/relative-time.ts'

const now = Date.UTC(2026, 10, 7, 12, 0, 0)

test('relative time picks the coarsest fitting unit', () => {
  assert.equal(formatRelativeTime(now - 5 * 60_000, now, 'en-US'), '5 minutes ago')
  assert.equal(formatRelativeTime(now - 3 * 3_600_000, now, 'en-US'), '3 hours ago')
  assert.equal(formatRelativeTime(now - 86_400_000, now, 'en-US'), 'yesterday')
  assert.equal(formatRelativeTime(now - 10_000, now, 'en-US'), 'now')
})

test('relative time falls back to a date after a week and localizes', () => {
  const old = formatRelativeTime(now - 30 * 86_400_000, now, 'en-US')
  assert.match(old, /2026/)
  assert.match(formatRelativeTime(now - 5 * 60_000, now, 'zh-TW'), /5 分鐘前/)
})

test('link host only exposes the hostname', () => {
  assert.equal(linkHost('https://docs.example.com/a/b?q=1'), 'docs.example.com')
  assert.equal(linkHost('not a url'), '')
  assert.equal(linkHost(undefined), '')
})
