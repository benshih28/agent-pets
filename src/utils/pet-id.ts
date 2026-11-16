import { PLUGIN_ID_SOURCE } from '../types/id-patterns.ts'

/** 永遠可用的預設寵物（PetAnimation 載圖失敗與其他預設值都退回它），所以不能移除或隱藏。 */
export const DEFAULT_PET_ID = 'aang-airbender'

const REGULAR_PET_ID_PATTERN = /^[A-Za-z0-9._-]+$/
const PLUGIN_SKIN_PET_ID_PATTERN = new RegExp(`^plugin:(${PLUGIN_ID_SOURCE}):([a-z0-9-]{1,32})$`)

export interface PluginSkinPetIdParts {
  pluginId: string
  skinId: string
}

export function parsePluginSkinPetId(value: unknown): PluginSkinPetIdParts | null {
  if (typeof value !== 'string' || value.length > 88 || value.includes('..')) return null
  const match = value.match(PLUGIN_SKIN_PET_ID_PATTERN)
  if (!match) return null
  return { pluginId: match[1]!, skinId: match[2]! }
}

export function createPluginSkinPetId(pluginId: unknown, skinId: unknown): string | null {
  if (typeof pluginId !== 'string' || typeof skinId !== 'string') return null
  const value = `plugin:${pluginId}:${skinId}`
  return parsePluginSkinPetId(value) ? value : null
}

export function isPluginSkinPetId(value: unknown): value is string {
  return parsePluginSkinPetId(value) !== null
}

export function isValidRegularPetId(value: unknown, maxLength = 128): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxLength
    && !value.includes('..')
    && REGULAR_PET_ID_PATTERN.test(value)
}

/** Accepts ordinary pet ids and the separately validated plugin skin format. */
export function isValidPetId(value: unknown, maxRegularLength = 128): value is string {
  if (isPluginSkinPetId(value)) return true
  return isValidRegularPetId(value, maxRegularLength)
}
