import assert from 'node:assert/strict'
import test from 'node:test'
import { durationParts, formatTokens, niceCeiling } from '../src/utils/token-format.ts'

test('token formatting is locale-stable: exact below 1,000, K/M/B above, grouped when full', () => {
  for (const locale of ['zh-TW', 'en-US']) {
    assert.equal(formatTokens(0, locale), '0')
    assert.equal(formatTokens(999, locale), '999')
    assert.equal(formatTokens(1_000, locale), '1K')
    assert.equal(formatTokens(1_250, locale), '1.3K')
    assert.equal(formatTokens(1_200_000, locale), '1.2M')
    assert.equal(formatTokens(250_000_000, locale), '250M')
    assert.equal(formatTokens(3_400_000_000, locale), '3.4B')
  }
  assert.equal(formatTokens(1_234_567, 'en-US', 'full'), '1,234,567')
  assert.equal(formatTokens(Number.NaN, 'en-US'), '0')
  assert.equal(formatTokens(-5, 'en-US'), '0')
})

test('durations break down into days, hours and minutes', () => {
  assert.deepEqual(durationParts(0), { days: 0, hours: 0, minutes: 0 })
  assert.deepEqual(durationParts(20_000), { days: 0, hours: 0, minutes: 1 })
  assert.deepEqual(durationParts(90 * 60_000), { days: 0, hours: 1, minutes: 30 })
  assert.deepEqual(durationParts((30 * 60 + 12) * 60_000), { days: 1, hours: 6, minutes: 12 })
})

test('chart ceilings snap to 1/2/5 steps', () => {
  assert.equal(niceCeiling(0), 1)
  assert.equal(niceCeiling(730_000), 1_000_000)
  assert.equal(niceCeiling(180_000), 200_000)
  assert.equal(niceCeiling(4_100), 5_000)
})
