import assert from 'node:assert/strict'
import test from 'node:test'
import {
  effectivePluginScheduleInterval,
  effectivePluginScheduleMinimum,
} from '../electron/plugin-schedule.ts'

test('schedule minimum uses the larger manifest and user preference values', () => {
  assert.equal(effectivePluginScheduleMinimum(30, 60), 60)
  assert.equal(effectivePluginScheduleMinimum(300, 60), 300)
})

test('schedule.every raises short intervals, rounds fractional seconds, and rejects invalid values', () => {
  assert.equal(effectivePluginScheduleInterval(1, 60), 60)
  assert.equal(effectivePluginScheduleInterval(60.2, 60), 61)
  for (const value of [0, -1, Infinity, Number.MAX_VALUE, '60']) {
    assert.throws(() => effectivePluginScheduleInterval(value, 60), { code: 'schedule_invalid' })
  }
  assert.throws(() => effectivePluginScheduleMinimum(20, 60), { code: 'schedule_invalid' })
})
