import type { BrowserWindow, IpcMain, IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import type { LocalServerHealthSnapshot, LocalServerId } from '../../src/types/reliability.ts'
import type { SessionSnapshotEntry } from '../main/session-snapshot.ts'
import { IPC_CHANNELS } from './channels.ts'

export interface ReliabilityIpcDependencies {
  ipcMain: Pick<IpcMain, 'handle' | 'on'>
  isTrustedIpcSender(event: IpcMainEvent): boolean
  reportRendererError(report: { message: string; stack?: string; kind: 'vue' | 'unhandledrejection' | 'error'; window: 'pet' | 'panel' | 'unknown' }): void
  reloadRenderers(): void
  assertTrustedIpcSender(event: IpcMainInvokeEvent, requiredWindow?: BrowserWindow | null): void
  getPanelWindow(): BrowserWindow | null
  getServerHealth(): LocalServerHealthSnapshot
  retryServer(id?: LocalServerId): void
  getSessionSnapshot(): SessionSnapshotEntry[]
  exportDiagnostics(): Promise<{ ok: boolean; canceled?: boolean }>
}

const SERVER_IDS: readonly LocalServerId[] = ['event', 'permission', 'presentation']

const MAX_REPORT_MESSAGE = 500
const MAX_REPORT_STACK = 2_000
const MAX_REPORTS_PER_MINUTE = 20
const REPORT_KINDS = ['vue', 'unhandledrejection', 'error'] as const

export function registerReliabilityIpc(deps: ReliabilityIpcDependencies): void {
  let reportWindowStart = 0
  let reportsInWindow = 0
  deps.ipcMain.on(IPC_CHANNELS.rendererErrorReport, (event, payload: unknown) => {
    if (!deps.isTrustedIpcSender(event)) return
    const now = Date.now()
    if (now - reportWindowStart > 60_000) { reportWindowStart = now; reportsInWindow = 0 }
    if (++reportsInWindow > MAX_REPORTS_PER_MINUTE) return
    if (!payload || typeof payload !== 'object') return
    const { message, stack, kind } = payload as { message?: unknown; stack?: unknown; kind?: unknown }
    if (typeof message !== 'string') return
    const panel = deps.getPanelWindow()
    deps.reportRendererError({
      message: message.slice(0, MAX_REPORT_MESSAGE),
      stack: typeof stack === 'string' ? stack.slice(0, MAX_REPORT_STACK) : undefined,
      kind: REPORT_KINDS.includes(kind as typeof REPORT_KINDS[number]) ? kind as typeof REPORT_KINDS[number] : 'error',
      window: panel && event.sender === panel.webContents ? 'panel' : 'pet',
    })
  })

  deps.ipcMain.on(IPC_CHANNELS.rendererReload, event => {
    if (!deps.isTrustedIpcSender(event)) return
    deps.reloadRenderers()
  })

  deps.ipcMain.handle(IPC_CHANNELS.serverHealthGet, (event): LocalServerHealthSnapshot => {
    deps.assertTrustedIpcSender(event)
    return deps.getServerHealth()
  })

  deps.ipcMain.handle(IPC_CHANNELS.sessionSnapshotGet, (event): SessionSnapshotEntry[] => {
    deps.assertTrustedIpcSender(event)
    return deps.getSessionSnapshot()
  })

  deps.ipcMain.handle(IPC_CHANNELS.diagnosticsExport, async (event): Promise<{ ok: boolean; canceled?: boolean }> => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    try {
      return await deps.exportDiagnostics()
    } catch {
      return { ok: false }
    }
  })

  deps.ipcMain.handle(IPC_CHANNELS.serverHealthRetry, (event, id: unknown): LocalServerHealthSnapshot => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    deps.retryServer(SERVER_IDS.includes(id as LocalServerId) ? id as LocalServerId : undefined)
    return deps.getServerHealth()
  })
}
