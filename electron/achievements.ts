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
import { localDateKey, localHour as localHourOf } from '../src/utils/local-date.ts'
import { applyWalPragmas, type SqlitePragmaState } from './sqlite-pragmas.ts'
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
const LOCAL_TOKEN_TOTAL_KEY = 'local_token_total'
const LOCAL_TOKEN_COMPACT_BATCH = 5_000
// Codex and Claude Code token usage is read exactly from their local session
// logs (LocalUsageReader). That ledger is the single source of truth for these
// agents, so token usage on their live events is ignored here; otherwise the
// same message would count twice. Other agents (OpenCode, generic HTTP) have
// no local log reader and keep using event-reported usage.
const LOCAL_LOG_TOKEN_ADAPTERS = new Set(['codex', 'claude-code'])
const LOCAL_LOG_TOKEN_SOURCES = new Set(['codex', 'codex-desktop', 'claude', 'claude-desktop'])

/** Minimal shape of one exact local-log usage record (see HistoryTokenUsageRecord). */
export interface LocalTokenUsageFact {
  adapterId: string
  sourceEventId: string
  occurredAt: number
  input?: number
  output?: number
}

export interface LocalTokenSyncOptions {
  /**
   * Records older than this are never re-presented by the scanner (its cutoff
   * is at least now - retention), so their dedupe rows can be dropped while
   * the running total keeps their tokens. Records older than it are ignored.
   */
  compactBefore: number
  /** Pet to evaluate for unlocks after the sync; null to only update the ledger. */
  evaluatePetId: string | null
  progression?: ProgressionSnapshot
}

export interface LocalTokenSyncResult {
  changed: boolean
  unlocks: AchievementUnlock[]
}

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

function isLocalLogTokenEvent(event: AgentStatusEvent): boolean {
  return LOCAL_LOG_TOKEN_ADAPTERS.has(eventAdapterId(event)) || LOCAL_LOG_TOKEN_SOURCES.has(event.source)
}

function rowQuality(row: SqliteRow | undefined): AchievementTokenQuality {
  if (!row || asInteger(row.total) <= 0) return 'none'
  return asInteger(row.estimated) > 0 ? 'estimated' : 'exact'
}

