import * as path from 'node:path'
import { ensurePluginDataDirectory, PluginDataFileError, readPluginDataJson, removePluginDataFile, writePluginDataJson } from './plugin-data-file.ts'

export const PLUGIN_SECRETS_FILENAME = 'secrets.json'
export const PLUGIN_SECRETS_MAX_BYTES = 64 * 1024

export interface PluginSecretEncryption {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

export class PluginSecretsStore {
  private readonly userDataDirectory: string
  private readonly encryption: PluginSecretEncryption

  constructor(userDataDirectory: string, encryption: PluginSecretEncryption) {
    if (!path.isAbsolute(userDataDirectory)) throw new TypeError('Plugin secrets require an absolute userData directory')
    this.userDataDirectory = userDataDirectory
    this.encryption = encryption
  }

  get(pluginId: string, key: string, declaredKeys: readonly string[]): string {
    if (!declaredKeys.includes(key)) throw codedError('not_permitted')
    const values = this.read(pluginId)
    const encoded = values[key]
    if (typeof encoded !== 'string' || encoded.length === 0
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
      throw codedError('secret_not_found')
    }
    if (!this.encryption.isEncryptionAvailable()) throw codedError('secret_unavailable')
    try {
      return this.encryption.decryptString(Buffer.from(encoded, 'base64'))
    } catch {
      throw codedError('secret_unavailable')
    }
  }

  has(pluginId: string, key: string): boolean {
    const encoded = this.read(pluginId)[key]
    return typeof encoded === 'string' && encoded.length > 0
  }

  set(pluginId: string, key: string, value: unknown, declaredKeys: readonly string[]): void {
    if (!declaredKeys.includes(key)) throw codedError('not_permitted')
    if (typeof value !== 'string' || value.length > 4_096 || /[\u0000-\u001f\u007f]/.test(value)) throw codedError('settings_invalid')
    const values = this.read(pluginId)
    if (value.length === 0) {
      delete values[key]
      this.write(pluginId, values)
      return
    }
    if (!this.encryption.isEncryptionAvailable()) throw codedError('secret_unavailable')
    try {
      values[key] = this.encryption.encryptString(value).toString('base64')
    } catch {
      throw codedError('secret_unavailable')
    }
    this.write(pluginId, values)
  }

  listConfigured(pluginId: string, declaredKeys: readonly string[]): Record<string, boolean> {
    const values = this.read(pluginId)
    return Object.fromEntries(declaredKeys.map(key => {
      const value = values[key]
      return [key, typeof value === 'string' && value.length > 0]
    }))
  }

  remove(pluginId: string): void {
    const directory = ensurePluginDataDirectory(this.userDataDirectory, pluginId, false)
    removePluginDataFile(path.join(directory, PLUGIN_SECRETS_FILENAME))
  }

  private read(pluginId: string): Record<string, unknown> {
    const directory = ensurePluginDataDirectory(this.userDataDirectory, pluginId, false)
    return readPluginDataJson(path.join(directory, PLUGIN_SECRETS_FILENAME), PLUGIN_SECRETS_MAX_BYTES)
  }

  private write(pluginId: string, values: Record<string, unknown>): void {
    const directory = ensurePluginDataDirectory(this.userDataDirectory, pluginId, true)
    const filePath = path.join(directory, PLUGIN_SECRETS_FILENAME)
    readPluginDataJson(filePath, PLUGIN_SECRETS_MAX_BYTES)
    if (Buffer.byteLength(JSON.stringify(values), 'utf8') > PLUGIN_SECRETS_MAX_BYTES) throw codedError('too_large')
    try { writePluginDataJson(filePath, values) } catch (error) {
      if (error instanceof PluginDataFileError) throw codedError('secret_unavailable')
      throw error
    }
  }
}

function codedError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code })
}
