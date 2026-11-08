import assert from 'node:assert/strict'
import test from 'node:test'
import { quotaFreshness, quotaTone, relativeAge, resetCountdown } from '../src/utils/quota-math.ts'

const NOW = Date.parse('2026-10-23T03:00:00Z')

test('quota tone is healthy above 30, warn from 10 to 30, critical below 10', () => {
  assert.equal(quotaTone(100), 'healthy')
  assert.equal(quotaTone(30.1), 'healthy')
  assert.equal(quotaTone(30), 'warn')
  assert.equal(quotaTone(10), 'warn')
  assert.equal(quotaTone(9.9), 'critical')
  assert.equal(quotaTone(0), 'critical')
})

test('reset countdown rounds up and never reports "now" while seconds remain', () => {
  const at = (ms: number) => new Date(NOW + ms).toISOString()
  assert.deepEqual(resetCountdown(undefined, NOW), { kind: 'unavailable' })
  assert.deepEqual(resetCountdown('nope', NOW), { kind: 'unavailable' })
  assert.deepEqual(resetCountdown(at(29_000), NOW), { kind: 'soon' })
  assert.deepEqual(resetCountdown(at(-5_000), NOW), { kind: 'soon' })
  assert.deepEqual(resetCountdown(at(61_000), NOW), { kind: 'minutes', minutes: 2 })
  // 59.6 minutes must not become "1 hour 0 minutes".
  assert.deepEqual(resetCountdown(at(59.6 * 60_000), NOW), { kind: 'hours', hours: 1, minutes: 0 })
  assert.deepEqual(resetCountdown(at(59.2 * 60_000), NOW), { kind: 'hours', hours: 1, minutes: 0 })
  assert.deepEqual(resetCountdown(at(58.2 * 60_000), NOW), { kind: 'minutes', minutes: 59 })
  assert.deepEqual(resetCountdown(at(26 * 3_600_000), NOW), { kind: 'days', days: 1, hours: 2 })
})

test('quota freshness and relative age buckets', () => {
  assert.equal(quotaFreshness(NOW - 4 * 60_000, NOW), 'fresh')
  assert.equal(quotaFreshness(NOW - 6 * 60_000, NOW), 'stale')
  assert.equal(quotaFreshness(null, NOW), 'stale')
  assert.deepEqual(relativeAge(NOW - 5_000, NOW), { kind: 'now' })
  assert.deepEqual(relativeAge(NOW - 3 * 60_000, NOW), { kind: 'minutes', minutes: 3 })
  assert.deepEqual(relativeAge(NOW - 5 * 3_600_000, NOW), { kind: 'hours', hours: 5 })
  assert.deepEqual(relativeAge(NOW - 49 * 3_600_000, NOW), { kind: 'days', days: 2 })
})
