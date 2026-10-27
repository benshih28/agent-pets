import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import type { PermissionBroker } from '../permission-broker'
import { IPC_CHANNELS } from './channels.ts'

export interface PermissionIpcDependencies {
  ipcMain: Pick<IpcMain, 'handle'>
  assertTrustedIpcSender(event: IpcMainInvokeEvent, requiredWindow?: BrowserWindow | null): void
  getPetWindow(): BrowserWindow | null
  getPermissionBroker(): PermissionBroker | null
}

export function registerPermissionIpc(deps: PermissionIpcDependencies): void {
  deps.ipcMain.handle(IPC_CHANNELS.permissionRequestsInit, (event) => {
    deps.assertTrustedIpcSender(event)
    return deps.getPermissionBroker()?.listRequests() ?? []
  })

  deps.ipcMain.handle(IPC_CHANNELS.permissionDecide, async (event, payload: unknown) => {
    deps.assertTrustedIpcSender(event, deps.getPetWindow())
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
    return broker.decide(data.requestId, data.decision, 'bubble')
  })
}
