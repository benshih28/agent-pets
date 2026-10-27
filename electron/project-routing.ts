import { createHash, randomBytes } from 'node:crypto'
import { lstatSync, mkdirSync, realpathSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, isAbsolute, normalize, parse, resolve, sep } from 'node:path'
import type {
  ProjectPetBindingStatus,
  ProjectPetView,
} from '../src/types/project-pet.ts'
import { isValidPetId } from '../src/utils/pet-id.ts'
import { StatementCache } from './sqlite-statements.ts'

type SqliteRow = Record<string, unknown>

interface SqliteStatement {
  run(...params: unknown[]): { changes: number | bigint }
  get(...params: unknown[]): SqliteRow | undefined
  all(...params: unknown[]): SqliteRow[]
}

interface SqliteDatabase {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
  close(): void
}

type DatabaseSyncConstructor = new (filePath: string) => SqliteDatabase

export interface ProjectIdentity {
  projectId: string
  displayName: string
}

export interface ProjectRoutingStoreOptions {
  now?: () => number
  defaultPetId?: string
}

export interface ProjectRoute {
  petId?: string
  fallback: boolean
}

const MAX_PROJECT_PATH_LENGTH = 4_096
const MAX_PROJECTS = 256
const MAX_DISPLAY_NAME_LENGTH = 96
const PROJECT_ID = /^[a-f0-9]{32}$/
const DEFAULT_PET_ID = 'aang-airbender'
// Every tool-call/state event on a session re-resolves the same raw path.
// Without this cache, each one would pay a synchronous lstat/realpath round
// trip on Electron's main thread just to recompute an already-known identity.
const MAX_PATH_CACHE = 512
// Same reasoning for the SQLite write side: last_seen_at only needs to move
// often enough for the project list to feel current, not on every event.
const TRACK_THROTTLE_MS = 30_000

function databaseConstructor(): DatabaseSyncConstructor {
  const moduleRequire = createRequire(import.meta.url)
  const loaded = moduleRequire('node:sqlite') as { DatabaseSync?: DatabaseSyncConstructor }
  if (!loaded.DatabaseSync) throw new Error('SQLite is unavailable in this runtime')
  return loaded.DatabaseSync
}

function asInteger(value: unknown, fallback = 0): number {
  const number = typeof value === 'bigint' ? Number(value) : Number(value)
  return Number.isSafeInteger(number) ? number : fallback
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32)
}

function safeDisplayName(value: string): string {
  const clean = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_DISPLAY_NAME_LENGTH)
  return clean || 'Project'
}

function safeProjectId(value: unknown): string | null {
  return typeof value === 'string' && PROJECT_ID.test(value) ? value : null
}

function safePetId(value: unknown): string | null {
  return isValidPetId(value, 128) ? value : null
}

interface CanonicalizedPath {
  path: string
  // False when the filesystem couldn't be consulted (missing/unreadable at
  // this moment) and the identity falls back to a normalized-but-unverified
  // form. Callers must not cache an unverified result: the same raw path can
  // resolve differently once the directory becomes reachable (e.g. through a
  // symlink/junction that didn't exist yet), and a cached miss would keep
  // returning the stale identity forever instead of self-healing.
  verified: boolean
}

function canonicalizeProjectPathVerbose(value: unknown): CanonicalizedPath | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PROJECT_PATH_LENGTH) return null
  if (!isAbsolute(value) || /[\u0000\r\n]/.test(value)) return null

  let candidate = resolve(normalize(value))
  let verified = false
  try {
    const stat = lstatSync(candidate)
    if (stat.isSymbolicLink()) {
      candidate = realpathSync.native(candidate)
      if (!statSync(candidate).isDirectory()) return null
      verified = true
    } else if (!stat.isDirectory()) {
      return null
    } else {
      candidate = realpathSync.native(candidate)
      verified = true
    }
  } catch {
    // A hook can arrive just after a workspace is removed. Keep the normalized
    // identity, but never attempt to read or write that path here.
  }

  candidate = normalize(candidate)
  const root = parse(candidate).root
  while (candidate.length > root.length && (candidate.endsWith(sep) || candidate.endsWith('/'))) {
    candidate = candidate.slice(0, -1)
  }
  return { path: process.platform === 'win32' ? candidate.toLowerCase() : candidate, verified }
}

/**
 * Resolve a project directory without persisting or returning its absolute
 * path. Existing junctions/symlinks are collapsed through realpath; missing
 * paths still receive a stable normalized identity so a stopped workspace can
 * be repaired later from the project picker.
 */
export function canonicalizeProjectPath(value: unknown): string | null {
  return canonicalizeProjectPathVerbose(value)?.path ?? null
}

function identityForPath(canonicalPath: string, salt: string): ProjectIdentity {
  return {
    projectId: digest(`agent-pets-project-v1:${salt}:${canonicalPath}`),
    displayName: safeDisplayName(basename(canonicalPath) || parse(canonicalPath).root),
  }
}

function changedCount(result: { changes: number | bigint }): number {
  return asInteger(result.changes)
}

