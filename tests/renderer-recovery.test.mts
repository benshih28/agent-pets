import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { attachRendererRecovery } from '../electron/main/renderer-recovery.ts'

function setup(overrides: Record<string, unknown> = {}) {
  const contents = Object.assign(new EventEmitter(), { isDestroyed: () => false })
  const timers: Array<{ cb: () => void; delay: number; cleared: boolean }> = []
  let clock = 0
  const reloads: number[] = []
  const logs: string[] = []
  const gaveUp: string[] = []
  const recovered: string[] = []
  const recovery = attachRendererRecovery(contents as never, {
    label: 'pet',
    reload: () => reloads.push(clock),
    log: (_l, m) => logs.push(m),
    onGaveUp: l => gaveUp.push(l),
    onRecovered: l => recovered.push(l),
    now: () => clock,
    setTimer: (cb, delay) => { const t = { cb, delay, cleared: false }; timers.push(t); return t },
    clearTimer: h => { (h as { cleared: boolean }).cleared = true },
    ...overrides,
  })
  const fire = () => { const t = timers.find(x => !x.cleared); assert.ok(t); t.cleared = true; t.cb() }
  return { contents, recovery, reloads, logs, gaveUp, recovered, fire, timers, tick: (ms: number) => { clock += ms } }
}

test('reloads with backoff and gives up after the budget', () => {
  const ctx = setup()
  for (let i = 0; i < 3; i += 1) {
    ctx.contents.emit('render-process-gone', {}, { reason: 'crashed' })
    ctx.fire()
  }
  assert.equal(ctx.reloads.length, 3)
  assert.deepEqual(ctx.timers.map(t => t.delay), [250, 1000, 3000])
  ctx.contents.emit('render-process-gone', {}, { reason: 'oom' })
  assert.deepEqual(ctx.gaveUp, ['pet'])
  assert.equal(ctx.recovery.state().gaveUp, true)
  assert.equal(ctx.reloads.length, 3)
})

test('budget refills after the window and clean exits are ignored', () => {
  const ctx = setup()
  ctx.contents.emit('render-process-gone', {}, { reason: 'clean-exit' })
  assert.equal(ctx.timers.length, 0)
  for (let i = 0; i < 3; i += 1) { ctx.contents.emit('render-process-gone', {}, { reason: 'crashed' }); ctx.fire() }
  ctx.tick(6 * 60_000)
  ctx.contents.emit('render-process-gone', {}, { reason: 'crashed' })
  ctx.fire()
  assert.equal(ctx.reloads.length, 4)
  assert.equal(ctx.gaveUp.length, 0)
})

test('did-fail-load ignores ERR_ABORTED and sub-frames, and resync fires after recovery', () => {
  const ctx = setup()
  ctx.contents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'x', true)
  ctx.contents.emit('did-fail-load', {}, -105, 'NAME', 'x', false)
  assert.equal(ctx.timers.length, 0)
  ctx.contents.emit('did-fail-load', {}, -102, 'REFUSED', 'x', true)
  ctx.fire()
  assert.equal(ctx.reloads.length, 1)
  ctx.contents.emit('did-finish-load')
  assert.deepEqual(ctx.recovered, ['pet'])
  ctx.contents.emit('did-finish-load')
  assert.equal(ctx.recovered.length, 1)
})

test('unresponsive reloads only after the grace period and responsive cancels it', () => {
  const ctx = setup()
  ctx.contents.emit('unresponsive')
  ctx.contents.emit('responsive')
  assert.equal(ctx.timers.filter(t => !t.cleared).length, 0)
  ctx.contents.emit('unresponsive')
  ctx.fire()
  ctx.fire()
  assert.equal(ctx.reloads.length, 1)
})

test('manualReload resets a given-up state and dispose removes listeners', () => {
  const ctx = setup({ maxReloads: 0 })
  ctx.contents.emit('render-process-gone', {}, { reason: 'crashed' })
  assert.equal(ctx.recovery.state().gaveUp, true)
  ctx.recovery.manualReload()
  assert.equal(ctx.recovery.state().gaveUp, false)
  assert.equal(ctx.reloads.length, 1)
  ctx.recovery.dispose()
  assert.equal(ctx.contents.listenerCount('render-process-gone'), 0)
})
