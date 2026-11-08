import * as fs from 'node:fs'
import * as path from 'node:path'
import { writeTextAtomic } from './safe-config-write.ts'

// Dependency-free, read-only Git awareness for the project MCP setup. We never spawn git: the
// index is parsed directly and `.git/info/exclude` is the only file ever written.

const MAX_INDEX_BYTES = 64 * 1024 * 1024
const INDEX_FIXED_ENTRY_BYTES = 62

export interface GitLocation {
  /** Directory holding index / info/exclude for this working tree. */
  gitDir: string
  /** Shared directory (differs from gitDir for linked worktrees). */
  commonDir: string
  /**
   * Set when `.git` points (via `gitdir` / `commondir`) outside the picked folder. Such a
   * location is never read or written; callers report it and skip.
   */
  outside?: boolean
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function realpathOrNull(target: string): string | null {
  try { return fs.realpathSync(target) } catch { return null }
}

export function findGitLocation(projectPath: string): GitLocation | null {
  const dotGit = path.join(projectPath, '.git')
  let stat: fs.Stats
  try { stat = fs.lstatSync(dotGit) } catch { return null }
  if (stat.isSymbolicLink()) return null
  const root = realpathOrNull(projectPath)
  if (!root) return null
  if (stat.isDirectory()) return { gitDir: dotGit, commonDir: dotGit }
  if (!stat.isFile() || stat.size > 4096) return null
  const match = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(dotGit, 'utf8'))
  if (!match) return null
  const gitDir = path.resolve(projectPath, match[1]!)
  const realGitDir = realpathOrNull(gitDir)
  if (!realGitDir) return null
  if (!isInside(root, realGitDir)) return { gitDir, commonDir: gitDir, outside: true }
  let commonDir = gitDir
  try {
    const common = fs.readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim()
    if (common) commonDir = path.resolve(gitDir, common)
  } catch { /* plain repository */ }
  const realCommon = realpathOrNull(commonDir)
  if (!realCommon || !isInside(root, realCommon)) return { gitDir, commonDir, outside: true }
  return { gitDir: realGitDir, commonDir: realCommon }
}

/** Paths (POSIX separators) recorded in the index, or null if the index is absent/unsupported. */
export function readTrackedPaths(location: GitLocation): Set<string> | null {
  if (location.outside) return null
  const indexPath = path.join(location.gitDir, 'index')
  let buffer: Buffer
  try {
    const stat = fs.statSync(indexPath)
    if (!stat.isFile() || stat.size > MAX_INDEX_BYTES) return null
    buffer = fs.readFileSync(indexPath)
  } catch {
    return null
  }
  if (buffer.length < 12 || buffer.toString('latin1', 0, 4) !== 'DIRC') return null
  const version = buffer.readUInt32BE(4)
  // Version 4 prefix-compresses paths; treat it as unknown rather than guessing.
  if (version !== 2 && version !== 3) return null
  const count = buffer.readUInt32BE(8)
  const paths = new Set<string>()
  let offset = 12
  for (let index = 0; index < count; index += 1) {
    if (offset + INDEX_FIXED_ENTRY_BYTES > buffer.length) return null
    const flags = buffer.readUInt16BE(offset + 60)
    const extended = version === 3 && (flags & 0x4000) !== 0
    const nameStart = offset + INDEX_FIXED_ENTRY_BYTES + (extended ? 2 : 0)
    let nameEnd = nameStart
    while (nameEnd < buffer.length && buffer[nameEnd] !== 0) nameEnd += 1
    if (nameEnd >= buffer.length) return null
    paths.add(buffer.toString('utf8', nameStart, nameEnd))
    const entryLength = nameEnd - offset + 1
    offset += Math.ceil(entryLength / 8) * 8
  }
  return paths
}

export function toPosixRelative(projectPath: string, filePath: string): string {
  return path.relative(projectPath, filePath).split(path.sep).join('/')
}

/** Adds patterns to the repository-local exclude file. Returns the patterns that were newly added. */
export function addLocalExcludes(location: GitLocation, patterns: string[]): string[] {
  if (location.outside) throw new Error('Refusing to edit a git directory outside the project folder')
  const infoDir = path.join(location.commonDir, 'info')
  const excludePath = path.join(infoDir, 'exclude')
  // The exclude file may only ever live in a real (non-symlinked) info directory.
  try {
    if (fs.lstatSync(infoDir).isSymbolicLink()) throw new Error('Refusing to edit an unsafe .git/info directory')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  let existing = ''
  try {
    const stat = fs.lstatSync(excludePath)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Refusing to edit an unsafe .git/info/exclude')
    existing = fs.readFileSync(excludePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const present = new Set(existing.split(/\r?\n/).map(line => line.trim()))
  const added = patterns.filter(pattern => !present.has(pattern) && !present.has(`/${pattern}`))
  if (added.length === 0) return []
  const eol = existing.includes('\r\n') ? '\r\n' : '\n'
  const separator = existing.length > 0 && !existing.endsWith('\n') ? eol : ''
  const header = present.has('# Agent Pets local MCP config (contains local paths)') ? '' : `# Agent Pets local MCP config (contains local paths)${eol}`
  fs.mkdirSync(infoDir, { recursive: true })
  if (fs.lstatSync(infoDir).isSymbolicLink()) throw new Error('Refusing to edit an unsafe .git/info directory')
  writeTextAtomic(excludePath, `${existing}${separator}${header}${added.map(pattern => `/${pattern}`).join(eol)}${eol}`)
  return added
}
