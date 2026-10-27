import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import type { HistoryStore } from '../history'
import { IPC_CHANNELS } from './channels.ts'

export interface QuotaIpcDependencies {
  ipcMain: Pick<IpcMain, 'handle'>
  assertTrustedIpcSender(event: IpcMainInvokeEvent): void
  getQuotaUsage(force: boolean): Promise<unknown>
  getHistoryStore(): HistoryStore | null
  broadcastHistoryUpdated(): void
  getWindows(): Array<BrowserWindow | null>
  logError(message: string, error: unknown): void
}

export function registerQuotaIpc(deps: QuotaIpcDependencies): void {
  deps.ipcMain.handle(IPC_CHANNELS.quotaUsage, async (event, force?: unknown) => {
    deps.assertTrustedIpcSender(event)
    const usage = await deps.getQuotaUsage(force === true)
    try {
      if (deps.getHistoryStore()?.recordQuotaSnapshot(usage)) deps.broadcastHistoryUpdated()
    } catch (error) {
      deps.logError('History quota snapshot failed', error)
    }
    for (const win of deps.getWindows()) {
      if (win && !win.isDestroyed()) win.webContents.send(IPC_CHANNELS.quotaUsageUpdated, usage)
    }
    return usage
  })
}
