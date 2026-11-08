import assert from 'node:assert/strict'
import test from 'node:test'
import { displayPercent, etaDaysToLevel, isAlmostLevelUp, streakAtRisk, xpRemaining } from '../src/utils/growth-math.ts'
import { dateOffset, previousLocalDate } from '../src/utils/local-date.ts'

test('remaining XP and bar width follow xpToNext - xpIntoLevel', () => {
  assert.equal(xpRemaining(64, 100), 36)
  assert.equal(xpRemaining(120, 100), 0)
  assert.equal(displayPercent(0, 100), 0)
  assert.equal(displayPercent(1, 100), 2)
  assert.equal(displayPercent(64, 100), 64)
  assert.equal(isAlmostLevelUp(95, 100), true)
  assert.equal(isAlmostLevelUp(50, 100), false)
})

test('streak risk only when the last active day was yesterday', () => {
  assert.equal(streakAtRisk('2026-03-08', '2026-03-09', 4), true)
  assert.equal(streakAtRisk('2026-03-09', '2026-03-09', 4), false)
  assert.equal(streakAtRisk('2026-03-01', '2026-03-09', 4), false)
  assert.equal(streakAtRisk('2026-03-08', '2026-03-09', 0), false)
})

test('date helpers cross month and year boundaries', () => {
  assert.equal(previousLocalDate('2026-03-01'), '2026-02-28')
  assert.equal(previousLocalDate('2026-01-01'), '2025-12-31')
  assert.equal(dateOffset('2026-03-08', 2), '2026-03-10')
})

test('evolution ETA needs a pace and rounds up', () => {
  assert.equal(etaDaysToLevel(0, 5, null), null)
  assert.equal(etaDaysToLevel(500, 5, 50), 1)
  assert.equal(etaDaysToLevel(0, 5, 100), 6)
})
