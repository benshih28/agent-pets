import { statSync } from 'node:fs'

interface MaintenanceDatabase {
  exec(sql: string): void
  /** 舊執行環境沒有時只能靠呼叫端自己的計數。 */
  isTransaction?: boolean
}

export class SqliteBusyError extends Error {
  constructor() {
    super('SQLite database has an open transaction')
    this.name = 'SqliteBusyError'
  }
}

// VACUUM 會重寫整個檔案且不能在交易內跑，所以有任何開啟中的交易就拒絕，不重試。只能由使用者觸發的整理流程呼叫。
export function optimizeAndVacuum(database: MaintenanceDatabase, ownTransactionOpen = false): void {
  if (ownTransactionOpen || database.isTransaction === true) throw new SqliteBusyError()
  database.exec('PRAGMA optimize')
  database.exec('VACUUM')
  database.exec('PRAGMA wal_checkpoint(TRUNCATE)')
}

// 主檔 + -wal，不用 page_count*page_size：WAL 模式下未 checkpoint 的資料在 -wal 裡，只看頁數會低估整理前。-shm 不計。
export function sqliteFootprintBytes(filePath: string): number {
  let total = 0
  for (const path of [filePath, `${filePath}-wal`]) {
    try { total += statSync(path).size } catch { /* 檔案不存在即為 0 */ }
  }
  return total
}
