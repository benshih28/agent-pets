import assert from 'node:assert/strict'
import test from 'node:test'
import { IPC_CHANNELS } from '../electron/ipc/channels.ts'
import { registerPermissionIpc } from '../electron/ipc/permission.ts'
import type { PermissionBroker } from '../electron/permission-broker.ts'
import type { PermissionAuditEntry, PermissionRequestView } from '../src/types/permission.ts'
import { fakeBrowserWindow, fakeIpcMainInvokeEvent, fakeWebContents } from './support/fake-electron.mts'
import { fakeService } from './support/fake-service.mts'
import { createFakeIpcMain } from './support/fake-ipc.mts'

const requestView: PermissionRequestView = {
  requestId: 'request-a', adapterId: 'claude-code', agentId: 'agent-a', sessionId: 'session-a', generation: 1,
  action: 'Bash', description: '', details: [], truncatedChars: 0, risk: 'low', network: false, receivedAt: 0, expiresAt: 1,
  status: 'pending', allowedDecisions: ['allow_once', 'deny'], queuePosition: 1, queueSize: 1, hotkeyEligible: false, truncated: false,
}
const auditEntry: PermissionAuditEntry = { resolvedAt: 0, agentId: 'agent-a', action: 'bash', risk: 'low', status: 'allowed', terminalReason: 'allowed' }

test('permission IPC keeps request decisions bounded and sender-scoped', async () => {
  const { ipcMain, handlers } = createFakeIpcMain()
  const trusted: Array<{ event: unknown; window: unknown }> = []
  const decisions: unknown[][] = []
  const petContents = fakeWebContents()
  const panelContents = fakeWebContents()
  const petWindow = fakeBrowserWindow({ isDestroyed: () => false, webContents: petContents })
  const panelWindow = fakeBrowserWindow({ isDestroyed: () => false, webContents: panelContents })
  let audit: PermissionAuditEntry[] = [auditEntry]
  let brokerAvailable = true
  // PermissionBroker 內有計時器與佇列狀態，IPC 層只呼叫這兩個方法，所以只實作它們。
  const broker = {
    listRequests: () => [requestView],
    decide: async (...args: unknown[]) => { decisions.push(args); return { ok: true as const, status: 'allowed' as const } },
  }

  registerPermissionIpc({
    ipcMain,
    assertTrustedIpcSender: (event: unknown, window: unknown) => trusted.push({ event, window }),
    getPetWindow: () => petWindow,
    getPanelWindow: () => panelWindow,
    listAudit: () => audit,
    clearAudit: () => { audit = [] },
    getPermissionBroker: () => brokerAvailable ? fakeService<PermissionBroker>(broker) : null,
  })
  const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)?.(fakeIpcMainInvokeEvent({ sender: petContents }), ...args)
  const invokeFromPanel = (channel: string, ...args: unknown[]) => handlers.get(channel)?.(fakeIpcMainInvokeEvent({ sender: panelContents }), ...args)

  assert.deepEqual([...handlers.keys()], [
    IPC_CHANNELS.permissionRequestsInit,
    IPC_CHANNELS.permissionDecide,
    IPC_CHANNELS.permissionAuditList,
    IPC_CHANNELS.permissionAuditClear,
  ])
  assert.deepEqual(await invoke(IPC_CHANNELS.permissionRequestsInit), [requestView])
  assert.deepEqual(await invoke(IPC_CHANNELS.permissionDecide, null), { ok: false, error: 'invalid_decision' })
  assert.deepEqual(await invoke(IPC_CHANNELS.permissionDecide, { requestId: 'request-a', decision: 'allow' }), { ok: false, error: 'invalid_decision' })
  assert.deepEqual(await invoke(IPC_CHANNELS.permissionDecide, { requestId: 'request-a', decision: 'allow_once' }), { ok: true, status: 'allowed' })
  assert.deepEqual(await invokeFromPanel(IPC_CHANNELS.permissionDecide, { requestId: 'request-b', decision: 'deny', via: 'bubble' }), { ok: true, status: 'allowed' })
  assert.deepEqual(decisions, [['request-a', 'allow_once', 'bubble'], ['request-b', 'deny', 'panel']])
  await assert.rejects(async () => handlers.get(IPC_CHANNELS.permissionDecide)?.(fakeIpcMainInvokeEvent({ sender: fakeWebContents() }), { requestId: 'x', decision: 'deny' }))
  brokerAvailable = false
  assert.deepEqual(await invoke(IPC_CHANNELS.permissionDecide, { requestId: 'request-a', decision: 'deny' }), { ok: false, error: 'not_found' })

  assert.deepEqual(await invokeFromPanel(IPC_CHANNELS.permissionAuditList), [auditEntry])
  assert.deepEqual(await invokeFromPanel(IPC_CHANNELS.permissionAuditClear), { ok: true })
  assert.deepEqual(await invokeFromPanel(IPC_CHANNELS.permissionAuditList), [])
  // Audit access is panel-only.
  const auditChecks = trusted.filter(entry => entry.window === panelWindow)
  assert.equal(auditChecks.length, 3)
})
