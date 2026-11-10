// 凍結整張 registry 與其中所有巢狀物件與陣列：表是全程式共用的單一來源，
// 任何地方誤改一格都會悄悄影響所有讀者，凍結後在嚴格模式下會直接丟錯。
// 這個檔案沒有任何 import：主程序、Node 測試與 renderer 都直接載入它（以及 import 它的 registry 檔）。
// 只在模組初始化時跑一次；已凍結的節點直接跳過，所以共用的子物件不會重複走訪。
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}
