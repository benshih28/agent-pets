import * as fs from 'node:fs'
import * as path from 'node:path'
import { writeJsonAtomic } from './desktop-preferences.ts'

export const PLUGIN_SECRET_CONSENT_FILENAME = 'plugin-secret-consent.json'

export class PluginSecretConsentStore {
  private readonly filePath: string

  constructor(userDataDirectory: string) {
    if (!path.isAbsolute(userDataDirectory)) throw new TypeError('Plugin secret consent requires an absolute userData directory')
    this.filePath = path.join(userDataDirectory, PLUGIN_SECRET_CONSENT_FILENAME)
  }

  hasAccepted(): boolean {
    let descriptor: number | null = null
    try {
      const linkStat = fs.lstatSync(this.filePath)
      if (!linkStat.isFile() || linkStat.isSymbolicLink() || linkStat.size > 1_024) return false
      const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0
      descriptor = fs.openSync(this.filePath, fs.constants.O_RDONLY | noFollow)
      const stat = fs.fstatSync(descriptor)
      if (!stat.isFile() || stat.size > 1_024) return false
      const value: unknown = JSON.parse(fs.readFileSync(descriptor, 'utf8'))
      return Boolean(value && typeof value === 'object' && !Array.isArray(value)
        && 'accepted' in value && value.accepted === true)
    } catch {
      return false
    } finally {
      if (descriptor !== null) {
        try { fs.closeSync(descriptor) } catch {}
      }
    }
  }

  accept(): void {
    try {
      const stat = fs.lstatSync(this.filePath)
      if (!stat.isFile() || stat.isSymbolicLink()) throw codedError('unsafe_file')
    } catch (error) {
      if (!isErrorCode(error, 'ENOENT')) throw error
    }
    writeJsonAtomic(this.filePath, { accepted: true })
  }
}

function isErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code)
}

function codedError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code })
}
