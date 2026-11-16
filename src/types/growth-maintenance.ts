/** 設定頁「重設成長資料」與「資料庫整理」兩個維護操作的共用契約。 */

/** 主程序發出的一次性重設 token 的有效時間；對話框按下確認後才會 arm。 */
export const GROWTH_RESET_TOKEN_TTL_MS = 30_000

export type GrowthResetArmResult =
  | { ok: true, token: string }
  | { ok: false, error: 'rate_limited' }

export type GrowthResetResult =
  | { ok: true }
  | { ok: false, error: 'unavailable' | 'rate_limited' | 'invalid_request' | 'failed' }

export interface DbMaintenanceSuccess {
  ok: true
  /** 整理前後的磁碟占用（資料庫檔 + -wal 檔，三個資料庫加總）。 */
  beforeBytes: number
  afterBytes: number
  freedBytes: number
  /** 保留期清理刪掉的歷史／活動／帳本列數。 */
  prunedRows: number
}

export type DbMaintenanceResult =
  | DbMaintenanceSuccess
  | { ok: false, error: 'busy' | 'scanning' | 'unavailable' | 'rate_limited' | 'failed' }
  /** 磁碟可用空間低於 VACUUM 所需（資料庫大小的兩倍）。 */
  | { ok: false, error: 'insufficient_space', neededBytes: number, availableBytes: number }
