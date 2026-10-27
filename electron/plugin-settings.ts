import * as path from 'node:path'
import type { PluginManifest, PluginSettingDefinition, PluginSettingScalar } from '../src/types/plugin.ts'
import { ensurePluginDataDirectory, readPluginDataJson, writePluginDataJson } from './plugin-data-file.ts'

export const PLUGIN_SETTINGS_FILENAME = 'settings.json'
export const PLUGIN_SETTINGS_MAX_BYTES = 64 * 1024

export interface PluginSettingsSnapshot {
  values: Record<string, PluginSettingScalar>
  secrets: Record<string, boolean>
}

export class PluginSettingsStore {
  private readonly userDataDirectory: string

  constructor(userDataDirectory: string) {
    if (!path.isAbsolute(userDataDirectory)) throw new TypeError('Plugin settings require an absolute userData directory')
    this.userDataDirectory = userDataDirectory
  }

  get(pluginId: string, manifest: PluginManifest): Record<string, PluginSettingScalar> {
    const stored = this.read(pluginId)
    const result: Record<string, PluginSettingScalar> = {}
    for (const [key, definition] of Object.entries(manifest.contributes.settings?.properties ?? {})) {
      if (definition.format === 'secret') continue
      const candidate = stored[key]
      if (isValidSettingValue(definition, candidate)) result[key] = candidate
      else if (definition.default !== undefined) result[key] = definition.default
    }
    return result
  }

  set(pluginId: string, manifest: PluginManifest, value: unknown): Record<string, PluginSettingScalar> {
    if (!isRecord(value)) throw codedError('settings_invalid')
    const definitions = manifest.contributes.settings?.properties ?? {}
    const secrets = new Set(manifest.permissions.secrets ?? [])
    const next: Record<string, PluginSettingScalar> = {}
    for (const [key, raw] of Object.entries(value)) {
      const definition = definitions[key]
      if (!definition || definition.format === 'secret' || secrets.has(key) || !isValidSettingValue(definition, raw)) {
        throw codedError('settings_invalid')
      }
      next[key] = raw
    }
    for (const [key, definition] of Object.entries(definitions)) {
      if (definition.format === 'secret') continue
      if (!Object.hasOwn(next, key) && definition.default !== undefined) next[key] = definition.default
    }
    if (Buffer.byteLength(JSON.stringify(next), 'utf8') > PLUGIN_SETTINGS_MAX_BYTES) throw codedError('too_large')
    const directory = ensurePluginDataDirectory(this.userDataDirectory, pluginId, true)
    writePluginDataJson(path.join(directory, PLUGIN_SETTINGS_FILENAME), next)
    return { ...next }
  }

  private read(pluginId: string): Record<string, unknown> {
    const directory = ensurePluginDataDirectory(this.userDataDirectory, pluginId, false)
    return readPluginDataJson(path.join(directory, PLUGIN_SETTINGS_FILENAME), PLUGIN_SETTINGS_MAX_BYTES)
  }
}

export function publishPluginSettingsChanged(
  pluginId: string,
  manifest: PluginManifest,
  settingsStore: Pick<PluginSettingsStore, 'get'>,
  publish: (pluginId: string, values: Record<string, PluginSettingScalar>) => void,
): Record<string, PluginSettingScalar> {
  const values = settingsStore.get(pluginId, manifest)
  publish(pluginId, values)
  return values
}

export function isValidSettingValue(definition: PluginSettingDefinition, value: unknown): value is PluginSettingScalar {
  if (definition.format === 'secret' || typeof value !== definition.type) return false
  if (typeof value === 'string') {
    return value.length <= (definition.maxLength ?? 4_096) && !/[\u0000-\u001f\u007f]/.test(value)
      && (!definition.enum || definition.enum.some(item => Object.is(item, value)))
  }
  if (typeof value === 'number') {
    return Number.isFinite(value)
      && (definition.minimum === undefined || value >= definition.minimum)
      && (definition.maximum === undefined || value <= definition.maximum)
      && (!definition.enum || definition.enum.some(item => Object.is(item, value)))
  }
  return typeof value === 'boolean'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function codedError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code })
}
