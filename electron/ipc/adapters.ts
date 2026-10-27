import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import type { AgentAdapterRegistry } from '../agent-adapter.ts'
import { isAgentAdapterId } from '../agent-adapter.ts'
import { IPC_CHANNELS } from './channels.ts'
import type { AdapterDiagnoseIpcResult, AdapterInstallIpcResult, AdapterIntegrationStatusIpcResult, AdapterUninstallIpcResult } from '../../src/types/ipc.ts'

export interface AdapterIpcDependencies {
  ipcMain: Pick<IpcMain, 'handle'>
  assertTrustedIpcSender(event: IpcMainInvokeEvent, requiredWindow?: BrowserWindow | null): void
  getPanelWindow(): BrowserWindow | null
  getAgentAdapterRegistry(): AgentAdapterRegistry | null
}

export function registerAdapterIpc(deps: AdapterIpcDependencies): void {
  deps.ipcMain.handle(IPC_CHANNELS.integrationStatus, async (event): Promise<AdapterIntegrationStatusIpcResult> => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    return { adapters: await deps.getAgentAdapterRegistry()?.listStatuses() ?? [] }
  })

  deps.ipcMain.handle(IPC_CHANNELS.adapterDiagnose, async (event, id: unknown): Promise<AdapterDiagnoseIpcResult> => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    if (!isAgentAdapterId(id)) return { ok: false, error: 'Unsupported adapter' }
    const report = await deps.getAgentAdapterRegistry()?.diagnose(id)
    return report ? { ok: true, report } : { ok: false, error: 'Adapter unavailable' }
  })

  deps.ipcMain.handle(IPC_CHANNELS.adapterInstall, async (event, id: unknown): Promise<AdapterInstallIpcResult> => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    if (!isAgentAdapterId(id) || id === 'generic-http') {
      return { ok: false, error: 'Adapter is not installable' }
    }
    try {
      const status = await deps.getAgentAdapterRegistry()?.install(id)
      return status ? { ok: true, status } : { ok: false, error: 'Adapter unavailable' }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  deps.ipcMain.handle(IPC_CHANNELS.adapterUninstall, async (event, id: unknown): Promise<AdapterUninstallIpcResult> => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    if (!isAgentAdapterId(id) || id === 'generic-http') {
      return { ok: false, error: 'Adapter is not uninstallable' }
    }
    try {
      const status = await deps.getAgentAdapterRegistry()?.uninstall(id)
      return status ? { ok: true, status } : { ok: false, error: 'Adapter unavailable' }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
}
