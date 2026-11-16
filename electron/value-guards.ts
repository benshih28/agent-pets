// 主程序共用的執行期型別守衛。IPC、檔案與網路輸入在進入業務邏輯前都先經過這些檢查。
// （plugin-panel-themes.ts 刻意保留自己的副本：目錄驗證器原封不動地內嵌那組純函式檔案，
// 不能多一個相依。）

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

// 判斷規則與 isRecord 相同，給「接著要讀欄位」的呼叫點用，免得各處再手寫一次斷言。
export function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null
}

// 欄位本來就各自驗證、缺了就當沒給的 payload 用：不是物件（含陣列）一律視為空物件，
// 所有欄位讀出來都是 undefined，等同沒傳。
export function recordOrEmpty(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}
