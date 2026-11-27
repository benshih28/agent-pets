// tests/*.test.mts 會用 Node 直接執行這個檔，所以不得 import 任何 src 模組。

/** 圖集寬高必須是它的整數倍。 */
export const PET_CELL_WIDTH = 192
export const PET_CELL_HEIGHT = 208

// v1：8 欄 x 9 列；v2：8 欄 x 11 列，第 9–10 列是「看向」動作，不是走路或睡覺。
export const PET_ATLAS_COLUMNS = 8
export const PET_ATLAS_V1_ROWS = 9
export const PET_ATLAS_V2_ROWS = 11
export const PET_ATLAS_MIN_ROWS = PET_ATLAS_V1_ROWS
/** 第 1 列在兩個版本都是 running-right，v2 預設拿來走路。 */
export const PET_ATLAS_WALK_ROW = 1

// 從檔頭就能檢查的上限（不必解碼），避免一張高度壓縮的小檔讓畫面端配置數 GB 記憶體。
export const PET_ATLAS_MAX_COLUMNS = 32
export const PET_ATLAS_MAX_ROWS = 64
export const PET_ATLAS_MAX_PIXELS = 16 * 1024 * 1024

export const PET_ATLAS_ROW_NAMES = Object.freeze([
  'idle', 'running-right', 'running-left', 'waving', 'jumping',
  'failed', 'waiting', 'running', 'review', 'look 0-157.5°', 'look 180-337.5°',
] as const)

export type PetAtlasMotionName = 'idle' | 'waving' | 'jumping' | 'failed' | 'waiting' | 'running' | 'review'
/** 只有寵物包宣告後才有的動作；沒宣告時回退成 idle。 */
export type PetOptionalMotionName = 'walk' | 'sleep'
export type PetMotionName = PetAtlasMotionName | PetOptionalMotionName

export const PET_OPTIONAL_MOTION_NAMES: readonly PetOptionalMotionName[] = Object.freeze(['walk', 'sleep'])
export const PET_MOTION_NAMES: readonly PetMotionName[] = Object.freeze([
  'idle', 'waving', 'jumping', 'failed', 'waiting', 'running', 'review', ...PET_OPTIONAL_MOTION_NAMES,
])

export interface PetMotionDefinition {
  name: PetMotionName
  row: number
  frameDurations: readonly number[]
}

function motion(name: PetMotionName, row: number, frameDurations: number[]): PetMotionDefinition {
  return Object.freeze({ name, row, frameDurations: Object.freeze(frameDurations) })
}

// 每列的格數防止短動作踩進透明格；整張表凍結，畫面端直接共用這些物件。
export const PET_ATLAS_MOTIONS: Readonly<Record<PetAtlasMotionName, PetMotionDefinition>> = Object.freeze({
  idle: motion('idle', 0, [280, 110, 110, 140, 140, 320]),
  waving: motion('waving', 3, [140, 140, 140, 280]),
  jumping: motion('jumping', 4, [140, 140, 140, 140, 280]),
  failed: motion('failed', 5, [140, 140, 140, 140, 140, 140, 140, 240]),
  waiting: motion('waiting', 6, [150, 150, 150, 150, 150, 260]),
  running: motion('running', 7, [120, 120, 120, 120, 120, 220]),
  review: motion('review', 8, [150, 150, 150, 150, 150, 280]),
})

export const PET_MOTION_MAX_FRAMES = 16
export const PET_MOTION_MIN_FRAME_MS = 60
export const PET_MOTION_MAX_FRAME_MS = 3_000
export const PET_MOTION_DEFAULT_FRAME_MS = 150
export const PET_MOTION_DEFAULT_LAST_FRAME_MS = 260

export interface PetMotionOverride {
  row: number
  frames?: number
  frameDurations?: number[]
}

export type PetMotionManifest = Partial<Record<PetMotionName, PetMotionOverride>>

export interface PetAtlasGrid {
  columns: number
  rows: number
}

export function petAtlasGridFromSize(width: number, height: number): PetAtlasGrid {
  return { columns: Math.floor(width / PET_CELL_WIDTH), rows: Math.floor(height / PET_CELL_HEIGHT) }
}

