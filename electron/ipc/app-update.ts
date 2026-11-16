import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import type { AppUpdateCheckResponse, AppUpdateState } from '../../src/types/app-update.ts'
import { IPC_CHANNELS } from './channels.ts'
import { handleTrusted } from './trusted.ts'

export interface AppUpdateIpcDependencies {
  ipcMain: Pick<IpcMain, 'handle'>
  assertTrustedIpcSender(event: IpcMainInvokeEvent, requiredWindow?: BrowserWindow | null): void
  getPanelWindow(): BrowserWindow | null
  getState(): AppUpdateState
  setEnabled(enabled: boolean): AppUpdateState
  checkNow(): Promise<AppUpdateCheckResponse>
  openRelease(): Promise<boolean>
}

// 只允許設定面板呼叫。沒有任何 URL 參數：檢查網址與 release 頁網址都由主程序決定，
// renderer 只能「開／關」「立即檢查」「開啟最新版頁面」。
export function registerAppUpdateIpc(deps: AppUpdateIpcDependencies): void {
  handleTrusted(deps.ipcMain, IPC_CHANNELS.appUpdateGet, deps.getPanelWindow, deps.assertTrustedIpcSender, () => deps.getState())

  handleTrusted(deps.ipcMain, IPC_CHANNELS.appUpdateSetEnabled, deps.getPanelWindow, deps.assertTrustedIpcSender,
    (_event, enabled: unknown) => {
      // 非 boolean 一律當作無效輸入：不改設定，回傳目前狀態。
      if (typeof enabled !== 'boolean') return deps.getState()
      return deps.setEnabled(enabled)
    })

  handleTrusted(deps.ipcMain, IPC_CHANNELS.appUpdateCheck, deps.getPanelWindow, deps.assertTrustedIpcSender, () => deps.checkNow())

  handleTrusted(deps.ipcMain, IPC_CHANNELS.appUpdateOpenRelease, deps.getPanelWindow, deps.assertTrustedIpcSender, () => deps.openRelease())
}
