import assert from 'node:assert/strict'
import test from 'node:test'
import { dndHasExpired, dndRemainingMs, normalizeDndUntil, resolveDndUntil, DND_MAX_DURATION_MS } from '../electron/dnd-schedule.ts'

test('presets resolve relative to now', () => {
  const now = new Date(2026, 0, 5, 23, 50).getTime()
  assert.equal(resolveDndUntil('30m', now), now + 1_800_000)
  assert.equal(resolveDndUntil('1h', now), now + 3_600_000)
  assert.equal(resolveDndUntil('always', now), null)
})

test('"tomorrow" is the next 09:00 local, across midnight and before 09:00', () => {
  const late = new Date(2026, 0, 5, 23, 50).getTime()
  assert.equal(new Date(resolveDndUntil('tomorrow', late)!).getDate(), 6)
  assert.equal(new Date(resolveDndUntil('tomorrow', late)!).getHours(), 9)
  const early = new Date(2026, 0, 5, 7, 0).getTime()
  assert.equal(new Date(resolveDndUntil('tomorrow', early)!).getDate(), 5)
})

test('end times are bounded and only exist while DND is on', () => {
  const now = 1_000_000
  assert.equal(normalizeDndUntil(now + 5_000, true, now), now + 5_000)
  assert.equal(normalizeDndUntil(now + 5_000, false, now), null)
  assert.equal(normalizeDndUntil(now - 1, true, now), null)
  assert.equal(normalizeDndUntil(Number.NaN, true, now), null)
  assert.equal(normalizeDndUntil(now + 10 * DND_MAX_DURATION_MS, true, now), now + DND_MAX_DURATION_MS)
})

test('expiry and remaining time', () => {
  assert.equal(dndHasExpired(true, 100, 100), true)
  assert.equal(dndHasExpired(true, null, 100), false)
  assert.equal(dndHasExpired(false, 50, 100), false)
  assert.equal(dndRemainingMs(true, 600, 100), 500)
  assert.equal(dndRemainingMs(true, null, 100), null)
})
