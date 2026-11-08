import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import type { PermissionBroker } from '../permission-broker'
import type { PermissionAuditEntry } from '../../src/types/permission'
import { IPC_CHANNELS } from './channels.ts'

export interface PermissionIpcDependencies {
  ipcMain: Pick<IpcMain, 'handle'>
  assertTrustedIpcSender(event: IpcMainInvokeEvent, requiredWindow?: BrowserWindow | null): void
  getPetWindow(): BrowserWindow | null
  getPanelWindow(): BrowserWindow | null
  getPermissionBroker(): PermissionBroker | null
  /** Newest-last audit entries, already reduced to the fields the UI may show. */
  listAudit(limit: number): PermissionAuditEntry[]
  clearAudit(): void
}

const AUDIT_LIST_LIMIT = 50

export function registerPermissionIpc(deps: PermissionIpcDependencies): void {
  deps.ipcMain.handle(IPC_CHANNELS.permissionRequestsInit, (event) => {
    deps.assertTrustedIpcSender(event)
    return deps.getPermissionBroker()?.listRequests() ?? []
  })

  deps.ipcMain.handle(IPC_CHANNELS.permissionDecide, async (event, payload: unknown) => {
    // Both app windows may answer (the bubble and the panel card). Which one
    // asked is decided here from the sender, never taken from the payload, so
    // the audit trail cannot be spoofed by renderer-supplied fields.
    deps.assertTrustedIpcSender(event)
    const petWindow = deps.getPetWindow()
    const panelWindow = deps.getPanelWindow()
    const fromPanel = Boolean(panelWindow && !panelWindow.isDestroyed() && event.sender === panelWindow.webContents)
    const fromPet = Boolean(petWindow && !petWindow.isDestroyed() && event.sender === petWindow.webContents)
    if (!fromPanel && !fromPet) throw new Error('Unauthorized IPC sender')
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { ok: false, error: 'invalid_decision' }
    }
    const data = payload as Record<string, unknown>
    if (
      typeof data.requestId !== 'string'
      || (data.decision !== 'allow_once' && data.decision !== 'deny')
    ) {
      return { ok: false, error: 'invalid_decision' }
    }
    const broker = deps.getPermissionBroker()
    if (!broker) return { ok: false, error: 'not_found' }
    return broker.decide(data.requestId, data.decision, fromPanel ? 'panel' : 'bubble')
  })

  deps.ipcMain.handle(IPC_CHANNELS.permissionAuditList, (event) => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    return deps.listAudit(AUDIT_LIST_LIMIT)
  })

  deps.ipcMain.handle(IPC_CHANNELS.permissionAuditClear, (event) => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    deps.clearAudit()
    return { ok: true }
  })
}
