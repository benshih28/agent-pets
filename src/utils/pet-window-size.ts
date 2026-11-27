// 視窗大小由這裡事先決定；少算的高度會讓內容往上擠進 tooltip 預留空間，Windows 分層視窗會直接裁掉。
// 主行程與 Node 測試都直接載入這個檔，所以執行期 import 只能用相對路徑。
import { PET_CELL_WIDTH } from '../types/pet-atlas.ts'
import { clamp } from './number.ts'

export interface PetWindowSize { width: number; height: number }

export const PET_BASE_W = 250
export const PET_BASE_H = 232
export const STATUS_LINE_EXTRA_H = 22
// The quota tooltip is rendered at a fixed (unscaled) size, so this headroom must not scale with petScale.
// Windows' layered-window transparency hard-clips to the window rectangle (macOS tolerates overflow),
// so the headroom must be inside the window or the tooltip gets cut off.
// 權限泡泡也放在這段留白裡；`tokens.css` 的 `--pet-bubble-headroom` 必須相同（有測試檢查）。
export const QUOTA_TOOLTIP_HEADROOM_H = 190
// The tooltip is capped at 244px regardless of pet size; a narrower single-pet window would clip it at the edge.
export const QUOTA_TOOLTIP_MIN_W = 260
export const MULTI_PET_CELL_W = PET_CELL_WIDTH + 12
export const MULTI_PET_ROW_PADDING_W = 16
/** 還原儲存的尺寸與 renderer 的 pet-resize 請求都夾在這裡。 */
export const PET_WINDOW_DIMENSION_LIMITS = { min: 80, max: 1_600 } as const

export function petWindowWidth(familyCount: number, multiPet: boolean, petScale: number): number {
  // 多寵模式的寬度由寵物數量決定，不套 tooltip 最小寬度（至少兩隻時本來就比它寬）。
  if (multiPet) return Math.round((familyCount * MULTI_PET_CELL_W + MULTI_PET_ROW_PADDING_W) * petScale)
  return Math.max(Math.round(PET_BASE_W * petScale), QUOTA_TOOLTIP_MIN_W)
}

export function petWindowHeight(lineCount: number, multiPet: boolean, petScale: number): number {
  const extraLines = multiPet ? 0 : (Math.max(1, lineCount) - 1) * STATUS_LINE_EXTRA_H
  return Math.round((PET_BASE_H + extraLines) * petScale) + QUOTA_TOOLTIP_HEADROOM_H
}

/** 寵物大小存在 renderer 的 localStorage，主行程讀不到，所以冷啟動只能用這個估計值；store 載入後會再送一次實際尺寸。 */
export function initialPetWindowSize(petScale: number): PetWindowSize {
  return { width: petWindowWidth(1, false, petScale), height: petWindowHeight(1, false, petScale) }
}

export function clampPetWindowDimension(value: number): number {
  return Math.round(clamp(value, PET_WINDOW_DIMENSION_LIMITS.min, PET_WINDOW_DIMENSION_LIMITS.max))
}
