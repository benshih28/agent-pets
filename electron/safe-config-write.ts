import * as fs from 'node:fs'
import * as path from 'node:path'
import { renameSyncWithRetry } from './fs-rename.ts'

// Shared, Electron-free helpers for touching configuration files that belong to
// the user (~/.claude/settings.json, ~/.codex/hooks.json, ...). The rules:
//   1. never overwrite a file we cannot parse,
//   2. back the file up before changing it,
//   3. write through a temp file + rename so a crash never leaves half a file,
//   4. report "unchanged" instead of rewriting identical content.

export const BACKUP_MARKER = '.agent-pets-bak-'
export const MAX_BACKUPS = 5
export const MAX_CONFIG_BYTES = 1024 * 1024

export type ConfigRefusalCode = 'unparseable' | 'not_object' | 'unsafe' | 'too_large'

export class ConfigRefusedError extends Error {
  readonly code: ConfigRefusalCode
  readonly filePath: string

  constructor(code: ConfigRefusalCode, filePath: string, message: string) {
    super(message)
    this.name = 'ConfigRefusedError'
    this.code = code
    this.filePath = filePath
  }
}

export interface ConfigWriteResult {
  status: 'written' | 'unchanged'
  path: string
  backupPath: string | null
}

export type JsonObject = Record<string, unknown>

export function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

// Follow a symlinked dotfile (common for dotfile managers) to its real target so
// the rename replaces the target, not the link.
function resolveWriteTarget(filePath: string): string {
  try {
    if (fs.lstatSync(filePath).isSymbolicLink()) return fs.realpathSync(filePath)
  } catch { /* missing file: write in place */ }
  return filePath
}

export function writeTextAtomic(filePath: string, content: string, options: { mode?: number } = {}): void {
  const target = resolveWriteTarget(filePath)
  const directory = path.dirname(target)
  fs.mkdirSync(directory, { recursive: true })

  let mode = options.mode
  if (mode === undefined) {
    try { mode = fs.statSync(target).mode & 0o777 } catch { /* new file */ }
  }

  const temporaryPath = path.join(directory, `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`)
  try {
    fs.writeFileSync(temporaryPath, content, {
      encoding: 'utf8',
      flag: 'wx',
      ...(mode !== undefined ? { mode } : {}),
    })
    renameSyncWithRetry(temporaryPath, target)
    if (mode !== undefined && process.platform !== 'win32') {
      try { fs.chmodSync(target, mode) } catch { /* best effort */ }
    }
  } catch (error) {
    try { fs.rmSync(temporaryPath, { force: true }) } catch { /* ignore */ }
    throw error
  }
}

function backupTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

export function listBackups(filePath: string): string[] {
  const directory = path.dirname(filePath)
  const prefix = `${path.basename(filePath)}${BACKUP_MARKER}`
  try {
    return fs.readdirSync(directory)
      .filter(name => name.startsWith(prefix))
      .sort()
      .map(name => path.join(directory, name))
  } catch {
    return []
  }
}

/** Copies the file next to itself and prunes older backups. Returns null when there is nothing to back up. */
export function backupConfig(filePath: string, keep = MAX_BACKUPS): string | null {
  const source = resolveWriteTarget(filePath)
  if (!fs.existsSync(source)) return null
  const directory = path.dirname(source)
  const base = `${path.basename(source)}${BACKUP_MARKER}${backupTimestamp()}`
  let backupPath = path.join(directory, base)
  for (let suffix = 1; fs.existsSync(backupPath); suffix += 1) {
    backupPath = path.join(directory, `${base}-${suffix}`)
  }
  // Created 0600 from the start (a copy-then-chmod leaves a window where a secret-bearing
  // config backup is readable by others).
  fs.writeFileSync(backupPath, fs.readFileSync(source), { flag: 'wx', mode: 0o600 })
  const backups = listBackups(source)
  for (const stale of backups.slice(0, Math.max(0, backups.length - keep))) {
    try { fs.rmSync(stale, { force: true }) } catch { /* ignore */ }
  }
  return backupPath
}

/** Reads a user config file as bounded text. Returns null when it does not exist. */
export function readConfigText(filePath: string): string | null {
  let stat: fs.Stats
  try {
    stat = fs.statSync(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  if (!stat.isFile()) {
    throw new ConfigRefusedError('unsafe', filePath, `${filePath} is not a regular file; Agent Pets did not modify it.`)
  }
  if (stat.size > MAX_CONFIG_BYTES) {
    throw new ConfigRefusedError(
      'too_large',
      filePath,
      `${filePath} is ${stat.size} bytes, above the ${MAX_CONFIG_BYTES} byte limit; Agent Pets did not modify it.`,
    )
  }
  return fs.readFileSync(filePath, 'utf8')
}

/**
 * Parses an existing JSON object config strictly. A missing or blank file yields an empty
 * object; anything else that is not a valid JSON object (including JSONC with comments or
 * trailing commas) is refused instead of being replaced.
 */
export function readJsonObjectConfig(filePath: string): { exists: boolean, root: JsonObject, raw: string | null } {
  const raw = readConfigText(filePath)
  if (raw === null) return { exists: false, root: {}, raw: null }
  const text = raw.replace(/^﻿/, '')
  if (text.trim() === '') return { exists: true, root: {}, raw }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new ConfigRefusedError(
      'unparseable',
      filePath,
      `${filePath} is not valid JSON (comments and trailing commas are not supported); Agent Pets did not modify it.`,
    )
  }
  if (!isJsonObject(parsed)) {
    throw new ConfigRefusedError(
      'not_object',
      filePath,
      `${filePath} does not contain a JSON object; Agent Pets did not modify it.`,
    )
  }
  return { exists: true, root: parsed, raw }
}

export function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

/** Backup-then-atomic-write; identical content is reported as unchanged and nothing is touched. */
export function writeConfigSafely(filePath: string, content: string): ConfigWriteResult {
  let existing: string | null = null
  try { existing = fs.readFileSync(resolveWriteTarget(filePath), 'utf8') } catch { /* new file */ }
  if (existing === content) return { status: 'unchanged', path: filePath, backupPath: null }
  const backupPath = existing !== null ? backupConfig(filePath) : null
  writeTextAtomic(filePath, content)
  return { status: 'written', path: filePath, backupPath }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
