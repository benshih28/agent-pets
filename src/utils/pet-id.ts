const REGULAR_PET_ID_PATTERN = /^[A-Za-z0-9._-]+$/
const PLUGIN_SKIN_PET_ID_PATTERN = /^plugin:([a-z0-9-]{3,48}):([a-z0-9-]{1,32})$/

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
