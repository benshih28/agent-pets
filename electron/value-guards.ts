// plugin-panel-themes.ts 刻意保留自己的副本：目錄驗證器原封不動地內嵌它，不能多一個相依。

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null
}

// 給欄位各自驗證、缺了就當沒給的 payload 用：不是物件（含陣列）視為空物件。
export function recordOrEmpty(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}