export class AchievementStore {
  private readonly database: SqliteDatabase
  private readonly statements: StatementCache<SqliteStatement>
  private pragmas: SqlitePragmaState = { journalMode: '', synchronous: -1 }
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
    this.localDate = options.localDate ?? localDateKey
    this.localHour = options.localHour ?? localHourOf
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
          this.bumpCounters(petId, 1, 0, 0, 0)
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
      const quality = isLocalLogTokenEvent(event) ? null : safeQuality(event.tokenUsage?.quality)
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
        if (tokenRecorded) {
          this.bumpCounters(petId, 0, 1, quality === 'estimated' ? 1 : 0, safeToken(tokenUsage?.input) + safeToken(tokenUsage?.output))
        }
      }

      // A replayed success (session already counted, nothing new) cannot change
      // any counter, so skip the unlock evaluation entirely.
      if (!completed && !tokenRecorded) return []
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
        this.bumpCounters(petId, 1, 0, 0, 0)
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
      // Reconcile is the self-healing path: recompute the touched pets' counters
      // from the indexed base tables instead of trusting the increments.
      for (const petId of touchedPets.keys()) this.recomputeCounters(petId)
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

  /**
   * Upserts exact local-log usage into an account-level ledger keyed by the
   * record's stable source id. A rescan presents the same ids again: unchanged
   * rows add nothing and a streamed Claude message whose usage grew adds only
   * the difference, so the running total is idempotent across rescans. The
   * total is account-level (local logs describe the machine, not a pet), the
   * same way History shows local token totals for every pet.
   */
  syncLocalTokenUsage(records: readonly LocalTokenUsageFact[], options: LocalTokenSyncOptions): LocalTokenSyncResult {
    const now = this.now()
    const compactBefore = Number.isFinite(options.compactBefore) ? options.compactBefore : 0
    return this.transaction(() => {
      let delta = 0
      for (const record of records) {
        const adapterId = safeAdapterId(record.adapterId)
        const sourceEventId = safeEventId(record.sourceEventId)
        if (!sourceEventId || !LOCAL_LOG_TOKEN_ADAPTERS.has(adapterId)) continue
        const occurredAt = Number.isFinite(record.occurredAt) ? Math.min(record.occurredAt, now) : now
        if (occurredAt < compactBefore) continue
        const total = Math.min(MAX_TOKEN_COUNT, safeToken(record.input) + safeToken(record.output))
        const key = digest(`local-token-v1:${adapterId}:${sourceEventId}`)
        const existing = this.statement(
          'SELECT total_tokens FROM local_token_usage WHERE token_event_id = ?',
        ).get(key)
        if (!existing) {
          if (total === 0) continue
          this.statement(`
            INSERT INTO local_token_usage(token_event_id, adapter_id, occurred_at, total_tokens)
            VALUES (?, ?, ?, ?)
          `).run(key, adapterId, occurredAt, total)
          delta += total
          continue
        }
        const previous = Math.max(0, asInteger(existing.total_tokens))
        if (previous === total) continue
        this.statement(
          'UPDATE local_token_usage SET total_tokens = ?, occurred_at = ? WHERE token_event_id = ?',
        ).run(total, occurredAt, key)
        delta += total - previous
      }
      if (delta !== 0) {
        this.statement(`
          INSERT INTO achievement_metadata(key, value) VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = MIN(?, MAX(0, CAST(value AS INTEGER) + ?))
        `).run(LOCAL_TOKEN_TOTAL_KEY, Math.max(0, Math.min(MAX_TOKEN_COUNT, delta)), MAX_TOKEN_COUNT, delta)
      }
      // Bounded compaction: drop dedupe rows the scanner can no longer present.
      // Safe because local records carry stable dates: an undated log line
      // inherits the previous real timestamp in its file, never the file mtime
      // (which moves on every append and would let a pruned row come back).
      this.statement(`
        DELETE FROM local_token_usage WHERE rowid IN (
          SELECT rowid FROM local_token_usage WHERE occurred_at < ? LIMIT ?
        )
      `).run(compactBefore, LOCAL_TOKEN_COMPACT_BATCH)
      const unlocks = options.evaluatePetId
        ? this.evaluateAndUnlock(safePetId(options.evaluatePetId), now, false, options.progression)
        : []
      return { changed: delta !== 0, unlocks }
    })
  }

  /** Evaluates one pet's unlocks against the current counters (used once per local-log scan). */
  evaluateTokenAchievements(petIdValue: string, progression?: ProgressionSnapshot): AchievementUnlock[] {
    return this.transaction(() => this.evaluateAndUnlock(safePetId(petIdValue), this.now(), false, progression))
  }

  getSnapshot(petIdValue: string, progression?: ProgressionSnapshot): AchievementSnapshot {
    const petId = safePetId(petIdValue)
    // Progress is read from the same facts evaluate() uses, so a bar can never
    // disagree with the unlock rule.
    const context = this.readContext(petId, this.localDate(this.now()), false, progression)
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
          category: definition.category,
          hidden: definition.hidden === true,
          progress: definition.progress(context),
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
    // O(1) primary-key read; the counters are maintained incrementally.
    const counters = this.statement(`
      SELECT completed_sessions, token_rows, token_estimated, token_total
      FROM pet_counters WHERE pet_id = ?
    `).get(petId)
    const today = this.statement(
      'SELECT sessions_completed FROM daily_completions WHERE pet_id = ? AND local_date = ?',
    ).get(petId, localDate)
    const adapters = this.statement(
      'SELECT COUNT(*) AS total FROM adapter_usage WHERE pet_id = ?',
    ).get(petId)
    const activeDays = this.statement(
      'SELECT COUNT(*) AS total FROM active_days WHERE pet_id = ?',
    ).get(petId)
    const localTokens = Math.max(0, asInteger(this.statement(
      'SELECT value FROM achievement_metadata WHERE key = ?',
    ).get(LOCAL_TOKEN_TOTAL_KEY)?.value))
    const petTokens = Math.max(0, asInteger(counters?.token_total))
    const petQuality = rowQuality({ total: counters?.token_rows, estimated: counters?.token_estimated })
    return {
      completedSessions: Math.max(0, asInteger(counters?.completed_sessions)),
      completedSessionsToday: Math.max(0, asInteger(today?.sessions_completed)),
      tokenTotal: Math.min(MAX_TOKEN_COUNT, petTokens + localTokens),
      // Local-log tokens are exact; any estimated event-reported row keeps the
      // combined total labelled estimated.
      tokenQuality: petQuality !== 'none' ? petQuality : localTokens > 0 ? 'exact' : 'none',
      adapterCount: Math.max(0, asInteger(adapters?.total)),
      activeDays: Math.max(0, asInteger(activeDays?.total)),
      nightOwlCompletion,
      currentStreak: Math.max(0, asInteger(progression?.currentStreak)),
      level: Math.max(1, asInteger(progression?.level, 1)),
    }
  }

  private migrate(): void {
    this.pragmas = applyWalPragmas(this.database)
    this.database.exec(`
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
    const hasV2 = Boolean(this.statement('SELECT version FROM schema_migrations WHERE version = 2').get())
    if (!hasV2) this.transaction(() => {
      // pet_id indexes for the base tables (previously full scans) and the
      // incremental per-pet counters that make readContext O(1).
      this.database.exec(`
        CREATE INDEX IF NOT EXISTS idx_token_usage_pet ON token_usage(pet_id);
        CREATE INDEX IF NOT EXISTS idx_completed_sessions_pet ON completed_sessions(pet_id);
        CREATE TABLE IF NOT EXISTS pet_counters(
          pet_id TEXT PRIMARY KEY,
          completed_sessions INTEGER NOT NULL DEFAULT 0,
          token_rows INTEGER NOT NULL DEFAULT 0,
          token_estimated INTEGER NOT NULL DEFAULT 0,
          token_total INTEGER NOT NULL DEFAULT 0
        );
      `)
      const pets = this.statement(`
        SELECT pet_id FROM completed_sessions UNION SELECT pet_id FROM token_usage
      `).all()
      for (const row of pets) this.recomputeCounters(String(row.pet_id))
      this.statement(`
        INSERT INTO schema_migrations(version, name, applied_at, checksum)
        VALUES (2, 'achievements-pet-counters', ?, 'achievements-pet-counters')
      `).run(this.now())
    })
    // Additive v3: the exact local-log token ledger. CREATE ... IF NOT EXISTS
    // keeps it idempotent; the running total starts at 0 and fills on the next scan.
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS local_token_usage(
        token_event_id TEXT PRIMARY KEY,
        adapter_id TEXT NOT NULL,
        occurred_at INTEGER NOT NULL,
        total_tokens INTEGER NOT NULL CHECK(total_tokens >= 0)
      );
      CREATE INDEX IF NOT EXISTS idx_local_token_usage_occurred ON local_token_usage(occurred_at);
      CREATE TABLE IF NOT EXISTS achievement_metadata(
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
    const hasV3 = Boolean(this.statement('SELECT version FROM schema_migrations WHERE version = 3').get())
    if (!hasV3) this.transaction(() => {
      this.statement(`
        INSERT INTO schema_migrations(version, name, applied_at, checksum)
        VALUES (3, 'achievements-local-token-ledger', ?, 'achievements-local-token-ledger')
      `).run(this.now())
    })
  }

  private bumpCounters(petId: string, completed: number, tokenRows: number, tokenEstimated: number, tokenTotal: number): void {
    this.statement(`
      INSERT INTO pet_counters(pet_id, completed_sessions, token_rows, token_estimated, token_total)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(pet_id) DO UPDATE SET
        completed_sessions = completed_sessions + excluded.completed_sessions,
        token_rows = token_rows + excluded.token_rows,
        token_estimated = token_estimated + excluded.token_estimated,
        token_total = token_total + excluded.token_total
    `).run(petId, completed, tokenRows, tokenEstimated, tokenTotal)
  }

  /** Full recompute from the base tables (indexed by pet_id); used by reconcile and the v2 migration. */
  private recomputeCounters(petId: string): void {
    this.statement(`
      INSERT INTO pet_counters(pet_id, completed_sessions, token_rows, token_estimated, token_total)
      SELECT ?,
             (SELECT COUNT(*) FROM completed_sessions WHERE pet_id = ?),
             COUNT(*),
             COALESCE(SUM(quality = 'estimated'), 0),
             COALESCE(SUM(input_tokens), 0) + COALESCE(SUM(output_tokens), 0)
      FROM token_usage WHERE pet_id = ?
      ON CONFLICT(pet_id) DO UPDATE SET
        completed_sessions = excluded.completed_sessions,
        token_rows = excluded.token_rows,
        token_estimated = excluded.token_estimated,
        token_total = excluded.token_total
    `).run(petId, petId, petId)
  }

  getPragmaState(): SqlitePragmaState {
    return this.pragmas
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