/** 覆蓋值放不進圖集（列不存在或格數超過欄數）時回傳 false，呼叫端應改用內建值。 */
export function petMotionFitsAtlas(override: PetMotionOverride, grid: PetAtlasGrid): boolean {
  if (!Number.isSafeInteger(override.row) || override.row < 0 || override.row >= grid.rows) return false
  return override.frames === undefined || override.frames <= grid.columns
}

// 主程序已經清理過，這裡再夾一次：渲染端不假設輸入一定乾淨，只在建表時跑、不在每一格。
function fitFrameDurations(source: readonly number[], count: number): readonly number[] {
  return Object.freeze(Array.from({ length: count }, (_, index) => {
    const value = source[index]
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.round(Math.max(PET_MOTION_MIN_FRAME_MS, Math.min(PET_MOTION_MAX_FRAME_MS, value)))
    }
    return index === count - 1 ? PET_MOTION_DEFAULT_LAST_FRAME_MS : PET_MOTION_DEFAULT_FRAME_MS
  }))
}

function builtinMotion(name: PetMotionName): PetMotionDefinition | undefined {
  return Object.hasOwn(PET_ATLAS_MOTIONS, name) ? PET_ATLAS_MOTIONS[name as PetAtlasMotionName] : undefined
}

/** `grid` 未知（圖還沒載入）時只套用上下限；載入後會重算並排除放不下的覆蓋值。時長陣列永遠和格數一樣長。 */
export function resolvePetMotion(name: PetMotionName, manifest: PetMotionManifest | undefined, grid: PetAtlasGrid | null): PetMotionDefinition {
  const declared = manifest && Object.hasOwn(manifest, name) ? manifest[name] : undefined
  const override = declared && (!grid || petMotionFitsAtlas(declared, grid)) ? declared : undefined
  const builtin = builtinMotion(name)
  if (!override) {
    if (!builtin) return resolvePetMotion('idle', manifest, grid)
    if (!grid || builtin.frameDurations.length <= grid.columns) return builtin
  }
  const frameLimit = Math.max(1, Math.min(PET_MOTION_MAX_FRAMES, grid?.columns ?? PET_MOTION_MAX_FRAMES))
  const wanted = override?.frames
    ?? override?.frameDurations?.length
    ?? builtin?.frameDurations.length
    ?? grid?.columns
    ?? PET_ATLAS_MOTIONS.idle.frameDurations.length
  const count = Math.max(1, Math.min(frameLimit, wanted))
  return Object.freeze({
    name,
    row: override?.row ?? builtin!.row,
    frameDurations: fitFrameDurations(override?.frameDurations ?? builtin?.frameDurations ?? [], count),
  })
}

export type PetMotionTable = Readonly<Record<PetMotionName, PetMotionDefinition>>

const BUILTIN_MAX_FRAMES = Math.max(...Object.values(PET_ATLAS_MOTIONS).map(item => item.frameDurations.length))

/** 沒有 manifest、圖集也放得下全部內建動作時共用的表；同一個物件，呼叫端可用 === 判斷有沒有變。 */
export const PET_DEFAULT_MOTION_TABLE: PetMotionTable = Object.freeze({
  ...PET_ATLAS_MOTIONS,
  walk: PET_ATLAS_MOTIONS.idle,
  sleep: PET_ATLAS_MOTIONS.idle,
})

export function resolvePetMotionTable(manifest: PetMotionManifest | undefined, grid: PetAtlasGrid | null): PetMotionTable {
  const hasOverride = manifest !== undefined && PET_MOTION_NAMES.some(name => Object.hasOwn(manifest, name))
  if (!hasOverride && (!grid || grid.columns >= BUILTIN_MAX_FRAMES)) return PET_DEFAULT_MOTION_TABLE
  const table = {} as Record<PetMotionName, PetMotionDefinition>
  for (const name of PET_MOTION_NAMES) table[name] = resolvePetMotion(name, manifest, grid)
  return Object.freeze(table)
}
