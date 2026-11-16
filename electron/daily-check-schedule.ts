// 「每天最多檢查一次」的泛用排程：plugin 目錄更新與 App 新版檢查共用同一套規則。
// 呼叫端（main 的服務）每小時喚醒一次 `checkIfDue()`；這裡負責當日去重與防重入。

export interface DailyCheckDependencies<Result> {
  isEnabled: () => boolean
  getLastCheckedDay: () => string | null
  setLastCheckedDay: (day: string) => void
  check: () => Promise<Result>
  /** 檢查結果不合理（例如數量超出範圍）時回 false，視為失敗且不通知。 */
  isValidResult?: (result: Result) => boolean
  notify: (result: Result) => void
  now?: () => number
}

export type DailyCheckResult =
  | 'disabled'
  | 'already-checked'
  | 'already-running'
  | 'checked'
  | 'failed'

export class DailyCheckSchedule<Result> {
  private readonly dependencies: DailyCheckDependencies<Result>
  private readonly now: () => number
  private running = false

  constructor(dependencies: DailyCheckDependencies<Result>) {
    this.dependencies = dependencies
    this.now = dependencies.now ?? Date.now
  }

  async checkIfDue(): Promise<DailyCheckResult> {
    if (this.running) return 'already-running'
    try {
      if (!this.dependencies.isEnabled()) return 'disabled'
      const timestamp = this.now()
      if (!Number.isFinite(timestamp)) return 'failed'
      const day = new Date(timestamp).toISOString().slice(0, 10)
      if (this.dependencies.getLastCheckedDay() === day) return 'already-checked'
      // 先記下當日再檢查：失敗不會在同一天內反覆連網。
      this.dependencies.setLastCheckedDay(day)
      this.running = true
      const result = await this.dependencies.check()
      if (this.dependencies.isValidResult && !this.dependencies.isValidResult(result)) return 'failed'
      this.dependencies.notify(result)
      return 'checked'
    } catch {
      return 'failed'
    } finally {
      this.running = false
    }
  }
}
