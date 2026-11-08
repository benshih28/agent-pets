import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { installChildProcessGoneLogger, installCrashGuard, runStartupStep, shouldEscalateCrashes } from '../electron/main/crash-guard.ts'

function fakeProcess() {
  return new EventEmitter() as EventEmitter & { off: EventEmitter['off'] }
}

test('installs handlers, logs without throwing, and throttles the user notice', () => {
  const proc = fakeProcess()
  const logs: string[] = []
  let notices = 0
  let clock = 0
  const guard = installCrashGuard({
    proc: proc as never,
    log: (_l, m) => logs.push(m),
    onUserVisibleError: () => { notices += 1 },
    now: () => clock,
  })
  assert.equal(proc.listenerCount('uncaughtException'), 1)
  assert.equal(proc.listenerCount('unhandledRejection'), 1)
  proc.emit('uncaughtException', new Error('boom'))
  proc.emit('unhandledRejection', 'bad')
  assert.equal(logs.length, 2)
  assert.equal(notices, 1)
  clock = 61_000
  proc.emit('unhandledRejection', new Error('again'))
  assert.equal(notices, 2)
  guard.dispose()
  assert.equal(proc.listenerCount('uncaughtException'), 0)
})

test('repeated identical errors are deduplicated and rate limited', () => {
  const proc = fakeProcess()
  const logs: string[] = []
  const guard = installCrashGuard({ proc: proc as never, log: (_l, m) => logs.push(m), now: () => 0, maxLogsPerWindow: 5 })
  for (let i = 0; i < 1000; i += 1) proc.emit('unhandledRejection', new Error('loop'))
  assert.ok(logs.length <= 12, `logged ${logs.length}`)
  assert.ok(guard.stats().suppressed > 900)
  for (let i = 0; i < 50; i += 1) proc.emit('uncaughtException', new Error(`distinct ${i}`))
  assert.ok(logs.length <= 5)
})

test('a throwing log sink or notifier never escapes the handler', () => {
  const proc = fakeProcess()
  installCrashGuard({
    proc: proc as never,
    log: () => { throw new Error('sink') },
    onUserVisibleError: () => { throw new Error('toast') },
  })
  assert.doesNotThrow(() => proc.emit('uncaughtException', new Error('x')))
})

test('startup steps are isolated from each other', async () => {
  const results: Array<{ name: string; ok: boolean }> = []
  const logs: string[] = []
  const log = (_l: string, m: string) => logs.push(m)
  const ran: string[] = []
  await runStartupStep('a', () => { throw new Error('nope') }, log as never, results)
  await runStartupStep('b', async () => { ran.push('b') }, log as never, results)
  assert.deepEqual(results.map(r => r.ok), [false, true])
  assert.deepEqual(ran, ['b'])
  assert.match(logs[0], /startup step "a" failed/)
})

test('child-process-gone is logged', () => {
  const app = new EventEmitter()
  const logs: string[] = []
  installChildProcessGoneLogger(app, (_l, m) => logs.push(m))
  app.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed', exitCode: 9 })
  assert.match(logs[0], /type=GPU reason=crashed/)
})

test('crash escalation policy: 5 distinct errors or 20 repeats inside 2 minutes', () => {
  const at = (signature: string, t: number) => ({ signature, at: t })
  const distinct = ['a', 'b', 'c', 'd'].map((s, i) => at(s, i * 1000))
  assert.equal(shouldEscalateCrashes(distinct, 10_000), false)
  assert.equal(shouldEscalateCrashes([...distinct, at('e', 5000)], 10_000), true)
  // Old occurrences fall out of the window.
  assert.equal(shouldEscalateCrashes([...distinct, at('e', 130_000)], 131_000), false)
  const repeats = Array.from({ length: 20 }, (_, i) => at('same', i * 100))
  assert.equal(shouldEscalateCrashes(repeats.slice(1), 5000), false)
  assert.equal(shouldEscalateCrashes(repeats, 5000), true)
})

test('crash guard escalates at most once per run', () => {
  const handlers: Record<string, (value: unknown) => void> = {}
  const proc = { on: (event: string, listener: (value: unknown) => void) => { handlers[event] = listener } }
  let now = 0
  let escalations = 0
  installCrashGuard({ proc: proc as never, log: () => {}, now: () => now, onEscalate: () => { escalations += 1 } })
  for (let i = 0; i < 12; i += 1) { now += 100; handlers.uncaughtException!(new Error(`boom ${i}`)) }
  assert.equal(escalations, 1)
})
