import * as fs from 'node:fs'
import * as path from 'node:path'
import { renameSyncWithRetry } from './fs-rename.ts'

const PLUGIN_ID = /^(?!_host$|_shared$)[a-z0-9-]{3,48}$/

export class PluginDataFileError extends Error {
  readonly code = 'plugin_data_unsafe'

  constructor() {
    super('Plugin data file is unsafe')
    this.name = 'PluginDataFileError'
  }
}

function requireDirectory(directory: string, create: boolean): void {
  try {
    const stat = fs.lstatSync(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new PluginDataFileError()
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT' || !create) throw error
    fs.mkdirSync(directory, { mode: 0o700 })
    const stat = fs.lstatSync(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new PluginDataFileError()
  }
}

export function ensurePluginDataDirectory(userDataDirectory: string, pluginId: string, create: boolean): string {
  if (!path.isAbsolute(userDataDirectory) || !PLUGIN_ID.test(pluginId)) throw new TypeError('Plugin data path is invalid')
  const pluginsDirectory = path.join(userDataDirectory, 'plugins')
  const pluginDirectory = path.join(pluginsDirectory, pluginId)
  const dataDirectory = path.join(pluginDirectory, 'data')
  requireDirectory(pluginsDirectory, false)
  requireDirectory(pluginDirectory, false)
  if (create) requireDirectory(dataDirectory, true)
  else {
    try { requireDirectory(dataDirectory, false) } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error
    }
  }
  return dataDirectory
}

export function readPluginDataJson(filePath: string, maxBytes: number): Record<string, unknown> {
  let descriptor: number | null = null
  try {
    const linkStat = fs.lstatSync(filePath)
    if (!linkStat.isFile() || linkStat.isSymbolicLink() || linkStat.size > maxBytes) throw new PluginDataFileError()
    const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow)
    const stat = fs.fstatSync(descriptor)
    if (!stat.isFile() || stat.size > maxBytes) throw new PluginDataFileError()
    const value: unknown = JSON.parse(fs.readFileSync(descriptor, 'utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PluginDataFileError()
    return value as Record<string, unknown>
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return Object.create(null) as Record<string, unknown>
    if (error instanceof PluginDataFileError) throw error
    if (error instanceof SyntaxError) throw new PluginDataFileError()
    throw error
  } finally {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor) } catch {}
    }
  }
}

export function writePluginDataJson(filePath: string, value: Record<string, unknown>): void {
  const directory = path.dirname(filePath)
  const basename = path.basename(filePath)
  const temporaryPath = path.join(directory, `.${basename}.${process.pid}.${Date.now()}.tmp`)
  try {
    try {
      const stat = fs.lstatSync(filePath)
      if (!stat.isFile() || stat.isSymbolicLink()) throw new PluginDataFileError()
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error
    }
    fs.writeFileSync(temporaryPath, JSON.stringify(value), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    renameSyncWithRetry(temporaryPath, filePath)
    if (process.platform !== 'win32') {
      try { fs.chmodSync(filePath, 0o600) } catch {}
    }
  } catch (error) {
    try { fs.rmSync(temporaryPath, { force: true }) } catch {}
    throw error
  }
}

export function removePluginDataFile(filePath: string): void {
  try {
    const stat = fs.lstatSync(filePath)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new PluginDataFileError()
    fs.rmSync(filePath)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return
    throw error
  }
}
