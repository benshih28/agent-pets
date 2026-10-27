import assert from 'node:assert/strict'
import test from 'node:test'
import { PluginEventSourceController } from '../electron/plugin-event-source.ts'
import { isCurrentPluginRuntimeToken, runPluginRpcForCurrentToken } from '../electron/plugin-host-token.ts'

test('plugin runtime RPC accepts only the current nonempty activation token', () => {
  assert.equal(isCurrentPluginRuntimeToken('current', 'current'), true)
  assert.equal(isCurrentPluginRuntimeToken('current', 'stale'), false)
  assert.equal(isCurrentPluginRuntimeToken(null, 'current'), false)
  assert.equal(isCurrentPluginRuntimeToken('', ''), false)
})

test('queued plugin RPC is dropped after its runtime token is revoked or replaced', async () => {
  let activeToken: string | null = 'runtime-1'
  let calls = 0
  const queued = runPluginRpcForCurrentToken(() => activeToken, 'runtime-1', () => {
    calls += 1
    return { accepted: true }
  })
  activeToken = 'runtime-2'
  assert.deepEqual(await queued, { current: false })
  assert.equal(calls, 0)
})

test('a queued eventSource RPC cannot restore cleared status after runtime cleanup', async () => {
  let activeToken: string | null = 'runtime-1'
  const controller = new PluginEventSourceController({
    getContext: () => ({
      enabled: true,
      pluginsEnabled: true,
      pluginName: { 'zh-TW': '測試插件', 'en-US': 'Test plugin' },
      family: 'test-status',
      displayName: { 'zh-TW': '測試狀態', 'en-US': 'Test status' },
    }),
    onChanged: () => {},
    schedule: () => 1 as unknown as ReturnType<typeof setTimeout>,
    cancel: () => {},
  })
  const queued = runPluginRpcForCurrentToken(() => activeToken, 'runtime-1', () => (
    controller.emit('status-fixture', { sessionId: 'queued', state: 'thinking' })
  ))
  activeToken = null
  controller.clearPlugin('status-fixture')
  assert.deepEqual(await queued, { current: false })
  assert.deepEqual(controller.list(), [])
  controller.destroy()
})

test('plugin RPC result is discarded when its runtime is revoked while awaiting the host API', async () => {
  let activeToken: string | null = 'runtime-1'
  let resolveWork: ((value: unknown) => void) | null = null
  const dispatch = runPluginRpcForCurrentToken(() => activeToken, 'runtime-1', () => new Promise(resolve => {
    resolveWork = resolve
  }))
  await Promise.resolve()
  await Promise.resolve()
  activeToken = null
  resolveWork?.({ accepted: true })
  assert.deepEqual(await dispatch, { current: false })
})
