import type { PluginSettingDefinition, PluginSettingScalar } from '../types/plugin'

type Properties = Record<string, PluginSettingDefinition>
type Values = Record<string, PluginSettingScalar>

export type SettingErrorCode = 'required' | 'range' | 'too_long' | 'not_allowed'

function effective(definition: PluginSettingDefinition, value: PluginSettingScalar | undefined): PluginSettingScalar {
  if (value !== undefined) return value
  if (definition.default !== undefined) return definition.default
  return definition.type === 'boolean' ? false : definition.type === 'number' ? 0 : ''
}

/** 草稿與已儲存值（缺值時以預設值計）是否不同；密鑰欄位有輸入也算有未儲存的變更。 */
export function isSettingsDirty(
  properties: Properties,
  saved: Values,
  draft: Values,
  secretDrafts: Record<string, string> = {},
): boolean {
  for (const [key, definition] of Object.entries(properties)) {
    if (definition.format === 'secret') {
      if ((secretDrafts[key] ?? '').length > 0) return true
      continue
    }
    if (effective(definition, saved[key]) !== effective(definition, draft[key])) return true
  }
  return false
}

/** 以 schema 預設值組成的草稿（略過密鑰欄位）。 */
export function defaultSettingsDraft(properties: Properties): Values {
  const draft: Values = {}
  for (const [key, definition] of Object.entries(properties)) {
    if (definition.format === 'secret') continue
    draft[key] = effective(definition, undefined)
  }
  return draft
}

export function validateSetting(definition: PluginSettingDefinition, value: PluginSettingScalar | undefined): SettingErrorCode | null {
  const current = effective(definition, value)
  if (definition.enum && !definition.enum.includes(current)) return 'not_allowed'
  if (definition.type === 'number') {
    if (typeof current !== 'number' || !Number.isFinite(current)) return 'required'
    if ((definition.minimum !== undefined && current < definition.minimum) || (definition.maximum !== undefined && current > definition.maximum)) return 'range'
  }
  if (definition.type === 'string' && typeof current === 'string' && definition.maxLength !== undefined && current.length > definition.maxLength) return 'too_long'
  return null
}

export function validateSettings(properties: Properties, draft: Values): Record<string, SettingErrorCode> {
  const errors: Record<string, SettingErrorCode> = {}
  for (const [key, definition] of Object.entries(properties)) {
    if (definition.format === 'secret') continue
    const code = validateSetting(definition, draft[key])
    if (code) errors[key] = code
  }
  return errors
}
