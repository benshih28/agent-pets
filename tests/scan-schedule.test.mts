import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldRunLocalUsageTick } from '../electron/main/scan-schedule.ts'

test('local usage scan runs every tick on AC and every fifth tick on battery', () => {
  assert.deepEqual([1, 2, 3].map(tick => shouldRunLocalUsageTick(tick, false)), [true, true, true])
  assert.deepEqual([1, 2, 3, 4, 5, 10].map(tick => shouldRunLocalUsageTick(tick, true)), [false, false, false, false, true, true])
})

test('a budget-limited scan catches up soon on AC and waits for the regular tick on battery', async () => {
  const { localUsageCatchUpDelayMs, LOCAL_USAGE_CATCH_UP_DELAY_MS, LOCAL_USAGE_TICK_MS } = await import('../electron/main/scan-schedule.ts')
  assert.equal(localUsageCatchUpDelayMs(true, false), LOCAL_USAGE_CATCH_UP_DELAY_MS)
  assert.ok(LOCAL_USAGE_CATCH_UP_DELAY_MS < LOCAL_USAGE_TICK_MS)
  assert.equal(localUsageCatchUpDelayMs(true, true), null)
  assert.equal(localUsageCatchUpDelayMs(false, false), null)
})

test('catch-up stops after consecutive scans that read nothing', async () => {
  const { localUsageCatchUpDelayMs, LOCAL_USAGE_MAX_STALLED_CATCH_UPS } = await import('../electron/main/scan-schedule.ts')
  assert.notEqual(localUsageCatchUpDelayMs(true, false, LOCAL_USAGE_MAX_STALLED_CATCH_UPS - 1), null)
  assert.equal(localUsageCatchUpDelayMs(true, false, LOCAL_USAGE_MAX_STALLED_CATCH_UPS), null)
})
