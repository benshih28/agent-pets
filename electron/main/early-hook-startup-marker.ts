import { app } from 'electron'
import { hookStartupLocation } from './hook-startup-location.ts'
import { writeHookStartupMarker } from './hook-startup-marker.ts'

// 必須是 main.ts 的第一行 import，標記才會在大型模組載入之前寫好（所以這裡只依賴 electron 與兩個小模組）。
const { directory, eventPort } = hookStartupLocation(process.env, app.isPackaged)

export const hookStartupMarker = writeHookStartupMarker(directory, eventPort)
