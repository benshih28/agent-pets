import { statSync } from 'node:fs'

interface MaintenanceDatabase {
  exec(sql: string): void
  /** node:sqlite 的 DatabaseSync.isTransaction；舊執行環境沒有時只能靠呼叫端自己的計數。 */
  isTransaction?: boolean
}

/** 資料庫正在交易中，VACUUM 不能執行。 */
export class SqliteBusyError extends Error {
  constructor() {
    super('SQLite database has an open transaction')
    this.name = 'SqliteBusyError'
  }
}

/**
 * `PRAGMA optimize` 之後 `VACUUM`，最後把 WAL 截斷回主檔。
 * VACUUM 會重寫整個檔案且不能在交易內跑，所以有任何開啟中的交易就拒絕，不重試。
 * 只能由使用者觸發的整理流程呼叫，啟動流程不可以用。
 */
export function optimizeAndVacuum(database: MaintenanceDatabase, ownTransactionOpen = false): void {
  if (ownTransactionOpen || database.isTransaction === true) throw new SqliteBusyError()
  database.exec('PRAGMA optimize')
  database.exec('VACUUM')
  database.exec('PRAGMA wal_checkpoint(TRUNCATE)')
}

/**
 * 磁碟占用 = 主檔 + -wal。選它而不是 page_count*page_size，因為 WAL 模式下未 checkpoint 的
 * 資料還在 -wal 裡，只看頁數會低估「整理前」、也看不到截斷 WAL 釋放的空間。-shm 是固定大小的索引，不計。
 */
export function sqliteFootprintBytes(filePath: string): number {
  let total = 0
  for (const path of [filePath, `${filePath}-wal`]) {
    try { total += statSync(path).size } catch { /* 檔案不存在即為 0 */ }
  }
  return total
}
