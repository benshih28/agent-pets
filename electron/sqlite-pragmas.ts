interface PragmaRow { [column: string]: unknown }
interface PragmaDatabase {
  exec(sql: string): void
  prepare(sql: string): { get(...params: unknown[]): PragmaRow | undefined }
}

export interface SqlitePragmaState {
  journalMode: string
  /** 0 = OFF, 1 = NORMAL, 2 = FULL, 3 = EXTRA */
  synchronous: number
}

/**
 * Enables WAL and, only once WAL is confirmed, relaxes `synchronous` to NORMAL.
 * In WAL mode NORMAL is crash-safe for the application (only a power loss can
 * drop the last few commits of this count-type data) and removes one fsync per
 * commit. If WAL could not be enabled (in-memory or odd file systems) the
 * default FULL durability is kept.
 */
export function applyWalPragmas(database: PragmaDatabase): SqlitePragmaState {
  database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;')
  const mode = String(database.prepare('PRAGMA journal_mode').get()?.journal_mode ?? '').toLowerCase()
  if (mode === 'wal') database.exec('PRAGMA synchronous = NORMAL;')
  return readPragmaState(database)
}

export function readPragmaState(database: PragmaDatabase): SqlitePragmaState {
  return {
    journalMode: String(database.prepare('PRAGMA journal_mode').get()?.journal_mode ?? '').toLowerCase(),
    synchronous: Number(database.prepare('PRAGMA synchronous').get()?.synchronous ?? -1),
  }
}
