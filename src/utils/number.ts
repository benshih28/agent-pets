// 主行程與畫面端共用的數值工具。Node 測試會直接載入，所以不得 import 任何東西。

/**
 * 把 `value` 限制在 `[min, max]`。`min > max` 時回傳 `min`（下限優先）：拖曳與視窗模式在
 * 精靈比 work area 還大時靠這個行為貼齊左上角。`panel-layout.ts` 的 `clampNumber` 在這種
 * 情況回傳 `max`，語意不同，不要合併。
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}
