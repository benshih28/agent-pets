// Node 測試會直接載入，所以不得 import 任何東西。

/** `min > max` 時回傳 `min`（下限優先），精靈比 work area 還大時靠它貼齊左上角；`panel-layout.ts` 的 `clampNumber` 回傳 `max`，不要合併。 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}
