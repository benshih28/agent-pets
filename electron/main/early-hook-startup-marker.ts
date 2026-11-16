import { app } from 'electron'
import { hookStartupLocation } from './hook-startup-location.ts'
import { writeHookStartupMarker } from './hook-startup-marker.ts'

// 只有這個 side-effect 模組要放在 main.ts 的第一行 import：ES 模組依 import 順序執行，
// 所以它會在 runtime、sqlite、plugin 等大型模組開始載入之前就寫好標記（這裡只依賴 electron 與兩個小模組）。
// 從這時候到事件埠開始監聽之間送出的 hook 事件，會在連線被拒時短暫重試而不是遺失。
const { directory, eventPort } = hookStartupLocation(process.env, app.isPackaged)

/** main.ts 在埠開始監聽時呼叫 `listening()`、啟動失敗或結束時呼叫 `clear()`。 */
export const hookStartupMarker = writeHookStartupMarker(directory, eventPort)
