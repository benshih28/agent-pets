import * as fs from 'node:fs'
import * as path from 'node:path'
import { renameSyncWithRetry } from './fs-rename.ts'
import type {
  ProjectMcpProjectRecord,
  ProjectMcpRegistrySnapshot,
  ProjectMcpSetupSummary,
} from '../src/types/project-mcp.ts'
import { inspectProjectMcp, type ProjectMcpInstallOptions } from './project-mcp-setup.ts'

const MAX_REGISTRY_BYTES = 64 * 1024
const MAX_PROJECTS = 128

interface StoredProjectMcpEntry {
  projectPath: string
  registeredAt: string
  lastCheckedAt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isSafeAbsolutePath(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 4_096
    && path.isAbsolute(value)
    && !/[\u0000\r\n]/.test(value)
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left)
  const normalizedRight = path.resolve(right)
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

function isRegularDirectory(directoryPath: string): boolean {
  try {
    const stat = fs.lstatSync(directoryPath)
    return stat.isDirectory() && !stat.isSymbolicLink()
  } catch {
    return false
  }
}

function projectName(projectPath: string): string {
  return path.basename(projectPath) || projectPath
}

function highLevelStatus(
  summary: ProjectMcpSetupSummary,
): ProjectMcpProjectRecord['status'] {
  const statuses = summary.results.map(result => result.status)
  if (statuses.some(status => status === 'error')) return 'error'
  if (statuses.some(status => status === 'conflict')) return 'conflict'
  if (statuses.every(status => status === 'already_configured')) return 'connected'
  return 'partial'
}

function safeStoredEntry(value: unknown): StoredProjectMcpEntry | null {
  if (!isRecord(value) || !isSafeAbsolutePath(value.projectPath)) return null
  const registeredAt = typeof value.registeredAt === 'string' ? value.registeredAt : ''
  const lastCheckedAt = typeof value.lastCheckedAt === 'string' ? value.lastCheckedAt : registeredAt
  if (!registeredAt || !lastCheckedAt) return null
  return { projectPath: path.resolve(value.projectPath), registeredAt, lastCheckedAt }
}

function readStoredEntries(filePath: string): StoredProjectMcpEntry[] {
  if (!fs.existsSync(filePath)) return []
  const stat = fs.lstatSync(filePath)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_REGISTRY_BYTES) {
    throw new Error('Project MCP registry is not a regular file or is too large')
  }
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown
  if (!Array.isArray(raw)) throw new Error('Project MCP registry must contain an array')
  const entries: StoredProjectMcpEntry[] = []
  for (const value of raw.slice(0, MAX_PROJECTS)) {
    const entry = safeStoredEntry(value)
    if (entry && !entries.some(existing => samePath(existing.projectPath, entry.projectPath))) {
      entries.push(entry)
    }
  }
  return entries
}

function writeStoredEntries(filePath: string, entries: StoredProjectMcpEntry[]): void {
  const directory = path.dirname(filePath)
  fs.mkdirSync(directory, { recursive: true })
  if (fs.existsSync(filePath)) {
    const stat = fs.lstatSync(filePath)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error('Refusing to replace an unsafe project MCP registry file')
    }
  }
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  )
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(entries, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
    renameSyncWithRetry(temporaryPath, filePath)
    if (process.platform !== 'win32') {
      try { fs.chmodSync(filePath, 0o600) } catch {}
    }
  } catch (error) {
    try { fs.rmSync(temporaryPath, { force: true }) } catch {}
    throw error
  }
}

export interface ProjectMcpRegistryStoreOptions {
  now?: () => string
}

export class ProjectMcpRegistryStore {
  private readonly filePath: string
  private readonly now: () => string

  constructor(filePath: string, options: ProjectMcpRegistryStoreOptions = {}) {
    this.filePath = filePath
    this.now = options.now ?? (() => new Date().toISOString())
  }

  private entries(): StoredProjectMcpEntry[] {
    return readStoredEntries(this.filePath)
  }

  register(projectPath: string): void {
    if (!isSafeAbsolutePath(projectPath)) throw new Error('Project MCP registry path must be absolute')
    const resolved = path.resolve(projectPath)
    const entries = this.entries()
    const current = entries.find(entry => samePath(entry.projectPath, resolved))
    const timestamp = this.now()
    const next = current
      ? entries.map(entry => samePath(entry.projectPath, resolved)
        ? { ...entry, projectPath: resolved, lastCheckedAt: timestamp }
        : entry)
      : [
          ...entries,
          { projectPath: resolved, registeredAt: timestamp, lastCheckedAt: timestamp },
        ]
    if (next.length > MAX_PROJECTS) throw new Error(`Project MCP registry supports at most ${MAX_PROJECTS} projects`)
    writeStoredEntries(this.filePath, next)
  }

  forget(projectPath: string): boolean {
    if (!isSafeAbsolutePath(projectPath)) return false
    const resolved = path.resolve(projectPath)
    const entries = this.entries()
    const next = entries.filter(entry => !samePath(entry.projectPath, resolved))
    if (next.length === entries.length) return false
    writeStoredEntries(this.filePath, next)
    return true
  }

  list(options: ProjectMcpInstallOptions): ProjectMcpRegistrySnapshot {
    const entries = this.entries()
    const projects: ProjectMcpProjectRecord[] = []
    const timestamp = this.now()
    let changed = false

    for (const entry of entries) {
      if (!isRegularDirectory(entry.projectPath)) {
        projects.push({
          projectPath: entry.projectPath,
          projectName: projectName(entry.projectPath),
          registeredAt: entry.registeredAt,
          lastCheckedAt: entry.lastCheckedAt,
          status: 'missing',
          results: [],
        })
        continue
      }

      let summary: ProjectMcpSetupSummary
      try {
        summary = inspectProjectMcp(entry.projectPath, options)
      } catch (error) {
        projects.push({
          projectPath: entry.projectPath,
          projectName: projectName(entry.projectPath),
          registeredAt: entry.registeredAt,
          lastCheckedAt: timestamp,
          status: 'error',
          results: [],
        })
        changed = true
        continue
      }
      projects.push({
        projectPath: summary.projectPath ?? entry.projectPath,
        projectName: projectName(summary.projectPath ?? entry.projectPath),
        registeredAt: entry.registeredAt,
        lastCheckedAt: timestamp,
        status: highLevelStatus(summary),
        results: summary.results,
      })
      changed = true
    }

    if (changed) {
      const checkedByPath = new Map(projects.map(project => [project.projectPath, project.lastCheckedAt]))
      writeStoredEntries(this.filePath, entries.map(entry => ({
        ...entry,
        lastCheckedAt: checkedByPath.get(entry.projectPath) ?? entry.lastCheckedAt,
      })))
    }

    return { ok: true, projects }
  }
}
