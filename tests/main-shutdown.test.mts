import test from 'node:test'
import assert from 'node:assert/strict'
import { createShutdownCoordinator } from '../electron/main/shutdown.ts'
import { MAIN_STATE_TIMER_KEYS, disposeMainTimers } from '../electron/main/dispose-timers.ts'
import { readFileSync } from 'node:fs'

function harness(pending: Promise<unknown> | null) {
  const order: string[] = []
  const timers: Array<() => void> = []
  let prevented = 0
  const coordinator = createShutdownCoordinator({
    flush: () => order.push('flush'),
    pendingWork: () => pending,
    teardown: () => order.push('teardown'),
    quit: () => order.push('quit'),
    setTimer: cb => { timers.push(cb); return timers.length },
    clearTimer: () => {},
  })
  return { order, timers, coordinator, event: { preventDefault: () => { prevented += 1 } }, prevented: () => prevented }
}

test('flush runs before teardown, with no waiting when idle', () => {
  const h = harness(null)
  h.coordinator.onBeforeQuit(h.event)
  assert.deepEqual(h.order, ['flush', 'teardown'])
  assert.equal(h.prevented(), 0)
  h.coordinator.onBeforeQuit(h.event)
  assert.deepEqual(h.order, ['flush', 'teardown'])
})

test('in-flight work is awaited before teardown, then quit is re-issued', async () => {
  let release!: () => void
  const h = harness(new Promise<void>(resolve => { release = resolve }))
  h.coordinator.onBeforeQuit(h.event)
  h.coordinator.onBeforeQuit(h.event)
  assert.equal(h.prevented(), 2)
  assert.deepEqual(h.order, ['flush'])
  release()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(h.order, ['flush', 'teardown', 'quit'])
})

test('a hung scan is abandoned after the timeout', () => {
  const h = harness(new Promise(() => {}))
  h.coordinator.onBeforeQuit(h.event)
  h.timers[0]()
  assert.deepEqual(h.order, ['flush', 'teardown', 'quit'])
})

test('runNow covers app.exit paths and is idempotent', () => {
  const h = harness(null)
  h.coordinator.runNow()
  h.coordinator.runNow()
  assert.deepEqual(h.order, ['flush', 'teardown'])
})

test('disposeMainTimers clears every timer handle', () => {
  const state: Record<string, unknown> = {}
  for (const key of MAIN_STATE_TIMER_KEYS) state[key] = setTimeout(() => {}, 60_000)
  disposeMainTimers(state as never)
  for (const key of MAIN_STATE_TIMER_KEYS) assert.equal(state[key], null, key)
})

test('every timer handle declared in mainState is covered by disposeMainTimers', () => {
  const source = readFileSync(new URL('../electron/main/state.ts', import.meta.url), 'utf8')
  const declared = [...source.matchAll(/^\s+(\w+): null as ReturnType<typeof set(?:Timeout|Interval)> \| null,$/gm)].map(match => match[1])
  assert.ok(declared.length >= 10)
  for (const key of declared) assert.ok((MAIN_STATE_TIMER_KEYS as readonly string[]).includes(key), `${key} is not disposed at quit`)
})
