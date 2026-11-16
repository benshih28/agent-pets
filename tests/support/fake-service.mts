// 受測的 IPC 只呼叫服務 class 的幾個公開方法，回傳值也只含斷言用到的欄位；這些 class 帶私有欄位，
// 物件字面值無法滿足其型別。鍵名仍受 keyof T 檢查（拼錯或已改名的方法會報錯），唯一的轉型集中在這裡。
export function fakeService<T>(members: Partial<Record<keyof T, unknown>>): T {
  return members as unknown as T
}