export class ProjectRoutingStore {
  private readonly database: SqliteDatabase
  private readonly statements: StatementCache<SqliteStatement>
  private readonly now: () => number
  private readonly defaultPetId: string
  private readonly salt: string
  private closed = false
  private enabled: boolean
  private readonly pathCache = new Map<string, ProjectIdentity | null>()
  private readonly lastTrackedAt = new Map<string, number>()

  constructor(filePath: string, options: ProjectRoutingStoreOptions = {}) {
    mkdirSync(dirname(filePath), { recursive: true })
    const DatabaseSync = databaseConstructor()
    this.database = new DatabaseSync(filePath)
    this.statements = new StatementCache(sql => this.database.prepare(sql))
    this.now = options.now ?? Date.now
    this.defaultPetId = safePetId(options.defaultPetId) ?? DEFAULT_PET_ID
    try {
      this.migrate()
      const salt = this.statement('SELECT value FROM metadata WHERE key = ?').get('salt')?.value
      if (typeof salt !== 'string' || salt.length < 16) throw new Error('Project routing salt is invalid')
      this.salt = salt
      this.enabled = this.statement('SELECT value FROM metadata WHERE key = ?').get('enabled')?.value !== '0'
    } catch (error) {
      this.database.close()
      throw error
    }
  }

  isEnabled(): boolean {
    return this.enabled
  }

