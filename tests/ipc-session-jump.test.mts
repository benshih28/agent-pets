import assert from 'node:assert/strict'
import test from 'node:test'
import { IPC_CHANNELS } from '../electron/ipc/channels.ts'
import { registerSessionJumpIpc } from '../electron/ipc/session-jump.ts'

function setup() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const runs: unknown[] = []
  const senders: unknown[] = []
  registerSessionJumpIpc({
    ipcMain: { handle: (channel, handler) => { handlers.set(channel, handler) } },
    assertTrustedIpcSender: event => {
      senders.push(event)
      if ((event as { untrusted?: boolean }).untrusted) throw new Error('Unauthorized IPC sender')
    },
    runSessionJump: async (action, key) => { runs.push([action, key]); return { ok: true } },
  })
  return { handler: handlers.get(IPC_CHANNELS.sessionJump)!, handlers, runs, senders }
}

test('session jump IPC checks the sender, then passes a validated action and session key', async () => {
  const { handler, handlers, runs, senders } = setup()
  assert.deepEqual([...handlers.keys()], [IPC_CHANNELS.sessionJump])
  assert.deepEqual(await handler({}, { action: 'switch-app', source: 'claude', sessionId: 'abc' }), { ok: true })
  assert.deepEqual(runs, [['switch-app', 'claude:abc']])
  assert.equal(senders.length, 1)
  await assert.rejects(async () => handler({ untrusted: true }, { action: 'copy-path', source: 'claude', sessionId: 'abc' }))
  assert.equal(runs.length, 1)
})

test('session jump IPC rejects malformed payloads without running anything', async () => {
  const { handler, runs } = setup()
  const invalid: unknown[] = [
    undefined,
    null,
    'switch-app',
    [],
    { action: 'run-command', source: 'claude', sessionId: 'abc' },
    { action: 'open-folder', source: 'claude', sessionId: 'abc' },
    { action: 'show-folder', source: 'not-a-source', sessionId: 'abc' },
    { action: 'show-folder', source: 'claude', sessionId: '' },
    { action: 'show-folder', source: 'claude', sessionId: 'x'.repeat(257) },
    { action: 'show-folder', source: 'claude', sessionId: 42 },
    // The renderer may not supply a path or bundle id.
    { action: 'show-folder', source: 'claude', sessionId: 'abc', path: '/Applications/Calculator.app' },
    { action: 'switch-app', source: 'claude', sessionId: 'abc', bundleId: 'com.apple.Terminal' },
  ]
  for (const payload of invalid) {
    assert.deepEqual(await handler({}, payload), { ok: false, error: 'invalid_request' }, JSON.stringify(payload))
  }
  assert.deepEqual(runs, [])
})
