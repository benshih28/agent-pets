import test from 'node:test'
import assert from 'node:assert/strict'
import { createEventRateLimiter } from '../electron/event-rate-limit.ts'

test('a runaway session cannot starve other sessions or terminal events', () => {
  let clock = 0
  const limiter = createEventRateLimiter({ now: () => clock, perSessionLimit: 3, terminalPerSessionLimit: 2 })
  const results = [1, 2, 3, 4].map(() => limiter.allowEvent('codex:loop', false))
  assert.deepEqual(results, [true, true, true, false])
  assert.equal(limiter.allowEvent('codex:other', false), true)
  assert.equal(limiter.allowEvent('codex:loop', true), true)
  assert.equal(limiter.allowEvent('codex:loop', true), true)
  assert.equal(limiter.allowEvent('codex:loop', true), false)
  clock = 10_001
  assert.equal(limiter.allowEvent('codex:loop', false), true)
})

test('global request ceiling resets each window', () => {
  let clock = 0
  const limiter = createEventRateLimiter({ now: () => clock, globalLimit: 2 })
  assert.deepEqual([limiter.allowRequest(), limiter.allowRequest(), limiter.allowRequest()], [true, true, false])
  clock = 10_000
  assert.equal(limiter.allowRequest(), true)
})

test('a full tracking table fails closed with a shared overflow bucket', () => {
  const limiter = createEventRateLimiter({ now: () => 0, perSessionLimit: 2, maxTrackedSessions: 2, terminalPerSessionLimit: 1 })
  assert.equal(limiter.allowEvent('a', false), true)
  assert.equal(limiter.allowEvent('b', false), true)
  // Unknown sessions now share one bucket instead of each getting a free pass.
  assert.deepEqual(['c', 'd', 'e', 'f'].map(key => limiter.allowEvent(key, false)), [true, true, false, false])
  assert.deepEqual(['x', 'y'].map(key => limiter.allowEvent(key, true)), [true, false])
})

test('rotating session ids cannot exceed the global event budget', () => {
  let clock = 0
  const limiter = createEventRateLimiter({ now: () => clock, globalEventLimit: 5, globalTerminalLimit: 2 })
  const normal = Array.from({ length: 8 }, (_, index) => limiter.allowEvent(`rot-${index}`, false))
  assert.deepEqual(normal, [true, true, true, true, true, false, false, false])
  const terminal = Array.from({ length: 4 }, (_, index) => limiter.allowEvent(`t-${index}`, true))
  assert.deepEqual(terminal, [true, true, false, false])
  clock = 10_000
  assert.equal(limiter.allowEvent('fresh', false), true)
})
