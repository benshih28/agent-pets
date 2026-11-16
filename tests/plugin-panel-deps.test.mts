// panel-deps：各 plugin composable 共用的忙碌範圍、refresh 協調與競態守衛。
import './support/src-alias.mts'
import assert from 'node:assert/strict'
import test from 'node:test'

const { createBusyScopes, createCoalescedRefresh, createLatestRequest, createPluginPanelFeedback, createQueuedRefresh, pluginScope } =
  await import('../src/composables/plugin/panel-deps.ts')

const settle = () => new Promise<void>(resolve => setImmediate(resolve))

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(yes => { resolve = yes })
  return { promise, resolve }
}

test('busy scopes count nested work and global work locks every plugin', () => {
  const scopes = createBusyScopes()
  scopes.setBusy(pluginScope('a'), true)
  scopes.setBusy(pluginScope('a'), true)
  assert.equal(scopes.busy.value, false)
  assert.equal(scopes.pluginBusy('a'), true)
  assert.equal(scopes.pluginBusy('b'), false)
  scopes.setBusy(pluginScope('a'), false)
  assert.equal(scopes.isBusy('plugin:a'), true)
  scopes.setBusy(pluginScope('a'), false)
  assert.equal(scopes.isBusy('plugin:a'), false)
  scopes.setBusy('global', true)
  assert.equal(scopes.busy.value, true)
  assert.equal(scopes.pluginBusy('b'), true)
})

test('a queued refresh returns at once and runs one trailing pass with the trailing options', async () => {
  const runs: Array<{ options: unknown; gate: ReturnType<typeof deferred> }> = []
  const refresh = createQueuedRefresh<{ silent?: boolean }>(options => {
    const gate = deferred()
    runs.push({ options, gate })
    return gate.promise
  }, { silent: true })
  const first = refresh()
  await refresh({ silent: false })
  await refresh()
  assert.equal(runs.length, 1)
  runs[0].gate.resolve()
  await first
  assert.equal(runs.length, 2)
  assert.deepEqual(runs[1].options, { silent: true })
  runs[1].gate.resolve()
})

test('coalesced refreshes keep one request in flight and resolve callers after the newest run', async () => {
  const gates: Array<ReturnType<typeof deferred>> = []
  const order: string[] = []
  const refresh = createCoalescedRefresh(async () => {
    const gate = deferred()
    gates.push(gate)
    await gate.promise
    order.push(`run-${gates.length}`)
  })
  const first = refresh()
  const second = refresh()
  const third = refresh()
  assert.equal(second, third)
  assert.equal(gates.length, 1)
  gates[0].resolve()
  await first
  await settle()
  assert.equal(gates.length, 2)
  let thirdDone = false
  void third.then(() => { thirdDone = true })
  await settle()
  assert.equal(thirdDone, false)
  gates[1].resolve()
  await third
  assert.deepEqual(order, ['run-1', 'run-2'])
})

test('a failed run does not block the trailing refresh', async () => {
  let calls = 0
  const refresh = createCoalescedRefresh(async () => {
    calls += 1
    if (calls === 1) throw new Error('boom')
  })
  const first = refresh()
  const second = refresh()
  await assert.rejects(first)
  await second
  assert.equal(calls, 2)
})

test('the latest-request guard rejects older and invalidated requests', () => {
  const guard = createLatestRequest()
  const first = guard.next()
  const second = guard.next()
  assert.equal(guard.isCurrent(first), false)
  assert.equal(guard.isCurrent(second), true)
  assert.equal(guard.current(), second)
  guard.invalidate()
  assert.equal(guard.isCurrent(second), false)
})

test('errors carry only the code and an optional sanitized hint, never other input', () => {
  const sent: unknown[] = []
  const feedback = createPluginPanelFeedback(input => { sent.push(input); return sent.length }, () => 7)
  feedback.setError('secret_unavailable')
  feedback.setError('too_many_enabled', () => {}, 'hint')
  feedback.setStatus('ok')
  assert.deepEqual(sent.map(item => (item as { detail?: string }).detail), ['secret_unavailable', 'too_many_enabled: hint', undefined])
  assert.match((sent[1] as { text: string }).text, /7/)
  assert.ok((sent[1] as { action?: unknown }).action)
  assert.equal(feedback.localizedError('__proto__'), feedback.localizedError('unknown_code'))
})
