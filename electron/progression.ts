import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AgentStatusEvent, AgentState } from '../src/types/agent'
import { isValidPetId } from '../src/utils/pet-id.ts'
import {
  ACTIVE_CODING_INTERVAL_MS,
  ACTIVE_CODING_MAX_POINTS_PER_SESSION,
  progressionForTotalXp,
  XP_POLICY_VERSION,
  XP_RULES,
  type ProgressionAward,
  type ProgressionEventResult,
  type ProgressionSnapshot,
} from '../src/types/progression.ts'
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

export interface ProgressionStoreOptions {
  defaultPetId?: string
  now?: () => number
  localDate?: (timestamp: number) => string
}

interface ProgressRow {
  petId: string
  totalXp: number
  currentStreak: number
  longestStreak: number
  lastActiveLocalDate?: string
  updatedAt: number
}

interface ActivityRow {
  activeMs: number
  awardedPoints: number
  lastState: AgentState
  lastSeenAt: number
}

const DEFAULT_PET_ID = 'aang-airbender'
const MAX_PET_ID_LENGTH = 128
const MAX_SESSION_KEY_LENGTH = 600
const MAX_ACTIVE_GAP_MS = 5 * 60 * 1000
const ACTIVE_STATES = new Set<AgentState>(['thinking', 'tool-running'])

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

function isAgentState(value: unknown): value is AgentState {
  return value === 'offline'
    || value === 'idle'
    || value === 'thinking'
    || value === 'tool-running'
    || value === 'waiting-permission'
    || value === 'waiting-input'
    || value === 'success'
    || value === 'error'
}

function normalizePetId(value: string | undefined, fallback: string): string {
  if (isValidPetId(value, MAX_PET_ID_LENGTH)) return value
  return fallback
}

