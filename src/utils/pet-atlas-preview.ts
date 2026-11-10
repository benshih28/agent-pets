import type { PetImportAtlas } from '../types/pet-import.ts'
import { PET_ATLAS_MOTIONS, PET_ATLAS_ROW_NAMES } from '../types/pet-atlas.ts'

/** 和 PetAnimation 播的 idle 格數一致。 */
export const PREVIEW_IDLE_FRAMES = PET_ATLAS_MOTIONS.idle.frameDurations.length
export const PREVIEW_IDLE_FRAME_MS = 160
/** 預覽列數有上限，很高（但合法）的圖不會塞爆對話框。 */
export const PREVIEW_MAX_ROWS = 16

export function atlasRowName(row: number): string {
  return PET_ATLAS_ROW_NAMES[row] ?? `row ${row}`
}

/** 用 inline style 顯示縮放成 `scale` 的一格，不在 script 裡解碼圖片。 */
export function atlasCellStyle(atlas: PetImportAtlas, url: string, row: number, column: number, scale: number): Record<string, string> {
  const width = Math.round(atlas.frameWidth * scale)
  const height = Math.round(atlas.frameHeight * scale)
  return {
    width: `${width}px`,
    height: `${height}px`,
    backgroundImage: `url("${url}")`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: `${Math.round(atlas.width * scale)}px ${Math.round(atlas.height * scale)}px`,
    backgroundPosition: `-${column * width}px -${row * height}px`,
  }
}

/** 只顯示 agent-pets://import-preview/<token>/spritesheet 的 URL。 */
export function isImportPreviewUrl(value: unknown): value is string {
  return typeof value === 'string' && /^agent-pets:\/\/import-preview\/[0-9a-f]{32}\/spritesheet$/.test(value)
}
