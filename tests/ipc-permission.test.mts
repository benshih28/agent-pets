import assert from 'node:assert/strict'
import test from 'node:test'
import { IPC_CHANNELS } from '../electron/ipc/channels.ts'
import { registerPermissionIpc } from '../electron/ipc/permission.ts'

test('permission IPC keeps request decisions bounded and sender-scoped', async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const trusted: Array<{ event: unknown; window: unknown }> = []
  const decisions: unknown[][] = []
  const petWindow = { id: 'pet', isDestroyed: () => false, webContents: { id: 'pet-contents' } }
  const panelWindow = { id: 'panel', isDestroyed: () => false, webContents: { id: 'panel-contents' } }
  let audit: unknown[] = [{ action: 'bash' }]
  let brokerAvailable = true
  const broker = {
    listRequests: () => [{ requestId: 'request-a' }],
    decide: (...args: unknown[]) => { decisions.push(args); return { ok: true } },
  }

  registerPermissionIpc({
    ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler) },
    assertTrustedIpcSender: (event: unknown, window: unknown) => trusted.push({ event, window }),
    getPetWindow: () => petWindow,
    getPanelWindow: () => panelWindow,
    listAudit: () => audit,
    clearAudit: () => { audit = [] },
    getPermissionBroker: () => brokerAvailable ? broker : null,
  })
  const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)?.({ sender: petWindow.webContents }, ...args)
  const invokeFromPanel = (channel: string, ...args: unknown[]) => handlers.get(channel)?.({ sender: panelWindow.webContents }, ...args)

  assert.deepEqual([...handlers.keys()], [
    IPC_CHANNELS.permissionRequestsInit,
    IPC_CHANNELS.permissionDecide,
    IPC_CHANNELS.permissionAuditList,
    IPC_CHANNELS.permissionAuditClear,
  ])
  assert.deepEqual(await invoke(IPC_CHANNELS.permissionRequestsInit), [{ requestId: 'request-a' }])
  assert.deepEqual(await invoke(IPC_CHANNELS.permissionDecide, null), { ok: false, error: 'invalid_decision' })
  assert.deepEqual(await invoke(IPC_CHANNELS.permissionDecide, { requestId: 'request-a', decision: 'allow' }), { ok: false, error: 'invalid_decision' })
  assert.deepEqual(await invoke(IPC_CHANNELS.permissionDecide, { requestId: 'request-a', decision: 'allow_once' }), { ok: true })
  assert.deepEqual(await invokeFromPanel(IPC_CHANNELS.permissionDecide, { requestId: 'request-b', decision: 'deny', via: 'bubble' }), { ok: true })
  assert.deepEqual(decisions, [['request-a', 'allow_once', 'bubble'], ['request-b', 'deny', 'panel']])
  await assert.rejects(async () => handlers.get(IPC_CHANNELS.permissionDecide)?.({ sender: { id: 'other' } }, { requestId: 'x', decision: 'deny' }))
  brokerAvailable = false
  assert.deepEqual(await invoke(IPC_CHANNELS.permissionDecide, { requestId: 'request-a', decision: 'deny' }), { ok: false, error: 'not_found' })

  assert.deepEqual(await invokeFromPanel(IPC_CHANNELS.permissionAuditList), [{ action: 'bash' }])
  assert.deepEqual(await invokeFromPanel(IPC_CHANNELS.permissionAuditClear), { ok: true })
  assert.deepEqual(await invokeFromPanel(IPC_CHANNELS.permissionAuditList), [])
  // Audit access is panel-only.
  const auditChecks = trusted.filter(entry => entry.window === panelWindow)
  assert.equal(auditChecks.length, 3)
})
