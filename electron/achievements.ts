import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createRequire } from 'node:module'
import type { AgentStatusEvent } from '../src/types/agent.ts'
import { isValidPetId } from '../src/utils/pet-id.ts'
import type { ProgressionSnapshot } from '../src/types/progression.ts'
import {
  ACHIEVEMENT_DEFINITIONS,
  evaluateAchievements,
  type AchievementEvaluationContext,
  type AchievementId,
  type AchievementSnapshot,
  type AchievementTokenQuality,
  type AchievementUnlock,
} from '../src/types/achievement.ts'
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

export interface AchievementStoreOptions {
  now?: () => number
  localDate?: (timestamp: number) => string
  localHour?: (timestamp: number) => number
}

export interface AchievementCompletedSessionFact {
  petId: string
  source: string
  sessionId: string
  projectId?: string
  adapterId: string
  completedAt: number
}

const DEFAULT_PET_ID = 'aang-airbender'
const PROJECT_ID = /^[a-f0-9]{32}$/
const ADAPTER_ID = /^[A-Za-z0-9._-]{1,128}$/
const MAX_EVENT_ID_LENGTH = 256
const MAX_TOKEN_COUNT = 1_000_000_000_000

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

function changedCount(result: { changes: number | bigint }): number {
  return Math.max(0, asInteger(result.changes))
}

function digest(value: string, length = 48): string {
  return createHash('sha256').update(value).digest('hex').slice(0, length)
}

function safePetId(value: unknown): string {
  return isValidPetId(value, 128) ? value : DEFAULT_PET_ID
}

function safeAdapterId(value: unknown): string {
  if (typeof value === 'string' && ADAPTER_ID.test(value)) return value
  return 'unknown'
}

function safeEventId(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null
  return value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, MAX_EVENT_ID_LENGTH) || null
}

function safeToken(value: unknown): number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_TOKEN_COUNT
    ? value
    : 0
}

function safeQuality(value: unknown): Exclude<AchievementTokenQuality, 'none'> | null {
  return value === 'exact' || value === 'estimated' ? value : null
}

function eventTimestamp(event: AgentStatusEvent, fallback: number): number {
  return Number.isFinite(event.timestamp) ? event.timestamp : fallback
}

function eventProjectId(event: AgentStatusEvent): string {
  return typeof event.projectId === 'string' && PROJECT_ID.test(event.projectId)
    ? event.projectId
    : 'unbound'
}

function eventAdapterId(event: AgentStatusEvent): string {
  return safeAdapterId(event.adapterId ?? event.source)
}

function completedSessionKey(
  source: string,
  sessionId: string,
  projectId: string,
  petId: string,
): string {
  return digest([
    'session-v1',
    petId,
    source,
    sessionId.slice(0, MAX_EVENT_ID_LENGTH),
    projectId,
  ].join(':'))
}

function eventSessionKey(event: AgentStatusEvent, petId: string): string {
  return completedSessionKey(event.source, event.sessionId, eventProjectId(event), petId)
}

function eventTokenKey(event: AgentStatusEvent, petId: string): string {
  const explicit = safeEventId(event.sourceEventId) ?? safeEventId(event.eventId)
  if (explicit) return digest(`token-v1:${petId}:${event.source}:${explicit}`)
  return digest([
    'token-v1',
    petId,
    event.source,
    event.sessionId.slice(0, MAX_EVENT_ID_LENGTH),
    eventProjectId(event),
    event.state,
    String(event.timestamp),
  ].join(':'))
}

