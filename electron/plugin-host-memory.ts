export const PLUGIN_HOST_MEMORY_STRIKES = 2

export interface PluginHostProcessMemory {
  workingSetSize?: number
  privateBytes?: number
}

/**
 * working set 含有與其他 Electron 程序共用的 Chromium 程式碼頁面（Windows 實測空載約 65 MB），
 * 會讓插件看起來比實際用得多；Windows 提供的 privateBytes 才是 host 獨佔的量，其他平台沒有此欄位時退回 working set。
 */
export function pluginHostMemoryMb(memory: PluginHostProcessMemory | undefined): number | null {
  const kb = memory?.privateBytes ?? memory?.workingSetSize
  return typeof kb === 'number' && Number.isFinite(kb) && kb >= 0 ? kb / 1024 : null
}

/**
 * 只比較 host 相對於「載入完成、尚未啟動 Worker」時的增長，讓 Chromium 本身的開銷不必依平台猜測；
 * 需連續超標才判定，避免單次 GC 前的尖峰被當成崩潰。
 */
export class PluginHostMemoryMonitor {
  private baselineMb: number | null = null
  private strikes = 0

  reset(): void {
    this.baselineMb = null
    this.strikes = 0
  }

  setBaseline(usageMb: number | null): void {
    if (usageMb === null) return
    this.baselineMb = usageMb
    this.strikes = 0
  }

  isOverBudget(usageMb: number | null, budgetMb: number): boolean {
    if (usageMb === null || !Number.isFinite(budgetMb) || budgetMb <= 0) return false
    if (this.baselineMb === null) {
      // 載入時量不到基準時，以第一次檢查為基準：寬鬆但不會誤殺。
      this.baselineMb = usageMb
      return false
    }
    if (usageMb - this.baselineMb <= budgetMb) {
      this.strikes = 0
      return false
    }
    this.strikes += 1
    return this.strikes >= PLUGIN_HOST_MEMORY_STRIKES
  }
}
