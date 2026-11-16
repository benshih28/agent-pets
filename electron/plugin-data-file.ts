import * as fs from 'node:fs'
import * as path from 'node:path'
import { pidTimestampTemporaryPath, writeFileAtomicSync } from './atomic-file-write.ts'
import { isPluginId } from '../src/types/id-patterns.ts'
import { isRecord } from './value-guards.ts'


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
  if (!path.isAbsolute(userDataDirectory) || !isPluginId(pluginId)) throw new TypeError('Plugin data path is invalid')
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
    if (!isRecord(value)) throw new PluginDataFileError()
    return value
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
  try {
    const stat = fs.lstatSync(filePath)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new PluginDataFileError()
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error
  }
  writeFileAtomicSync(filePath, JSON.stringify(value), {
    temporaryPath: pidTimestampTemporaryPath(filePath),
    mode: 0o600,
    enforceMode: true,
  })
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