function defaultLocalDate(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function defaultLocalHour(timestamp: number): number {
  return new Date(timestamp).getHours()
}

function rowQuality(row: SqliteRow | undefined): AchievementTokenQuality {
  if (!row || asInteger(row.total) <= 0) return 'none'
  return asInteger(row.estimated) > 0 ? 'estimated' : 'exact'
}

export class AchievementStore {
  private readonly database: SqliteDatabase
  private readonly statements: StatementCache<SqliteStatement>
  private readonly now: () => number
  private readonly localDate: (timestamp: number) => string
  private readonly localHour: (timestamp: number) => number
  private closed = false

  constructor(filePath: string, options: AchievementStoreOptions = {}) {
    mkdirSync(dirname(filePath), { recursive: true })
    const DatabaseSync = databaseConstructor()
    this.database = new DatabaseSync(filePath)
    this.statements = new StatementCache(sql => this.database.prepare(sql))
    this.now = options.now ?? Date.now
    this.localDate = options.localDate ?? defaultLocalDate
    this.localHour = options.localHour ?? defaultLocalHour
    try {
      this.migrate()
    } catch (error) {
      this.database.close()
      throw error
    }
  }

  recordEvent(
    event: AgentStatusEvent,
    petIdValue: string,
    progression?: ProgressionSnapshot,
  ): AchievementUnlock[] {
    if (
      event.originalEvent === 'AgentPetsIntegrationTest'
      || (event.state !== 'success' && event.tokenUsage === undefined)
    ) return []
    const petId = safePetId(petIdValue)
    const occurredAt = eventTimestamp(event, this.now())
    return this.transaction(() => {
      let completed = false
      let nightOwlCompletion = false

      if (event.state === 'success') {
        const sessionKey = eventSessionKey(event, petId)
        completed = changedCount(this.statement(`
          INSERT OR IGNORE INTO completed_sessions(
            session_key, pet_id, local_date, adapter_id, completed_at
          ) VALUES (?, ?, ?, ?, ?)
        `).run(
          sessionKey,
          petId,
          this.localDate(occurredAt),
          eventAdapterId(event),
          occurredAt,
        )) > 0

        if (completed) {
          this.statement(`
            INSERT INTO daily_completions(pet_id, local_date, sessions_completed)
            VALUES (?, ?, 1)
            ON CONFLICT(pet_id, local_date) DO UPDATE SET
              sessions_completed = daily_completions.sessions_completed + 1
          `).run(petId, this.localDate(occurredAt))
          this.statement(
            'INSERT OR IGNORE INTO active_days(pet_id, local_date) VALUES (?, ?)',
          ).run(petId, this.localDate(occurredAt))
          this.statement(
            'INSERT OR IGNORE INTO adapter_usage(pet_id, adapter_id) VALUES (?, ?)',
          ).run(petId, eventAdapterId(event))
        }
        nightOwlCompletion = this.localHour(occurredAt) >= 0 && this.localHour(occurredAt) < 5
      }

      let tokenRecorded = false
      const quality = safeQuality(event.tokenUsage?.quality)
      if (quality) {
        const tokenUsage = event.tokenUsage
        tokenRecorded = changedCount(this.statement(`
          INSERT OR IGNORE INTO token_usage(
            token_event_id, pet_id, adapter_id, occurred_at, input_tokens, output_tokens, quality
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          eventTokenKey(event, petId),
          petId,
          eventAdapterId(event),
          occurredAt,
          safeToken(tokenUsage?.input),
          safeToken(tokenUsage?.output),
          quality,
        )) > 0
      }

      if (!completed && !tokenRecorded && event.state !== 'success') return []
      return this.evaluateAndUnlock(petId, occurredAt, nightOwlCompletion, progression)
    })
  }

  reconcileCompletedSessions(
    facts: readonly AchievementCompletedSessionFact[],
    progressionForPet?: (petId: string) => ProgressionSnapshot | undefined,
  ): AchievementUnlock[] {
    return this.transaction(() => {
      const touchedPets = new Map<string, { occurredAt: number; nightOwlCompletion: boolean }>()
      for (const fact of facts) {
        const petId = safePetId(fact.petId)
        const source = safeAdapterId(fact.source)
        const sessionId = safeEventId(fact.sessionId)
        const adapterId = safeAdapterId(fact.adapterId)
        const completedAt = Number.isFinite(fact.completedAt) ? fact.completedAt : this.now()
        if (!sessionId) continue
        const projectId = typeof fact.projectId === 'string' && PROJECT_ID.test(fact.projectId)
          ? fact.projectId
          : 'unbound'
        const sessionKey = completedSessionKey(source, sessionId, projectId, petId)
        const inserted = changedCount(this.statement(`
          INSERT OR IGNORE INTO completed_sessions(
            session_key, pet_id, local_date, adapter_id, completed_at
          ) VALUES (?, ?, ?, ?, ?)
        `).run(
          sessionKey,
          petId,
          this.localDate(completedAt),
          adapterId,
          completedAt,
        )) > 0
        if (!inserted) continue
        this.statement(`
          INSERT INTO daily_completions(pet_id, local_date, sessions_completed)
          VALUES (?, ?, 1)
          ON CONFLICT(pet_id, local_date) DO UPDATE SET
            sessions_completed = daily_completions.sessions_completed + 1
        `).run(petId, this.localDate(completedAt))
        this.statement(
          'INSERT OR IGNORE INTO active_days(pet_id, local_date) VALUES (?, ?)',
        ).run(petId, this.localDate(completedAt))
        this.statement(
          'INSERT OR IGNORE INTO adapter_usage(pet_id, adapter_id) VALUES (?, ?)',
        ).run(petId, adapterId)
        const previous = touchedPets.get(petId)
        touchedPets.set(petId, {
          occurredAt: Math.max(previous?.occurredAt ?? 0, completedAt),
          nightOwlCompletion: Boolean(previous?.nightOwlCompletion)
            || (this.localHour(completedAt) >= 0 && this.localHour(completedAt) < 5),
        })
      }

      const unlocks: AchievementUnlock[] = []
      for (const [petId, context] of touchedPets) {
        unlocks.push(...this.evaluateAndUnlock(
          petId,
          context.occurredAt,
          context.nightOwlCompletion,
          progressionForPet?.(petId),
        ))
      }
      return unlocks
    })
  }

  getSnapshot(petIdValue: string): AchievementSnapshot {
    const petId = safePetId(petIdValue)
    const rows = this.statement(`
      SELECT achievement_id, version, unlocked_at, token_quality
      FROM achievement_unlocks
      WHERE pet_id = ?
      ORDER BY unlocked_at ASC
    `).all(petId)
    const unlocked = new Map<AchievementId, SqliteRow>()
    for (const row of rows) {
      const id = row.achievement_id
      if (typeof id === 'string' && ACHIEVEMENT_DEFINITIONS.some(definition => definition.id === id)) {
        unlocked.set(id as AchievementId, row)
      }
    }
    return {
      schemaVersion: 1,
      generatedAt: this.now(),
      petId,
      totalUnlocked: unlocked.size,
      achievements: ACHIEVEMENT_DEFINITIONS.map(definition => {
        const row = unlocked.get(definition.id)
        const unlockedAt = row ? asInteger(row.unlocked_at) : 0
        const tokenQuality = row ? (safeQuality(row.token_quality) ?? 'none') : 'none'
        return {
          id: definition.id,
          version: definition.version,
          titleKey: definition.titleKey,
          descriptionKey: definition.descriptionKey,
          visualReward: definition.visualReward,
          unlocked: Boolean(row),
          ...(unlockedAt > 0 ? { unlockedAt } : {}),
          tokenQuality,
        }
      }),
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.statements.clear()
    this.database.close()
  }

  private evaluateAndUnlock(
    petId: string,
    occurredAt: number,
    nightOwlCompletion: boolean,
    progression?: ProgressionSnapshot,
  ): AchievementUnlock[] {
    const context = this.readContext(petId, this.localDate(occurredAt), nightOwlCompletion, progression)
    const unlocks: AchievementUnlock[] = []
    for (const evaluation of evaluateAchievements(context)) {
      const definition = ACHIEVEMENT_DEFINITIONS.find(candidate => candidate.id === evaluation.id)
      if (!definition) continue
      const tokenQuality = evaluation.tokenQuality ?? 'none'
      const unlockedAt = this.now()
      const inserted = changedCount(this.statement(`
        INSERT OR IGNORE INTO achievement_unlocks(
          pet_id, achievement_id, version, unlocked_at, token_quality, notified_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        petId,
        definition.id,
        definition.version,
        unlockedAt,
        tokenQuality,
        unlockedAt,
      )) > 0
      if (!inserted) continue
      unlocks.push({
        petId,
        achievementId: definition.id,
        version: definition.version,
        unlockedAt,
        titleKey: definition.titleKey,
        descriptionKey: definition.descriptionKey,
        visualReward: definition.visualReward,
        tokenQuality,
      })
    }
    return unlocks
  }

  private readContext(
    petId: string,
    localDate: string,
    nightOwlCompletion: boolean,
    progression?: ProgressionSnapshot,
  ): AchievementEvaluationContext {
    const completed = this.statement(
      'SELECT COUNT(*) AS total FROM completed_sessions WHERE pet_id = ?',
    ).get(petId)
    const today = this.statement(
      'SELECT sessions_completed FROM daily_completions WHERE pet_id = ? AND local_date = ?',
    ).get(petId, localDate)
    const token = this.statement(`
      SELECT COUNT(*) AS total, SUM(CASE WHEN quality = 'estimated' THEN 1 ELSE 0 END) AS estimated
      FROM token_usage WHERE pet_id = ?
    `).get(petId)
    const tokenTotals = this.statement(`
      SELECT COALESCE(SUM(input_tokens), 0) + COALESCE(SUM(output_tokens), 0) AS total
      FROM token_usage WHERE pet_id = ?
    `).get(petId)
    const adapters = this.statement(
      'SELECT COUNT(*) AS total FROM adapter_usage WHERE pet_id = ?',
    ).get(petId)
    const activeDays = this.statement(
      'SELECT COUNT(*) AS total FROM active_days WHERE pet_id = ?',
    ).get(petId)
    return {
      completedSessions: Math.max(0, asInteger(completed?.total)),
      completedSessionsToday: Math.max(0, asInteger(today?.sessions_completed)),
      tokenTotal: Math.min(MAX_TOKEN_COUNT, Math.max(0, asInteger(tokenTotals?.total))),
      tokenQuality: rowQuality(token),
      adapterCount: Math.max(0, asInteger(adapters?.total)),
      activeDays: Math.max(0, asInteger(activeDays?.total)),
      nightOwlCompletion,
      currentStreak: Math.max(0, asInteger(progression?.currentStreak)),
      level: Math.max(1, asInteger(progression?.level, 1)),
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
      CREATE TABLE IF NOT EXISTS completed_sessions(
        session_key TEXT PRIMARY KEY,
        pet_id TEXT NOT NULL,
        local_date TEXT NOT NULL,
        adapter_id TEXT NOT NULL,
        completed_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS daily_completions(
        pet_id TEXT NOT NULL,
        local_date TEXT NOT NULL,
        sessions_completed INTEGER NOT NULL CHECK(sessions_completed >= 0),
        PRIMARY KEY(pet_id, local_date)
      );
      CREATE TABLE IF NOT EXISTS active_days(
        pet_id TEXT NOT NULL,
        local_date TEXT NOT NULL,
        PRIMARY KEY(pet_id, local_date)
      );
      CREATE TABLE IF NOT EXISTS adapter_usage(
        pet_id TEXT NOT NULL,
        adapter_id TEXT NOT NULL,
        PRIMARY KEY(pet_id, adapter_id)
      );
      CREATE TABLE IF NOT EXISTS token_usage(
        token_event_id TEXT PRIMARY KEY,
        pet_id TEXT NOT NULL,
        adapter_id TEXT NOT NULL,
        occurred_at INTEGER NOT NULL,
        input_tokens INTEGER NOT NULL CHECK(input_tokens >= 0),
        output_tokens INTEGER NOT NULL CHECK(output_tokens >= 0),
        quality TEXT NOT NULL CHECK(quality IN ('estimated', 'exact'))
      );
      CREATE TABLE IF NOT EXISTS achievement_unlocks(
        pet_id TEXT NOT NULL,
        achievement_id TEXT NOT NULL,
        version INTEGER NOT NULL CHECK(version > 0),
        unlocked_at INTEGER NOT NULL,
        token_quality TEXT NOT NULL CHECK(token_quality IN ('none', 'estimated', 'exact')),
        notified_at INTEGER,
        PRIMARY KEY(pet_id, achievement_id, version)
      );
      CREATE INDEX IF NOT EXISTS idx_achievement_unlocks_pet
        ON achievement_unlocks(pet_id, unlocked_at);
    `)
    const hasV1 = Boolean(this.statement(
      'SELECT version FROM schema_migrations WHERE version = 1',
    ).get())
    if (!hasV1) this.transaction(() => {
      this.statement(`
        INSERT INTO schema_migrations(version, name, applied_at, checksum)
        VALUES (1, 'achievements-v1', ?, 'achievements-v1')
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
