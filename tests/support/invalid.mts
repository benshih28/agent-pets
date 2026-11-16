// 負向測試要把執行期驗證會拒絕的值餵給宣告了嚴格型別的函式；型別系統本來就不允許這種值，
// 所以轉型集中在這裡，呼叫端一眼就看得出這是刻意的非法輸入，而不是假物件偷懶。
export function invalid<T>(value: unknown): T {
  return value as T
}
