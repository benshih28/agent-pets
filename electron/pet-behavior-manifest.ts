import { isRecord } from './value-guards.ts'
import {
  PET_ATLAS_MAX_ROWS,
  PET_MOTION_MAX_FRAMES,
  PET_MOTION_MAX_FRAME_MS,
  PET_MOTION_MIN_FRAME_MS,
  PET_MOTION_NAMES,
  petMotionFitsAtlas,
  type PetAtlasGrid,
  type PetMotionManifest,
  type PetMotionOverride,
} from '../src/types/pet-atlas.ts'

export type SanitizedPetBehaviorDefinition = PetMotionOverride
export type SanitizedPetBehaviorManifest = PetMotionManifest

function isBoundedInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
}

function parseDefinition(value: unknown): SanitizedPetBehaviorDefinition | undefined {
  if (!isRecord(value)) return undefined
  const { row, frames, frameDurations } = value
  if (!isBoundedInteger(row, 0, PET_ATLAS_MAX_ROWS - 1)) return undefined
  if (frames !== undefined && !isBoundedInteger(frames, 1, PET_MOTION_MAX_FRAMES)) return undefined

  let safeDurations: number[] | undefined
  if (frameDurations !== undefined) {
    if (!Array.isArray(frameDurations) || frameDurations.length < 1 || frameDurations.length > PET_MOTION_MAX_FRAMES) {
      return undefined
    }
    safeDurations = []
    for (const duration of frameDurations) {
      if (typeof duration !== 'number' || !Number.isFinite(duration)) return undefined
      safeDurations.push(Math.round(Math.max(PET_MOTION_MIN_FRAME_MS, Math.min(PET_MOTION_MAX_FRAME_MS, duration))))
    }
  }

  return {
    row,
    ...(frames === undefined ? {} : { frames }),
    ...(safeDurations ? { frameDurations: safeDurations } : {}),
  }
}

export interface PetBehaviorManifestParseResult {
  manifest: SanitizedPetBehaviorManifest | undefined
  outOfRange: boolean
}

// 沒有 `grid` 時只做格式與上下限檢查，畫面端載入圖後會再用實際尺寸篩一次。
export function parsePetBehaviorManifestDetailed(value: unknown, grid?: PetAtlasGrid): PetBehaviorManifestParseResult {
  if (!isRecord(value)) return { manifest: undefined, outOfRange: false }
  const result: SanitizedPetBehaviorManifest = {}
  let outOfRange = false
  for (const name of PET_MOTION_NAMES) {
    if (!Object.hasOwn(value, name)) continue
    const definition = parseDefinition(value[name])
    if (!definition) continue
    if (grid && !petMotionFitsAtlas(definition, grid)) {
      outOfRange = true
      continue
    }
    result[name] = definition
  }
  return { manifest: Object.keys(result).length > 0 ? result : undefined, outOfRange }
}

export function parsePetBehaviorManifest(value: unknown, grid?: PetAtlasGrid): SanitizedPetBehaviorManifest | undefined {
  return parsePetBehaviorManifestDetailed(value, grid).manifest
}
