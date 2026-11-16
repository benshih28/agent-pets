// 寵物視窗尺寸的唯一來源：主行程 createPetWindow() 的冷啟動預設值、pet-resize IPC 與拖曳的
// 留白，以及畫面端 agentStore 的寬高都從這裡取。狀態列以 DOM 量測畫出，但視窗大小由這裡事先
// 決定；少算的高度會讓內容往上擠進 tooltip 預留空間，Windows 分層視窗會直接裁掉。
// 主行程與 Node 測試都直接載入這個檔，所以執行期 import 只能用相對路徑。
import { PET_CELL_WIDTH } from '../types/pet-atlas.ts'
import { clamp } from './number.ts'

export interface PetWindowSize { width: number; height: number }

/** 單寵模式的寬度，夠放下 "OpenCode (CLI+Desktop)" 這類狀態列。 */
export const PET_BASE_W = 250
/** canvas 加一條狀態列。 */
export const PET_BASE_H = 232
/** 單寵模式每多一條狀態列增加的高度。狀態列一律是單行細條（專案名稱只在 tooltip／aria-label）。 */
export const STATUS_LINE_EXTRA_H = 22
// The quota tooltip pops open above the status line and is rendered at a
// fixed (unscaled) size regardless of pet size (see DesktopPet.vue), so this
// headroom must stay fixed too rather than scaling with petScale. Without
// it the pet window's transparent canvas is sized exactly to the visible
// sprite + status line with no slack above — fine on macOS, where the
// compositor tolerates content painted slightly outside a layer-backed
// window's bounds, but Windows' layered-window transparency hard-clips to
// the window rectangle, so the tooltip got cut off / visibly broken there.
// 權限泡泡也放在這段留白裡；`tokens.css` 的 `--pet-bubble-headroom` 必須相同（有測試檢查）。
export const QUOTA_TOOLTIP_HEADROOM_H = 190
// The quota tooltip (DesktopPet.vue) shrinks to its content but is capped at
// 244px regardless of pet size, so the single-pet window stays at least this
// wide (plus a little slack either side of the centered tooltip) or a small
// pet size clips the tooltip at the window edge.
export const QUOTA_TOOLTIP_MIN_W = 260
/** 多寵模式每隻寵物一格 sprite 寬，加上 .multi-pet-row 的間距（倍率 1 時 8px）與一點餘裕。 */
export const MULTI_PET_CELL_W = PET_CELL_WIDTH + 12
/** 多寵模式整列左右的留白。 */
export const MULTI_PET_ROW_PADDING_W = 16
/** 主行程接受的視窗邊長範圍：還原儲存的尺寸與 renderer 的 pet-resize 請求都夾在這裡。 */
export const PET_WINDOW_DIMENSION_LIMITS = { min: 80, max: 1_600 } as const

export function petWindowWidth(familyCount: number, multiPet: boolean, petScale: number): number {
  // 多寵模式的寬度由寵物數量決定，不套 tooltip 最小寬度（至少兩隻時本來就比它寬）。
  if (multiPet) return Math.round((familyCount * MULTI_PET_CELL_W + MULTI_PET_ROW_PADDING_W) * petScale)
  return Math.max(Math.round(PET_BASE_W * petScale), QUOTA_TOOLTIP_MIN_W)
}

export function petWindowHeight(lineCount: number, multiPet: boolean, petScale: number): number {
  // Multi-pet mode lays families out side by side with one short label
  // each, instead of stacking a status line per family, so it doesn't
  // need the per-line height growth the single-pet mode does.
  const extraLines = multiPet ? 0 : (Math.max(1, lineCount) - 1) * STATUS_LINE_EXTRA_H
  return Math.round((PET_BASE_H + extraLines) * petScale) + QUOTA_TOOLTIP_HEADROOM_H
}

/**
 * 沒有儲存尺寸時的冷啟動大小：單寵、一條狀態列。寵物大小存在 renderer 的 localStorage，
 * 主行程讀不到，所以只能用這個估計值；store 載入後會再送一次實際尺寸。
 */
export function initialPetWindowSize(petScale: number): PetWindowSize {
  return { width: petWindowWidth(1, false, petScale), height: petWindowHeight(1, false, petScale) }
}

/** 把一個邊長限制在 {@link PET_WINDOW_DIMENSION_LIMITS} 並取整數像素。 */
export function clampPetWindowDimension(value: number): number {
  return Math.round(clamp(value, PET_WINDOW_DIMENSION_LIMITS.min, PET_WINDOW_DIMENSION_LIMITS.max))
}
