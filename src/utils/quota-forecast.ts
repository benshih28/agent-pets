// 額度預測：依近期用量樣本估計「照目前速度何時用完／重置前是否會用完」。
// 純函式、不碰 i18n 與 Date.now，方便在 node 直接測；被測試載入，所以只用相對 import（此檔目前沒有 import）。

export interface QuotaSample {
  /** 讀數時間（ms epoch）。 */
  atMs: number
  /** 已用百分比，0-100。 */
  usedPercent: number
}

/** 同一個額度視窗（例如 5 小時區塊）的樣本；重置時整個清空。 */
export interface QuotaSeries {
  /** 此視窗目前的重置時間（ms），沒有就是 null。 */
  resetsAtMs: number | null
  samples: QuotaSample[]
}

export type QuotaForecast =
  | { kind: 'insufficient' }
  | { kind: 'idle' }
  | { kind: 'depleted' }
  | { kind: 'safe'; projectedAtReset: number }
  | { kind: 'exhausts'; exhaustAtMs: number }

// 每個視窗最多保留的樣本數：輪詢約每 2 分鐘一次，60 筆約 2 小時，
// 足夠反映「近期」速度，也讓記憶體與每次回歸成本有固定上限。
export const QUOTA_SAMPLE_CAP = 60
// 少於這個樣本數或時間跨度，斜率只是雜訊，寧可不顯示。
export const MIN_FORECAST_SAMPLES = 3
export const MIN_FORECAST_SPAN_MS = 10 * 60_000
// 最後一筆讀數太舊（例如服務商失敗後沿用舊值）時，外推出來的結果不可信。
export const MAX_FORECAST_STALENESS_MS = 20 * 60_000
// resetsAt 由服務商以相對時間換算，每次讀取會有秒級抖動；超過這個差距才算真正換了視窗。
export const RESET_TOLERANCE_MS = 5 * 60_000
// 用量讀數的四捨五入抖動容忍；低於它的下降不視為重置。
const USAGE_DROP_TOLERANCE = 1
// 低於此速率（百分點／小時）視為沒有在消耗，避免用極小斜率算出幾百年後才用完。
const IDLE_RATE_PER_HOUR = 0.05

const HOUR_MS = 3_600_000

function validSample(sample: QuotaSample): boolean {
  return Number.isFinite(sample.atMs) && Number.isFinite(sample.usedPercent)
}

/**
 * 把一筆新讀數放進視窗樣本，必要時先清空：resetsAt 換了、用量下降、時間戳倒退（時鐘回撥）。
 * 同一時間戳的重複讀數直接忽略。回傳 true 表示樣本有新增。
 */
export function recordQuotaSample(
  series: QuotaSeries,
  sample: QuotaSample,
  resetsAtMs: number | null,
  cap = QUOTA_SAMPLE_CAP,
): boolean {
  if (!validSample(sample)) return false
  const nextReset = resetsAtMs !== null && Number.isFinite(resetsAtMs) ? resetsAtMs : null
  const last = series.samples[series.samples.length - 1]
  const resetChanged = (series.resetsAtMs === null) !== (nextReset === null)
    || (series.resetsAtMs !== null && nextReset !== null && Math.abs(series.resetsAtMs - nextReset) > RESET_TOLERANCE_MS)
  if (resetChanged
    || (last && sample.atMs < last.atMs)
    || (last && sample.usedPercent < last.usedPercent - USAGE_DROP_TOLERANCE)) {
    series.samples.length = 0
  } else if (last && sample.atMs === last.atMs) {
    return false
  }
  series.resetsAtMs = nextReset
  // 有界：滿了就丟最舊的一筆（cap 很小，shift 成本可忽略）。
  if (series.samples.length >= cap) series.samples.shift()
  series.samples.push({ atMs: sample.atMs, usedPercent: sample.usedPercent })
  return true
}

/**
 * 以最小平方法線性回歸估計消耗速率（百分點／ms）。選它而不是首末差分：
 * 用量讀數是四捨五入的階梯值，首末兩點的誤差會被放大成斜率；回歸用到全部樣本，
 * 單次掃描 O(n)，不需要像 Theil-Sen 那樣 O(n²)。
 * 只取最後一段「時間嚴格遞增且用量不下降」的樣本，所以傳入未清理的序列也安全。
 */
function tailSlope(samples: readonly QuotaSample[]): { slope: number; count: number; spanMs: number } | null {
  let start = samples.length
  for (let i = samples.length - 1; i >= 0; i--) {
    const sample = samples[i]
    if (!validSample(sample)) break
    if (i < samples.length - 1) {
      const next = samples[i + 1]
      if (sample.atMs >= next.atMs || sample.usedPercent > next.usedPercent + USAGE_DROP_TOLERANCE) break
    }
    start = i
  }
  const count = samples.length - start
  if (count < 2) return null
  const origin = samples[start].atMs
  let sumX = 0
  let sumY = 0
  for (let i = start; i < samples.length; i++) {
    sumX += samples[i].atMs - origin
    sumY += samples[i].usedPercent
  }
  const meanX = sumX / count
  const meanY = sumY / count
  let covariance = 0
  let variance = 0
  for (let i = start; i < samples.length; i++) {
    const dx = samples[i].atMs - origin - meanX
    covariance += dx * (samples[i].usedPercent - meanY)
    variance += dx * dx
  }
  if (!(variance > 0)) return null
  return { slope: covariance / variance, count, spanMs: samples[samples.length - 1].atMs - origin }
}

export function forecastQuota(
  samples: readonly QuotaSample[],
  resetsAtMs: number | null | undefined,
  nowMs: number,
): QuotaForecast {
  if (!Number.isFinite(nowMs)) return { kind: 'insufficient' }
  const latest = samples[samples.length - 1]
  if (!latest || !validSample(latest)) return { kind: 'insufficient' }
  // 重置時間缺失或已過：沒有可比較的終點，也可能是舊視窗的資料。
  if (resetsAtMs === null || resetsAtMs === undefined || !Number.isFinite(resetsAtMs) || resetsAtMs <= nowMs) {
    return { kind: 'insufficient' }
  }
  if (latest.usedPercent >= 100) return { kind: 'depleted' }
  if (nowMs - latest.atMs > MAX_FORECAST_STALENESS_MS || latest.atMs > nowMs + MAX_FORECAST_STALENESS_MS) {
    return { kind: 'insufficient' }
  }
  const fit = tailSlope(samples)
  if (!fit || fit.count < MIN_FORECAST_SAMPLES || fit.spanMs < MIN_FORECAST_SPAN_MS) return { kind: 'insufficient' }
  if (!Number.isFinite(fit.slope)) return { kind: 'insufficient' }
  if (fit.slope * HOUR_MS < IDLE_RATE_PER_HOUR) return { kind: 'idle' }

  const used = Math.max(0, latest.usedPercent)
  const projectedAtReset = used + fit.slope * (resetsAtMs - latest.atMs)
  if (projectedAtReset < 100) return { kind: 'safe', projectedAtReset: Math.max(used, projectedAtReset) }
  const exhaustAtMs = latest.atMs + (100 - used) / fit.slope
  // 算出的時間早於現在（讀數稍舊）就以現在為下限，避免顯示負的時間。
  return Number.isFinite(exhaustAtMs) ? { kind: 'exhausts', exhaustAtMs: Math.max(exhaustAtMs, nowMs) } : { kind: 'insufficient' }
}
