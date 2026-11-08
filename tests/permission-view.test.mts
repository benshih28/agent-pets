import assert from 'node:assert/strict'
import test from 'node:test'
import {
  classifyDecideResponse,
  formatDuration,
  inferVanishedOutcome,
} from '../src/utils/permission-view.ts'

test('only a delivered decision is reported as success', () => {
  assert.deepEqual(classifyDecideResponse({ ok: true, status: 'allowed' }), { ok: true, status: 'allowed' })
  assert.deepEqual(classifyDecideResponse({ ok: true, status: 'denied' }), { ok: true, status: 'denied' })
})

test('delivery failure, expiry and external resolution are not success', () => {
  assert.deepEqual(classifyDecideResponse({ ok: true, status: 'delivery_failed' }), { ok: false, kind: 'delivery_failed' })
  assert.deepEqual(classifyDecideResponse({ ok: true, status: 'cancelled' }), { ok: false, kind: 'cancelled' })
  assert.deepEqual(classifyDecideResponse({ ok: false, error: 'conflict', status: 'expired' }), { ok: false, kind: 'expired' })
  assert.deepEqual(classifyDecideResponse({ ok: false, error: 'conflict', status: 'allowed' }), { ok: false, kind: 'cancelled' })
  assert.deepEqual(classifyDecideResponse({ ok: false, error: 'conflict' }), { ok: false, kind: 'conflict' })
})

test('missing or malformed responses are errors, never success', () => {
  assert.deepEqual(classifyDecideResponse(undefined), { ok: false, kind: 'error' })
  assert.deepEqual(classifyDecideResponse({ ok: false, error: 'not_found' }), { ok: false, kind: 'error' })
  assert.deepEqual(classifyDecideResponse({ ok: true }), { ok: false, kind: 'error' })
})

test('vanished requests are told apart by their deadline', () => {
  assert.equal(inferVanishedOutcome({ expiresAt: 10_000 }, 10_100), 'expired')
  assert.equal(inferVanishedOutcome({ expiresAt: 10_000 }, 9_000), 'expired')
  assert.equal(inferVanishedOutcome({ expiresAt: 10_000 }, 4_000), 'cancelled')
})

test('durations are m:ss and never negative', () => {
  assert.equal(formatDuration(83_400), '1:24')
  assert.equal(formatDuration(42_000), '0:42')
  assert.equal(formatDuration(-5), '0:00')
  assert.equal(formatDuration(Number.NaN), '0:00')
})

test('click guard keeps buttons inert for 300ms', async () => {
  const { isPermissionClickArmed } = await import('../src/utils/permission-view.ts')
  assert.equal(isPermissionClickArmed(1_000, 1_299), false)
  assert.equal(isPermissionClickArmed(1_000, 1_300), true)
})

test('consecutive identical requests of one session fold, others do not', async () => {
  const { groupPermissionRequests } = await import('../src/utils/permission-view.ts')
  const make = (requestId: string, over: Record<string, unknown> = {}) => ({
    requestId, agentId: 'opencode-cli', sessionId: 's1', action: 'read', description: 'a.ts', details: [], ...over,
  }) as never
  const groups = groupPermissionRequests([
    make('1'), make('2'), make('3', { sessionId: 's2' }), make('4', { description: 'b.ts' }), make('5', { description: 'b.ts' }),
  ])
  assert.deepEqual(groups.map((g) => g.requestIds), [['1', '2'], ['3'], ['4', '5']])
  assert.deepEqual(groups.map((g) => g.count), [2, 1, 2])
})
