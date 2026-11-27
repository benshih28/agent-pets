import { statfs as fsStatfs } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { DbMaintenanceResult } from '../../src/types/growth-maintenance.ts'
import { SqliteBusyError, sqliteFootprintBytes } from '../sqlite-maintenance.ts'

const DAY_MS = 24 * 60 * 60 * 1000
// 明確傳入批次大小，迴圈結束條件才不依賴 pruneStaleActivity 的預設值。
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
  databasePaths(): readonly string[]
  /** 掃描以多批交易匯入，不能和 VACUUM 交錯。 */
  isLocalScanActive(): boolean
  logError(message: string, error?: unknown): void
  now?: () => number
  footprint?: (filePath: string) => number
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

  async function shortageFor(databasePath: string | undefined): Promise<{ needed: number, available: number } | null> {
    if (!databasePath) return null
    try {
      const stats = await statfs(dirname(databasePath))
      const available = Number(stats.bavail) * Number(stats.bsize)
      if (!Number.isFinite(available) || available < 0) return null
      const needed = footprint(databasePath) * VACUUM_SPACE_FACTOR
      return available >= needed ? null : { needed, available }
    } catch {
      // 無法判斷時繼續：VACUUM 磁碟寫滿會由 SQLite 安全回滾；一律拒絕會讓部分檔案系統永遠無法整理。
      return null
    }
  }

  async function run(): Promise<DbMaintenanceResult> {
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
        // 讓出事件迴圈避免連續 VACUUM 卡住主程序；讓出期間掃描可能啟動，所以每次 VACUUM 前重查。
        const databases = [history, progression, achievements]
        const paths = deps.databasePaths()
        for (let index = 0; index < databases.length; index += 1) {
          const store = databases[index]
          if (!store) continue
          await new Promise<void>(resolve => { setImmediate(resolve) })
          if (deps.isLocalScanActive()) return { ok: false, error: 'scanning' }
          const shortage = await shortageFor(paths[index])
          if (shortage) return { ok: false, error: 'insufficient_space', neededBytes: shortage.needed, availableBytes: shortage.available }
          // statfs 是非同步的，compact 之前要再查一次。
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
