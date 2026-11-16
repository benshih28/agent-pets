import { statfs as fsStatfs } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { DbMaintenanceResult } from '../../src/types/growth-maintenance.ts'
import { SqliteBusyError, sqliteFootprintBytes } from '../sqlite-maintenance.ts'

// 資料庫整理：沿用既有保留期清理（history 的 pruneInBatches、progression 的 pruneStaleActivity、
// 成就的本機 token 去重列壓縮），再對三個資料庫各做 optimize + VACUUM。只由使用者觸發；
// 啟動流程不呼叫它，所以不會拖慢開機。

const DAY_MS = 24 * 60 * 60 * 1000
// 明確傳入批次大小，迴圈的結束條件才不會依賴 pruneStaleActivity 的預設值。
const PROGRESSION_PRUNE_BATCH = 5_000

interface HistoryMaintenanceStore {
  getRetentionDays(): number
  pruneInBatches(): Promise<{ events: number, sessions: number }>
  compact(): void
}
interface ProgressionMaintenanceStore {
  pruneStaleActivity(maxAgeMs?: number, limit?: number): number
  compact(): void
}
interface AchievementMaintenanceStore {
  compactLocalTokenUsage(before: number): number
  compact(): void
}

export interface DbMaintenanceDeps {
  getHistoryStore(): HistoryMaintenanceStore | null
  getProgressionStore(): ProgressionMaintenanceStore | null
  getAchievementStore(): AchievementMaintenanceStore | null
  /** 三個資料庫檔的路徑，用來量整理前後的磁碟占用。 */
  databasePaths(): readonly string[]
  /** 本機用量掃描是否進行中（掃描以多批交易匯入，不能和 VACUUM 交錯）。 */
  isLocalScanActive(): boolean
  logError(message: string, error?: unknown): void
  now?: () => number
  footprint?: (filePath: string) => number
  /** 可注入以便測試；預設為 fs.promises.statfs。 */
  statfs?: (directory: string) => Promise<{ bavail: number | bigint, bsize: number | bigint }>
}

/** VACUUM 會在同一磁碟寫出完整副本，所以可用空間至少要是資料庫大小的兩倍。 */
const VACUUM_SPACE_FACTOR = 2

export interface DbMaintenanceService {
  run(): Promise<DbMaintenanceResult>
}

export function createDbMaintenanceService(deps: DbMaintenanceDeps): DbMaintenanceService {
  const now = deps.now ?? (() => Date.now())
  const footprint = deps.footprint ?? sqliteFootprintBytes
  const statfs = deps.statfs ?? fsStatfs
  let running = false

  const totalBytes = () => deps.databasePaths().reduce((sum, path) => sum + footprint(path), 0)

  /** 回傳不足時的需求與可用位元組；statfs 失敗（或結果異常）回 null＝無法判斷。 */
  async function shortageFor(databasePath: string | undefined): Promise<{ needed: number, available: number } | null> {
    if (!databasePath) return null
    try {
      const stats = await statfs(dirname(databasePath))
      const available = Number(stats.bavail) * Number(stats.bsize)
      if (!Number.isFinite(available) || available < 0) return null
      const needed = footprint(databasePath) * VACUUM_SPACE_FACTOR
      return available >= needed ? null : { needed, available }
    } catch {
      // 無法判斷時選擇繼續：VACUUM 在磁碟寫滿時會失敗並由 SQLite 安全回滾，
      // 為了無法取得的統計而一律拒絕，會讓部分平台或檔案系統永遠無法整理。
      return null
    }
  }

  async function run(): Promise<DbMaintenanceResult> {
    // 重入防護：同時只允許一個整理工作。
    if (running) return { ok: false, error: 'busy' }
    const history = deps.getHistoryStore()
    const progression = deps.getProgressionStore()
    const achievements = deps.getAchievementStore()
    if (!history && !progression && !achievements) return { ok: false, error: 'unavailable' }
    if (deps.isLocalScanActive()) return { ok: false, error: 'scanning' }
    running = true
    try {
      const beforeBytes = totalBytes()
      let prunedRows = 0
      try {
        if (history) {
          const pruned = await history.pruneInBatches()
          prunedRows += pruned.events + pruned.sessions
        }
        if (progression) {
          for (;;) {
            const step = progression.pruneStaleActivity(undefined, PROGRESSION_PRUNE_BATCH)
            prunedRows += step
            if (step < PROGRESSION_PRUNE_BATCH) break
          }
        }
        if (achievements) {
          const retentionDays = history?.getRetentionDays() ?? 90
          prunedRows += achievements.compactLocalTokenUsage(now() - (retentionDays + 1) * DAY_MS)
        }
        // 每個資料庫之間讓出事件迴圈，避免三次同步 VACUUM 連續卡住主程序；
        // 讓出期間掃描可能啟動，所以每次 VACUUM 前都重查掃描狀態（交易狀態由 compact 自己檢查並丟 SqliteBusyError）。
        const databases = [history, progression, achievements]
        const paths = deps.databasePaths()
        for (let index = 0; index < databases.length; index += 1) {
          const store = databases[index]
          if (!store) continue
          await new Promise<void>(resolve => { setImmediate(resolve) })
          if (deps.isLocalScanActive()) return { ok: false, error: 'scanning' }
          const shortage = await shortageFor(paths[index])
          if (shortage) return { ok: false, error: 'insufficient_space', neededBytes: shortage.needed, availableBytes: shortage.available }
          // statfs 是非同步的，之後再查一次，讓 compact 之前沒有任何未檢查的讓出點。
          if (deps.isLocalScanActive()) return { ok: false, error: 'scanning' }
          store.compact()
        }
      } catch (error) {
        if (error instanceof SqliteBusyError) return { ok: false, error: 'busy' }
        deps.logError('Database maintenance failed', error)
        return { ok: false, error: 'failed' }
      }
      const afterBytes = totalBytes()
      return { ok: true, beforeBytes, afterBytes, freedBytes: Math.max(0, beforeBytes - afterBytes), prunedRows }
    } finally {
      running = false
    }
  }

  return { run }
}
