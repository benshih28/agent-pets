import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import type { AgentAdapterRegistry } from '../agent-adapter.ts'
import { isAgentAdapterId } from '../agent-adapter.ts'
import { IPC_CHANNELS } from './channels.ts'
import type { InstallOutcome } from '../../src/types/agent-adapter.ts'
import type { AdapterDiagnoseIpcResult, AdapterInstallIpcResult, AdapterIntegrationStatusIpcResult, AdapterUninstallIpcResult } from '../../src/types/ipc.ts'

export interface AdapterIpcDependencies {
  ipcMain: Pick<IpcMain, 'handle'>
  assertTrustedIpcSender(event: IpcMainInvokeEvent, requiredWindow?: BrowserWindow | null): void
  getPanelWindow(): BrowserWindow | null
  /** The pet asks once at first launch whether onboarding is still needed. */
  getPetWindow?(): BrowserWindow | null
  getAgentAdapterRegistry(): AgentAdapterRegistry | null
}

export function registerAdapterIpc(deps: AdapterIpcDependencies): void {
  deps.ipcMain.handle(IPC_CHANNELS.integrationStatus, async (event): Promise<AdapterIntegrationStatusIpcResult> => {
    // Read-only status. The pet window reads it on first launch to decide whether to
    // open the onboarding wizard; every other adapter operation stays panel-only.
    const pet = deps.getPetWindow?.() ?? null
    deps.assertTrustedIpcSender(event, pet?.webContents && event.sender === pet.webContents ? pet : deps.getPanelWindow())
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
      const detection = await deps.getAgentAdapterRegistry()?.install(id)
      if (!detection) return { ok: false, error: 'Adapter unavailable' }
      const { outcome, ...status } = detection
      return { ok: true, status, ...(outcome ? { outcome } : {}) }
    } catch (error) {
      const outcome = (error as { installOutcome?: InstallOutcome } | null)?.installOutcome
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        ...(outcome ? { outcome } : {}),
      }
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