function localDateKey(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function previousLocalDate(key: string): string {
  const date = new Date(`${key}T12:00:00`)
  date.setDate(date.getDate() - 1)
  return localDateKey(date.getTime())
}

function isActiveState(state: AgentState | undefined): boolean {
  return state !== undefined && ACTIVE_STATES.has(state)
}

function changedCount(result: { changes: number | bigint }): number {
  return asInteger(result.changes)
}

export class ProgressionStore {
  private readonly database: SqliteDatabase
  private readonly statements: StatementCache<SqliteStatement>
  private readonly now: () => number
  private readonly localDate: (timestamp: number) => string
  private readonly defaultPetId: string
  private activePetId: string
  private closed = false

  constructor(filePath: string, options: ProgressionStoreOptions = {}) {
    mkdirSync(dirname(filePath), { recursive: true })
    const DatabaseSync = databaseConstructor()
    this.database = new DatabaseSync(filePath)
    this.statements = new StatementCache(sql => this.database.prepare(sql))
    this.now = options.now ?? Date.now
    this.localDate = options.localDate ?? localDateKey
    this.defaultPetId = normalizePetId(options.defaultPetId, DEFAULT_PET_ID)
    this.activePetId = this.defaultPetId
    try {
      this.migrate()
      this.ensurePet(this.defaultPetId)
    } catch (error) {
      this.database.close()
      throw error
    }
  }

  setActivePet(petId: string): ProgressionSnapshot {
    this.activePetId = normalizePetId(petId, this.defaultPetId)
    this.ensurePet(this.activePetId)
    return this.getSnapshot(this.activePetId)
  }

  getActivePetId(): string {
    return this.activePetId
  }

  getSnapshot(petId = this.activePetId): ProgressionSnapshot {
    const safePetId = normalizePetId(petId, this.defaultPetId)
    this.ensurePet(safePetId)
    return this.snapshotFromRow(this.readProgress(safePetId))
  }

  handleEvent(event: AgentStatusEvent, routedPetId?: string): ProgressionEventResult {
    const occurredAt = Number.isFinite(event.timestamp) ? event.timestamp : this.now()
    const petId = normalizePetId(routedPetId ?? event.routedPetId, this.activePetId)
    if (event.originalEvent === 'AgentPetsIntegrationTest') {
      return { snapshot: this.getSnapshot(petId), awards: [] }
    }

    const awards = this.transaction(() => {
      this.ensurePet(petId)
      const routeKey = event.projectId || petId
      const sessionKey = `${event.source}:${event.sessionId}:${routeKey}:${petId}`.slice(0, MAX_SESSION_KEY_LENGTH)
      const previous = this.readActivity(sessionKey)
      let activeMs = previous?.activeMs ?? 0
      if (previous && occurredAt > previous.lastSeenAt && isActiveState(previous.lastState)) {
        activeMs += Math.min(occurredAt - previous.lastSeenAt, MAX_ACTIVE_GAP_MS)
      }

      const nextState = isAgentState(event.state) ? event.state : 'idle'
      const nextLastSeenAt = previous ? Math.max(previous.lastSeenAt, occurredAt) : occurredAt
      this.writeActivity(sessionKey, {
        activeMs,
        awardedPoints: previous?.awardedPoints ?? 0,
        lastState: nextState,
        lastSeenAt: nextLastSeenAt,
      })

      const result: ProgressionAward[] = []
      this.awardObservedActiveTime(
        petId,
        sessionKey,
        activeMs,
        previous?.awardedPoints ?? 0,
        occurredAt,
        result,
      )
      if (event.state === 'success') {
        this.awardCompletion(petId, event, occurredAt, result)
      }
      return result
    })

    return { snapshot: this.getSnapshot(petId), awards }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.statements.clear()
    this.database.close()
  }

  private migrate(): void {
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL,
        checksum TEXT NOT NULL
      );
    `)

    const migration = this.statement('SELECT version FROM schema_migrations WHERE version = 1').get()
    if (!migration) this.transaction(() => {
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS pets (
          pet_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          sprite_id TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          is_default INTEGER NOT NULL CHECK(is_default IN (0, 1)),
          archived_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS pet_progress (
          pet_id TEXT PRIMARY KEY REFERENCES pets(pet_id),
          total_xp INTEGER NOT NULL DEFAULT 0 CHECK(total_xp >= 0),
          current_streak INTEGER NOT NULL DEFAULT 0 CHECK(current_streak >= 0),
          longest_streak INTEGER NOT NULL DEFAULT 0 CHECK(longest_streak >= 0),
          last_active_local_date TEXT,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS xp_ledger (
          ledger_id TEXT PRIMARY KEY,
          pet_id TEXT NOT NULL REFERENCES pets(pet_id),
          event_id TEXT,
          rule_id TEXT NOT NULL,
          idempotency_key TEXT NOT NULL UNIQUE,
          amount INTEGER NOT NULL CHECK(amount > 0),
          occurred_at INTEGER NOT NULL,
          local_date TEXT NOT NULL,
          metadata_json TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_xp_ledger_pet_date
          ON xp_ledger(pet_id, local_date);
        CREATE TABLE IF NOT EXISTS xp_session_activity (
          session_key TEXT PRIMARY KEY,
          active_ms INTEGER NOT NULL DEFAULT 0 CHECK(active_ms >= 0),
          awarded_points INTEGER NOT NULL DEFAULT 0 CHECK(awarded_points >= 0),
          last_state TEXT NOT NULL,
          last_seen_at INTEGER NOT NULL
        );
      `)
      this.statement(
        `INSERT OR IGNORE INTO schema_migrations(version, name, applied_at, checksum)
         VALUES (1, 'progression-v1', ?, ?)`,
      ).run(this.now(), XP_POLICY_VERSION)
      this.statement(
        `UPDATE schema_migrations SET applied_at = ?, checksum = ? WHERE version = 1`,
      ).run(this.now(), XP_POLICY_VERSION)
    })

    // v2 scopes idempotency to each pet. Without this, a first completion on
    // one routed project consumes the same daily reward for every other pet.
    const hasV2 = Boolean(this.statement('SELECT version FROM schema_migrations WHERE version = 2').get())
    if (!hasV2) this.transaction(() => {
      this.statement(`
        UPDATE xp_ledger
        SET idempotency_key = pet_id || ':' || idempotency_key
        WHERE idempotency_key NOT LIKE pet_id || ':%'
      `).run()
      this.statement(
        `INSERT INTO schema_migrations(version, name, applied_at, checksum)
         VALUES (2, 'progression-pet-idempotency', ?, ?)`,
      ).run(this.now(), `${XP_POLICY_VERSION}-pet-idempotency`)
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

  private ensurePet(petId: string): void {
    const now = this.now()
    this.statement(`
      INSERT OR IGNORE INTO pets(pet_id, name, sprite_id, created_at, is_default)
      VALUES (?, ?, ?, ?, ?)
    `).run(petId, petId, petId, now, petId === this.defaultPetId ? 1 : 0)
    this.statement(`
      INSERT OR IGNORE INTO pet_progress(pet_id, updated_at)
      VALUES (?, ?)
    `).run(petId, now)
  }

  private readProgress(petId: string): ProgressRow {
    const row = this.statement(`
      SELECT pet_id, total_xp, current_streak, longest_streak, last_active_local_date, updated_at
      FROM pet_progress WHERE pet_id = ?
    `).get(petId)
    return {
      petId,
      totalXp: Math.max(0, asInteger(row?.total_xp)),
      currentStreak: Math.max(0, asInteger(row?.current_streak)),
      longestStreak: Math.max(0, asInteger(row?.longest_streak)),
      ...(typeof row?.last_active_local_date === 'string' ? { lastActiveLocalDate: row.last_active_local_date } : {}),
      updatedAt: asInteger(row?.updated_at, this.now()),
    }
  }

  private snapshotFromRow(row: ProgressRow): ProgressionSnapshot {
    return progressionForTotalXp(
      row.petId,
      row.totalXp,
      row.currentStreak,
      row.longestStreak,
      row.lastActiveLocalDate,
      row.updatedAt,
    )
  }

  private readActivity(sessionKey: string): ActivityRow | null {
    const row = this.statement(`
      SELECT active_ms, awarded_points, last_state, last_seen_at
      FROM xp_session_activity WHERE session_key = ?
    `).get(sessionKey)
    if (!row || !isAgentState(row.last_state)) return null
    return {
      activeMs: Math.max(0, asInteger(row.active_ms)),
      awardedPoints: Math.max(0, asInteger(row.awarded_points)),
      lastState: row.last_state,
      lastSeenAt: Math.max(0, asInteger(row.last_seen_at)),
    }
  }

  private writeActivity(sessionKey: string, activity: ActivityRow): void {
    this.statement(`
      INSERT INTO xp_session_activity(session_key, active_ms, awarded_points, last_state, last_seen_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(session_key) DO UPDATE SET
        active_ms = excluded.active_ms,
        awarded_points = excluded.awarded_points,
        last_state = excluded.last_state,
        last_seen_at = excluded.last_seen_at
    `).run(
      sessionKey,
      activity.activeMs,
      activity.awardedPoints,
      activity.lastState,
      activity.lastSeenAt,
    )
  }

  private awardObservedActiveTime(
    petId: string,
    sessionKey: string,
    activeMs: number,
    alreadyAwarded: number,
    occurredAt: number,
    awards: ProgressionAward[],
  ): void {
    const intervals = Math.min(
      ACTIVE_CODING_MAX_POINTS_PER_SESSION / XP_RULES.activeCodingThirtyMinutes,
      Math.floor(activeMs / ACTIVE_CODING_INTERVAL_MS),
    )
    let awardedPoints = alreadyAwarded
    for (let interval = Math.floor(alreadyAwarded / XP_RULES.activeCodingThirtyMinutes) + 1; interval <= intervals; interval += 1) {
      const ruleId = `${XP_POLICY_VERSION}.active-time`
      const key = `active:${sessionKey}:${interval}`
      if (this.insertAward(petId, ruleId, key, XP_RULES.activeCodingThirtyMinutes, occurredAt, undefined, { interval })) {
        awardedPoints += XP_RULES.activeCodingThirtyMinutes
        awards.push({ ruleId, amount: XP_RULES.activeCodingThirtyMinutes })
      }
    }
    if (awardedPoints !== alreadyAwarded) {
      this.statement(
        'UPDATE xp_session_activity SET awarded_points = ? WHERE session_key = ?',
      ).run(awardedPoints, sessionKey)
    }
  }

  private awardCompletion(
    petId: string,
    event: AgentStatusEvent,
    occurredAt: number,
    awards: ProgressionAward[],
  ): void {
    // Include the canonical project route so identical session IDs from two
    // workspaces cannot suppress one another's completion XP.
    const sessionKey = `${event.source}:${event.sessionId}:${event.projectId ?? 'unbound'}`.slice(0, MAX_SESSION_KEY_LENGTH)
    const date = this.localDate(occurredAt)
    const completedRule = `${XP_POLICY_VERSION}.session-completed`
    if (this.insertAward(petId, completedRule, `completed:${sessionKey}`, XP_RULES.sessionCompleted, occurredAt, event.source)) {
      awards.push({ ruleId: completedRule, amount: XP_RULES.sessionCompleted })
    }

    const firstRule = `${XP_POLICY_VERSION}.first-completion-of-day`
    if (this.insertAward(petId, firstRule, `first-completion:${date}`, XP_RULES.firstCompletionOfDay, occurredAt, event.source, { date })) {
      awards.push({ ruleId: firstRule, amount: XP_RULES.firstCompletionOfDay })
    }

    const progress = this.readProgress(petId)
    if (progress.lastActiveLocalDate === date) return

    const continued = progress.lastActiveLocalDate === previousLocalDate(date)
    const nextStreak = continued ? progress.currentStreak + 1 : 1
    const streakRule = `${XP_POLICY_VERSION}.daily-streak`
    if (continued && this.insertAward(petId, streakRule, `streak:${date}`, XP_RULES.dailyStreak, occurredAt, event.source, { date })) {
      awards.push({ ruleId: streakRule, amount: XP_RULES.dailyStreak })
    }
    this.statement(`
      UPDATE pet_progress
      SET current_streak = ?,
          longest_streak = MAX(longest_streak, ?),
          last_active_local_date = ?,
          updated_at = ?
      WHERE pet_id = ?
    `).run(nextStreak, nextStreak, date, occurredAt, petId)
  }

  private insertAward(
    petId: string,
    ruleId: string,
    idempotencyKey: string,
    amount: number,
    occurredAt: number,
    eventId?: string,
    metadata?: Record<string, unknown>,
  ): boolean {
    const scopedIdempotencyKey = `${petId}:${idempotencyKey}`
    const inserted = changedCount(this.statement(`
      INSERT OR IGNORE INTO xp_ledger(
        ledger_id, pet_id, event_id, rule_id, idempotency_key, amount, occurred_at, local_date, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `${petId}:${ruleId}:${idempotencyKey}`,
      petId,
      eventId ?? null,
      ruleId,
      scopedIdempotencyKey,
      amount,
      occurredAt,
      this.localDate(occurredAt),
      metadata ? JSON.stringify(metadata) : null,
    ))
    if (inserted === 0) return false

    this.statement(`
      UPDATE pet_progress
      SET total_xp = total_xp + ?, updated_at = ?
      WHERE pet_id = ?
    `).run(amount, occurredAt, petId)
    return true
  }
}
