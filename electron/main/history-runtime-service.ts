import type { HistoryTokenUsageRecord } from '../../src/types/history'
import type { HistoryStore } from '../history.ts'
import type { LocalUsageReader, LocalUsageReaderOptions } from '../local-usage.ts'
import { openWithCorruptionRecovery } from './db-recovery.ts'
import { LOCAL_USAGE_TICK_MS, localUsageCatchUpDelayMs, shouldRunLocalUsageTick } from './scan-schedule.ts'
import type { MainState } from './state.ts'

// History runtime：開啟歷史資料庫（含損毀恢復與退避重試），依固定週期、補掃與啟動延後排程
// 執行本機 token 用量掃描，並在常駐期間清除過期資料。
//
// `historyStore`、`localUsageReader`、`localUsageScanTimer`、`localUsageScanPromise` 仍放在
// `mainState`：IPC、事件伺服器與關閉協調器都會讀。其餘計時器由這裡持有並由 `dispose()` 停止。
// 成就與廣播的副作用以回呼傳入，這個服務不直接碰成就或成長的 store。

export const HISTORY_STORE_RETRY_DELAYS_MS = [30_000, 120_000, 600_000] as const
export const STARTUP_DEFERRED_WORK_MS = 10_000
export const HISTORY_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000
// Opening the History tab must not rescan the whole log tree each time; the
// 60s timer is the regular cadence, so panel-triggered refreshes are throttled.
export const LOCAL_USAGE_MIN_SCAN_INTERVAL_MS = 10_000

export type HistoryRuntimeState = Pick<MainState,
  | 'historyStore' | 'localUsageReader' | 'localUsageScanTimer' | 'localUsageScanPromise'
  | 'progressionStore' | 'projectRoutingStore' | 'isQuitting'>

export interface HistoryRuntimeDeps {
  state: HistoryRuntimeState
  databasePath(): string
  openStore(databasePath: string): HistoryStore
  createLocalUsageReader(options: LocalUsageReaderOptions): LocalUsageReader
  homeDir(): string
  configDirs: LocalUsageReaderOptions['configDirs']
  isOnBatteryPower(): boolean
  /** 損毀的資料庫已移到旁邊並重新建立。 */
  onRecovered(): void
  /** 歷史資料有變動（匯入了本機用量）；廣播由呼叫端合併。 */
  onHistoryUpdated(): void
  /** 每批匯入的本機 token 用量，交給成就的 token 帳本。 */
  onLocalRecordsImported(records: readonly HistoryTokenUsageRecord[], retentionDays: number): void
  /** 每次本機用量掃描完成時呼叫一次。 */
  onLocalScanFinished(): void
  /** 延後的首次工作：依歷史資料庫補算成就。 */
  onDeferredStartupWork(): void
  logError(message: string, error?: unknown): void
  now?: () => number
}

export interface HistoryRuntimeService {
  /** 啟動步驟與重試的進入點；store 已開啟時不做事。 */
  start(): void
  refreshLocalUsage(options?: { catchUp?: boolean }): Promise<void>
  /** 停止延後工作、重試、補掃與清除計時器；可重複呼叫。 */
  dispose(): void
}

function unref(handle: ReturnType<typeof setTimeout>): void {
  handle.unref?.()
}