  setEnabled(value: boolean): void {
    this.enabled = value
    this.statement(`
      INSERT INTO metadata(key, value) VALUES ('enabled', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(value ? '1' : '0')
  }

  resolvePath(value: unknown): ProjectIdentity | null {
    if (!this.enabled) return null
    if (typeof value !== 'string') return this.resolvePathUncached(value)

    const cached = this.pathCache.get(value)
    if (cached !== undefined) {
      // 命中時移到 Map 尾端，讓插入順序等同最近使用順序（LRU），常用的
      // 工作區路徑不會因為偶發的新路徑而被擠出快取、重新觸發 fs 呼叫。
      this.pathCache.delete(value)
      this.pathCache.set(value, cached)
      return cached
    }

    const canonical = canonicalizeProjectPathVerbose(value)
    const identity = canonical ? identityForPath(canonical.path, this.salt) : null
    // Only a verified (filesystem-confirmed) resolution is stable enough to
    // cache. An unverified miss (directory not reachable right now) must be
    // retried on every call so it can self-heal once the path exists again.
    if (canonical?.verified || identity === null) {
      // 插入順序即最近使用順序，淘汰 Map 第一個 key 即為 O(1) LRU。
      if (this.pathCache.size >= MAX_PATH_CACHE) {
        const oldest = this.pathCache.keys().next().value
        if (oldest !== undefined) this.pathCache.delete(oldest)
      }
      this.pathCache.set(value, identity)
    }
    return identity
  }

  private resolvePathUncached(value: unknown): ProjectIdentity | null {
    const canonicalPath = canonicalizeProjectPath(value)
    return canonicalPath ? identityForPath(canonicalPath, this.salt) : null
  }

  registerPath(
    value: unknown,
    seenAt = this.now(),
    availablePetIds: ReadonlySet<string> = new Set<string>(),
  ): ProjectPetView | null {
    const identity = this.resolvePath(value)
    if (!identity || !Number.isSafeInteger(seenAt)) return null
    this.upsertProject(identity, seenAt)
    return this.getProject(identity.projectId, availablePetIds)
  }

  /**
   * Cheap per-event alternative to registerPath: resolves the identity (from
   * cache, no filesystem call on repeat paths) for routing purposes, and only
   * pays for the SQLite upsert when this project hasn't been written recently.
   * Live event ingestion and local-log usage scanning should call this
   * instead of registerPath, so both paths feed the same project list through
   * the exact same resolution logic and can never disagree on a project's id.
   */
  trackSeen(value: unknown, seenAt = this.now()): ProjectIdentity | null {
    const identity = this.resolvePath(value)
    if (!identity || !Number.isSafeInteger(seenAt)) return null
    const lastTracked = this.lastTrackedAt.get(identity.projectId)
    if (lastTracked === undefined || seenAt - lastTracked >= TRACK_THROTTLE_MS) {
      this.upsertProject(identity, seenAt)
    }
    return identity
  }

  private upsertProject(identity: ProjectIdentity, seenAt: number): void {
    this.transaction(() => {
      this.statement(`
        INSERT INTO projects(project_id, display_name, created_at, last_seen_at, archived_at)
        VALUES (?, ?, ?, ?, NULL)
        ON CONFLICT(project_id) DO UPDATE SET
          display_name = excluded.display_name,
          last_seen_at = excluded.last_seen_at,
          archived_at = NULL
      `).run(identity.projectId, identity.displayName, seenAt, seenAt)
    })
    this.lastTrackedAt.set(identity.projectId, seenAt)
  }

  listProjects(availablePetIds: ReadonlySet<string>): ProjectPetView[] {
    return this.statement(`
      SELECT projects.project_id, projects.display_name, projects.last_seen_at,
             project_pet_bindings.pet_id
      FROM projects
      LEFT JOIN project_pet_bindings ON project_pet_bindings.project_id = projects.project_id
      WHERE projects.archived_at IS NULL
      ORDER BY projects.last_seen_at DESC, projects.display_name COLLATE NOCASE ASC
      LIMIT ?
    `).all(MAX_PROJECTS).map(row => this.viewFromRow(row, availablePetIds))
  }

  getProject(projectId: string, availablePetIds: ReadonlySet<string> = new Set<string>()): ProjectPetView | null {
    const safeId = safeProjectId(projectId)
    if (!safeId) return null
    const row = this.statement(`
      SELECT projects.project_id, projects.display_name, projects.last_seen_at,
             project_pet_bindings.pet_id
      FROM projects
      LEFT JOIN project_pet_bindings ON project_pet_bindings.project_id = projects.project_id
      WHERE projects.project_id = ? AND projects.archived_at IS NULL
    `).get(safeId)
    return row ? this.viewFromRow(row, availablePetIds) : null
  }

  setBinding(projectId: string, petId: string | null, availablePetIds: ReadonlySet<string>): ProjectPetView | null {
    const safeProject = safeProjectId(projectId)
    if (!safeProject) return null
    if (petId !== null && (!safePetId(petId) || !availablePetIds.has(petId))) return null
    const project = this.getProject(safeProject, availablePetIds)
    if (!project) return null
    this.transaction(() => {
      if (petId === null) {
        this.statement('DELETE FROM project_pet_bindings WHERE project_id = ?').run(safeProject)
      } else {
        const timestamp = this.now()
        this.statement(`
          INSERT INTO project_pet_bindings(project_id, pet_id, created_at, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(project_id) DO UPDATE SET pet_id = excluded.pet_id, updated_at = excluded.updated_at
        `).run(safeProject, petId, timestamp, timestamp)
      }
    })
    return this.getProject(safeProject, availablePetIds)
  }

  route(projectId: string | undefined, availablePetIds: ReadonlySet<string>): ProjectRoute {
    const safeProject = safeProjectId(projectId)
    if (!safeProject) return { fallback: false }
    const petId = safePetId(this.statement(
      'SELECT pet_id FROM project_pet_bindings WHERE project_id = ?',
    ).get(safeProject)?.pet_id)
    if (!petId) return { fallback: false }
    if (availablePetIds.has(petId)) return { petId, fallback: false }
    return { petId: this.defaultPetId, fallback: true }
  }

  archiveProject(projectId: string): boolean {
    const safeProject = safeProjectId(projectId)
    if (!safeProject) return false
    return changedCount(this.statement(
      'UPDATE projects SET archived_at = ? WHERE project_id = ? AND archived_at IS NULL',
    ).run(this.now(), safeProject)) > 0
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.statements.clear()
    this.database.close()
  }

  private viewFromRow(row: SqliteRow, availablePetIds: ReadonlySet<string>): ProjectPetView {
    const projectId = safeProjectId(row.project_id) ?? ''
    const boundPetId = safePetId(row.pet_id)
    const bindingStatus: ProjectPetBindingStatus = !boundPetId
      ? 'unbound'
      : availablePetIds.has(boundPetId) ? 'bound' : 'missing-pet'
    return {
      projectId,
      displayName: safeDisplayName(typeof row.display_name === 'string' ? row.display_name : 'Project'),
      bindingStatus,
      lastSeenAt: Math.max(0, asInteger(row.last_seen_at)),
      ...(boundPetId ? { boundPetId } : {}),
    }
  }

  private migrate(): void {
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS schema_migrations(
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL,
        checksum TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS metadata(
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS projects(
        project_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        archived_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS project_pet_bindings(
        project_id TEXT PRIMARY KEY REFERENCES projects(project_id) ON DELETE CASCADE,
        pet_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `)
    const existingSalt = this.statement('SELECT value FROM metadata WHERE key = ?').get('salt')?.value
    if (typeof existingSalt !== 'string' || existingSalt.length < 16) {
      this.transaction(() => {
        this.statement(`
          INSERT INTO metadata(key, value) VALUES ('salt', ?)
          ON CONFLICT(key) DO NOTHING
        `).run(randomBytes(16).toString('hex'))
      })
    }
    const hasV1 = Boolean(this.statement('SELECT version FROM schema_migrations WHERE version = 1').get())
    if (!hasV1) this.transaction(() => {
      this.statement(`
        INSERT INTO schema_migrations(version, name, applied_at, checksum)
        VALUES (1, 'project-routing-v1', ?, 'project-routing-v1')
      `).run(this.now())
    })
  }

  private statement(sql: string): SqliteStatement {
    return this.statements.get(sql)
  }

  private transaction<T>(work: () => T): T {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const result = work()
      this.database.exec('COMMIT')
      return result
    } catch (error) {
      try { this.database.exec('ROLLBACK') } catch {}
      throw error
    }
  }
}
