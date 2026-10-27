import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import type { HistoryStore } from '../history'
import type { HistoryClearResult, HistoryCommandResult, HistorySummary } from '../../src/types/history'
import { IPC_CHANNELS } from './channels.ts'

type HistoryExportDialogOptions = {
  title: string
  defaultPath: string
  filters: Array<{ name: string; extensions: string[] }>
}

export interface HistoryIpcDependencies {
  ipcMain: Pick<IpcMain, 'handle'>
  assertTrustedIpcSender(event: IpcMainInvokeEvent, requiredWindow?: BrowserWindow | null): void
  getPanelWindow(): BrowserWindow | null
  getHistoryStore(): HistoryStore | null
  refreshLocalUsage(): Promise<void>
  currentHistorySummary(projectId?: string): HistorySummary | null
  broadcastHistoryUpdated(): void
  documentsPath(): string
  joinPath(...parts: string[]): string
  showSaveDialog(window: BrowserWindow | null, options: HistoryExportDialogOptions): Promise<{ canceled: boolean; filePath?: string }>
  writeJsonAtomic(filePath: string, value: unknown): void
  activePetId(): string | null
}

export function registerHistoryIpc(deps: HistoryIpcDependencies): void {
  deps.ipcMain.handle(IPC_CHANNELS.historySummary, async (event, projectId: unknown) => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    await deps.refreshLocalUsage()
    return deps.currentHistorySummary(typeof projectId === 'string' ? projectId : undefined)
  })

  deps.ipcMain.handle(IPC_CHANNELS.historyClear, (event): HistoryClearResult => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    const historyStore = deps.getHistoryStore()
    if (!historyStore) return { ok: false, error: 'unavailable' }
    try {
      historyStore.clear()
      deps.broadcastHistoryUpdated()
      return { ok: true }
    } catch {
      return { ok: false, error: 'unavailable' }
    }
  })

  deps.ipcMain.handle(IPC_CHANNELS.historyExport, async (event): Promise<HistoryCommandResult> => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    const historyStore = deps.getHistoryStore()
    if (!historyStore) return { ok: false, error: 'unavailable' }
    await deps.refreshLocalUsage()
    const defaultName = `agent-pets-history-${new Date().toISOString().slice(0, 10)}.json`
    const saveOptions = {
      title: '匯出 History',
      defaultPath: deps.joinPath(deps.documentsPath(), defaultName),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    }
    const result = await deps.showSaveDialog(deps.getPanelWindow(), saveOptions)
    if (result.canceled || !result.filePath) return { ok: false, error: 'cancelled' }
    try {
      deps.writeJsonAtomic(result.filePath, historyStore.getExport(deps.activePetId() ?? 'aang-airbender'))
      return { ok: true, path: result.filePath }
    } catch {
      return { ok: false, error: 'write_failed' }
    }
  })
}
