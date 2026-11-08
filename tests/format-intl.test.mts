import test from 'node:test'
import assert from 'node:assert/strict'
import { formatDuration, formatNumber, formatRelative } from '../src/utils/intl-format.ts'
import { setLocale, tPlural } from '../src/i18n.ts'

test('formatDuration is compact and clamps negatives', () => {
  assert.equal(formatDuration(8_000), '8s')
  assert.equal(formatDuration(252_000), '4m 12s')
  assert.equal(formatDuration(3_900_000), '1h 05m')
  assert.equal(formatDuration(-5), '0s')
})

test('formatRelative uses Intl.RelativeTimeFormat per locale', () => {
  const now = Date.UTC(2026, 0, 1, 12)
  assert.equal(formatRelative(now - 5 * 60_000, now, 'en-US'), '5 minutes ago')
  assert.equal(formatRelative(now + 2 * 3600_000, now, 'en-US'), 'in 2 hours')
  assert.match(formatRelative(now - 5 * 60_000, now, 'zh-TW'), /5/)
})

test('formatNumber groups digits by locale', () => {
  assert.equal(formatNumber(1234567, 'en-US'), '1,234,567')
})

test('tPlural falls back to the bare key when no catalog entry exists', () => {
  setLocale('en-US')
  assert.equal(tPlural('design.__missing__', 2), 'design.__missing__')
  setLocale('zh-TW')
})
