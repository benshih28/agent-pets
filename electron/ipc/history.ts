import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import type { HistoryStore } from '../history'
import type {
  HistoryClearResult,
  HistoryCommandResult,
  HistoryExportFormat,
  HistorySessionDetail,
  HistorySessionPage,
  HistorySummary,
  HistoryUsageBlock,
} from '../../src/types/history'
import { t } from '../../src/i18n.ts'
import { historyDaysToCsv, historyExportFileName } from '../history-export.ts'
import { isHistorySessionId, normalizeSessionQuery } from '../history-sessions.ts'
import { IPC_CHANNELS } from './channels.ts'

type HistoryExportDialogOptions = {
  title: string
  defaultPath: string
  filters: Array<{ name: string; extensions: string[] }>
}

const EXPORT_SCAN_WAIT_MS = 2_000

export interface HistoryIpcDependencies {
  ipcMain: Pick<IpcMain, 'handle'>
  assertTrustedIpcSender(event: IpcMainInvokeEvent, requiredWindow?: BrowserWindow | null): void
  getPanelWindow(): BrowserWindow | null
  getHistoryStore(): HistoryStore | null
  refreshLocalUsage(): Promise<void>
  currentHistorySummary(projectId?: string, rangeDays?: number): HistorySummary | null
  broadcastHistoryUpdated(): void
  /** Optional hook after the history was cleared (e.g. remove set-aside corrupt copies). */
  onHistoryCleared?(): void
  documentsPath(): string
  joinPath(...parts: string[]): string
  showSaveDialog(window: BrowserWindow | null, options: HistoryExportDialogOptions): Promise<{ canceled: boolean; filePath?: string }>
  writeJsonAtomic(filePath: string, value: unknown): void
  activePetId(): string | null
  writeTextFile(filePath: string, text: string): void
  revealPath(filePath: string): void
  /** XP/level/streak and unlocked achievements to embed in the JSON export. */
  growthExport?(petId: string): unknown
}

export function registerHistoryIpc(deps: HistoryIpcDependencies): void {
  let lastExportPath: string | null = null

  deps.ipcMain.handle(IPC_CHANNELS.historySummary, async (event, projectId: unknown, rangeDays?: unknown) => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    // Never block the summary on a log scan: return stored aggregates now and
    // let the (throttled) background scan push a historyUpdated when it imports.
    void deps.refreshLocalUsage().catch(() => undefined)
    return deps.currentHistorySummary(
      typeof projectId === 'string' ? projectId : undefined,
      rangeDays === 30 || rangeDays === 90 ? rangeDays : 7,
    )
  })

  // The Usage tab only needs the local 5-hour blocks. Unlike historySummary it
  // takes no input and never starts a log scan, so a historyUpdated broadcast
  // that triggers this refetch cannot schedule another scan (no feedback loop).
  deps.ipcMain.handle(IPC_CHANNELS.historyUsageBlocks, (event): HistoryUsageBlock[] => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    const historyStore = deps.getHistoryStore()
    if (!historyStore) return []
    try {
      return historyStore.getUsageBlocks()
    } catch {
      return []
    }
  })

  // Session browser: read-only and metadata-only. The store re-validates the
  // query (ids, bounds, enum values, page size) and binds every value, and
  // neither handler starts a log scan, so a historyUpdated refetch cannot loop.
  deps.ipcMain.handle(IPC_CHANNELS.historySessions, (event, query?: unknown): HistorySessionPage => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    const historyStore = deps.getHistoryStore()
    if (!historyStore) return { items: [], nextCursor: null }
    try {
      return historyStore.listSessions(deps.activePetId() ?? 'aang-airbender', normalizeSessionQuery(query, Date.now()))
    } catch {
      return { items: [], nextCursor: null }
    }
  })

  deps.ipcMain.handle(IPC_CHANNELS.historySessionDetail, (event, sessionId?: unknown): HistorySessionDetail | null => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    const historyStore = deps.getHistoryStore()
    if (!historyStore || !isHistorySessionId(sessionId)) return null
    try {
      return historyStore.getSessionDetail(deps.activePetId() ?? 'aang-airbender', sessionId)
    } catch {
      return null
    }
  })

  deps.ipcMain.handle(IPC_CHANNELS.historyClear, (event): HistoryClearResult => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    const historyStore = deps.getHistoryStore()
    if (!historyStore) return { ok: false, error: 'unavailable' }
    try {
      historyStore.clear()
      deps.onHistoryCleared?.()
      deps.broadcastHistoryUpdated()
      return { ok: true }
    } catch {
      return { ok: false, error: 'unavailable' }
    }
  })

  deps.ipcMain.handle(IPC_CHANNELS.historyExport, async (event, request?: unknown): Promise<HistoryCommandResult> => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    const historyStore = deps.getHistoryStore()
    if (!historyStore) return { ok: false, error: 'unavailable' }
    const input = request && typeof request === 'object' ? request as Record<string, unknown> : {}
    const format: HistoryExportFormat = input.format === 'csv' ? 'csv' : 'json'
    const rangeDays = input.rangeDays === 30 || input.rangeDays === 90 ? input.rangeDays : 7
    const projectId = typeof input.projectId === 'string' && /^[a-f0-9]{32}$/.test(input.projectId)
      ? input.projectId
      : undefined
    // Freshen local-log totals, but never let a slow scan hold the Save dialog.
    await Promise.race([
      deps.refreshLocalUsage().catch(() => undefined),
      new Promise(resolve => setTimeout(resolve, EXPORT_SCAN_WAIT_MS)),
    ])
    const petId = deps.activePetId() ?? 'aang-airbender'
    const exported = historyStore.getExport(petId, projectId, rangeDays, deps.growthExport?.(petId))
    const defaultName = historyExportFileName(format, rangeDays, exported.summary.localDate, projectId)
    const saveOptions = {
      title: t('growth.exportTitle'),
      defaultPath: deps.joinPath(deps.documentsPath(), defaultName),
      filters: format === 'csv'
        ? [{ name: 'CSV', extensions: ['csv'] }]
        : [{ name: 'JSON', extensions: ['json'] }],
    }
    const result = await deps.showSaveDialog(deps.getPanelWindow(), saveOptions)
    if (result.canceled || !result.filePath) return { ok: false, error: 'cancelled' }
    try {
      if (format === 'csv') deps.writeTextFile(result.filePath, historyDaysToCsv(exported.summary.days))
      else deps.writeJsonAtomic(result.filePath, exported)
      lastExportPath = result.filePath
      return { ok: true, path: result.filePath }
    } catch {
      return { ok: false, error: 'write_failed' }
    }
  })

  // Reveals only the file this session just exported; the renderer never
  // supplies a path, so this cannot be used to reveal arbitrary files.
  deps.ipcMain.handle(IPC_CHANNELS.historyRevealExport, (event): boolean => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    if (!lastExportPath) return false
    deps.revealPath(lastExportPath)
    return true
  })
}
