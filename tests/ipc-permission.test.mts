import assert from 'node:assert/strict'
import test from 'node:test'
import { IPC_CHANNELS } from '../electron/ipc/channels.ts'
import { registerPermissionIpc } from '../electron/ipc/permission.ts'

test('permission IPC keeps request decisions bounded and sender-scoped', async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const trusted: Array<{ event: unknown; window: unknown }> = []
  const decisions: unknown[][] = []
  const petWindow = { id: 'pet' }
  let brokerAvailable = true
  const broker = {
    listRequests: () => [{ requestId: 'request-a' }],
    decide: (...args: unknown[]) => { decisions.push(args); return { ok: true } },
  }

  registerPermissionIpc({
    ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler) },
    assertTrustedIpcSender: (event: unknown, window: unknown) => trusted.push({ event, window }),
    getPetWindow: () => petWindow,
    getPermissionBroker: () => brokerAvailable ? broker : null,
  })
  const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)?.({}, ...args)

  assert.deepEqual([...handlers.keys()], [IPC_CHANNELS.permissionRequestsInit, IPC_CHANNELS.permissionDecide])
  assert.deepEqual(await invoke(IPC_CHANNELS.permissionRequestsInit), [{ requestId: 'request-a' }])
  assert.deepEqual(await invoke(IPC_CHANNELS.permissionDecide, null), { ok: false, error: 'invalid_decision' })
  assert.deepEqual(await invoke(IPC_CHANNELS.permissionDecide, { requestId: 'request-a', decision: 'allow' }), { ok: false, error: 'invalid_decision' })
  assert.deepEqual(await invoke(IPC_CHANNELS.permissionDecide, { requestId: 'request-a', decision: 'allow_once' }), { ok: true })
  assert.deepEqual(decisions, [['request-a', 'allow_once', 'bubble']])
  brokerAvailable = false
  assert.deepEqual(await invoke(IPC_CHANNELS.permissionDecide, { requestId: 'request-a', decision: 'deny' }), { ok: false, error: 'not_found' })
  assert.equal(trusted.filter(entry => entry.window === petWindow).length, 4)
  assert.equal(trusted.length, 5)
})