export function createHistoryRuntimeService(deps: HistoryRuntimeDeps): HistoryRuntimeService {
  const { state } = deps
  const now = deps.now ?? (() => Date.now())
  let retryAttempt = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let deferredWorkTimer: ReturnType<typeof setTimeout> | null = null
  let pruneTimer: ReturnType<typeof setInterval> | null = null
  let catchUpTimer: ReturnType<typeof setTimeout> | null = null
  let lastScanAt = 0
  let stalledScans = 0

  async function refreshLocalUsage(options: { catchUp?: boolean } = {}): Promise<void> {
    if (!state.localUsageReader || state.localUsageScanPromise) return state.localUsageScanPromise ?? Promise.resolve()
    if (!options.catchUp && now() - lastScanAt < LOCAL_USAGE_MIN_SCAN_INTERVAL_MS) return
    state.localUsageScanPromise = state.localUsageReader.scan()
      .then(result => {
        lastScanAt = now()
        if (result.recordsImported > 0) deps.onHistoryUpdated()
        deps.onLocalScanFinished()
        stalledScans = result.bytesRead > 0 ? 0 : stalledScans + 1
        // A budget-limited scan continues shortly instead of waiting a full tick.
        const delay = localUsageCatchUpDelayMs(result.pending, deps.isOnBatteryPower(), stalledScans)
        if (delay !== null && !catchUpTimer && !state.isQuitting) {
          catchUpTimer = setTimeout(() => {
            catchUpTimer = null
            void refreshLocalUsage({ catchUp: true })
          }, delay)
          unref(catchUpTimer)
        }
      })
      .catch(error => {
        deps.logError('Local token usage scan failed', error)
      })
      .finally(() => {
        state.localUsageScanPromise = null
      })
    return state.localUsageScanPromise
  }

  function clearPruneTimer(): void {
    if (pruneTimer) clearInterval(pruneTimer)
    pruneTimer = null
  }

  function scheduleRetry(): void {
    const delay = HISTORY_STORE_RETRY_DELAYS_MS[retryAttempt]
    if (delay === undefined || retryTimer || state.isQuitting) return
    retryAttempt += 1
    retryTimer = setTimeout(() => {
      retryTimer = null
      start()
    }, delay)
    unref(retryTimer)
  }

  function start(): void {
    if (state.historyStore) return
    try {
      const databasePath = deps.databasePath()
      state.historyStore = openWithCorruptionRecovery(
        databasePath,
        () => deps.openStore(databasePath),
        {
          log: (message, detail) => deps.logError(message, detail),
          verify: store => store.quickCheck(),
          dispose: store => store.close(),
          onRecovered: () => deps.onRecovered(),
        },
      )
      if (!state.historyStore) throw new Error('History database could not be opened')
      retryAttempt = 0
      const history = state.historyStore
      const retentionDays = history.getRetentionDays()
      state.localUsageReader = deps.createLocalUsageReader({
        homeDir: deps.homeDir(),
        configDirs: deps.configDirs,
        history,
        projectRouting: state.projectRoutingStore,
        onRecordsImported: records => deps.onLocalRecordsImported(records, retentionDays),
      })
      let scanTick = 0
      state.localUsageScanTimer = setInterval(() => {
        scanTick += 1
        if (!shouldRunLocalUsageTick(scanTick, deps.isOnBatteryPower())) return
        void refreshLocalUsage()
      }, LOCAL_USAGE_TICK_MS)
      unref(state.localUsageScanTimer)
      // Heavy first-run work waits until the pet has been on screen for a while.
      if (deferredWorkTimer) clearTimeout(deferredWorkTimer)
      deferredWorkTimer = setTimeout(() => {
        deferredWorkTimer = null
        deps.onDeferredStartupWork()
        void refreshLocalUsage()
      }, STARTUP_DEFERRED_WORK_MS)
      unref(deferredWorkTimer)
      // A tray app runs for weeks: expire old events/sessions at runtime too,
      // in bounded batches that yield between steps.
      clearPruneTimer()
      pruneTimer = setInterval(() => {
        void state.historyStore?.pruneInBatches().catch(error => deps.logError('History prune failed', error))
        try { state.progressionStore?.pruneStaleActivity() } catch (error) { deps.logError('XP activity prune failed', error) }
      }, HISTORY_PRUNE_INTERVAL_MS)
      unref(pruneTimer)
    } catch (error) {
      // History is an additive HUD feature. A broken history database must not
      // prevent the pet, event receiver, XP, or permission controls from booting.
      deps.logError('History storage is unavailable', error)
      clearPruneTimer()
      try { state.historyStore?.close() } catch {}
      state.historyStore = null
      state.localUsageReader = null
      scheduleRetry()
    }
  }

  function dispose(): void {
    if (deferredWorkTimer) clearTimeout(deferredWorkTimer)
    deferredWorkTimer = null
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = null
    if (catchUpTimer) clearTimeout(catchUpTimer)
    catchUpTimer = null
    clearPruneTimer()
  }

  return { start, refreshLocalUsage, dispose }
}
