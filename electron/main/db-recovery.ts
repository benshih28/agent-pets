import * as fs from 'node:fs'
import * as path from 'node:path'

export const MAX_CORRUPT_COPIES = 3

export interface DbRecoveryOptions<T = unknown> {
  now?: () => number
  log?: (message: string, detail?: unknown) => void
  verify?: (opened: T) => boolean
  dispose?: (opened: T) => void
  onRecovered?: (info: { copyName: string }) => void
  onOpenFailed?: (error: unknown) => void
  maxCopies?: number
}

const CORRUPT_CODES = new Set([11, 26]) // SQLITE_CORRUPT, SQLITE_NOTADB

// Busy/locked, full disk, permission, IO and migration errors are NOT corruption and must never cause the database to be set aside.
export function isCorruptDatabaseError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const info = error as { errcode?: unknown, code?: unknown, message?: unknown }
  if (typeof info.errcode === 'number' && CORRUPT_CODES.has(info.errcode & 0xff)) return true
  if (typeof info.code === 'string' && /^SQLITE_(CORRUPT|NOTADB)/.test(info.code)) return true
  const message = typeof info.message === 'string' ? info.message : ''
  return /database disk image is malformed|file is not a database/i.test(message)
}

function corruptCopyStamps(databasePath: string): string[] {
  const directory = path.dirname(databasePath)
  const prefix = `${path.basename(databasePath)}.corrupt-`
  const stamps = new Set<string>()
  try {
    for (const name of fs.readdirSync(directory)) {
      if (!name.startsWith(prefix)) continue
      const match = /^(\d+)(?:-wal|-shm)?$/.exec(name.slice(prefix.length))
      if (match) stamps.add(match[1]!)
    }
  } catch {}
  return [...stamps]
}

export function pruneCorruptCopies(databasePath: string, keep = MAX_CORRUPT_COPIES): void {
  const stamps = corruptCopyStamps(databasePath).sort((a, b) => Number(b) - Number(a))
  for (const stamp of stamps.slice(Math.max(0, keep))) {
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.rmSync(`${databasePath}.corrupt-${stamp}${suffix}`, { force: true }) } catch {}
    }
  }
}

// Only a corrupt database is renamed aside and recreated; any other open failure leaves the files untouched and returns null so the caller can retry later.
export function openWithCorruptionRecovery<T>(
  databasePath: string,
  open: () => T,
  options: DbRecoveryOptions<T> = {},
): T | null {
  const log = options.log ?? (() => {})
  const name = databasePath.split(/[\\/]/).pop()
  let corrupt = false
  try {
    const opened = open()
    if (!options.verify || options.verify(opened)) return opened
    try { options.dispose?.(opened) } catch {}
    corrupt = true
    log(`Database ${name} failed its integrity check; moving it aside and recreating`)
  } catch (error) {
    if (!isCorruptDatabaseError(error)) {
      log(`Database open failed (not corruption); leaving ${name} untouched`, error)
      options.onOpenFailed?.(error)
      return null
    }
    corrupt = true
    log(`Database ${name} is corrupt; moving it aside and recreating`, error)
  }
  if (!corrupt) return null

  const stamp = (options.now ?? Date.now)()
  const copyName = `${path.basename(databasePath)}.corrupt-${stamp}`
  try {
    fs.renameSync(databasePath, `${databasePath}.corrupt-${stamp}`)
  } catch (error) {
    log('Could not set the corrupt database aside', error)
    options.onOpenFailed?.(error)
    return null
  }
  for (const suffix of ['-wal', '-shm']) {
    try { fs.renameSync(`${databasePath}${suffix}`, `${databasePath}.corrupt-${stamp}${suffix}`) } catch {}
  }
  pruneCorruptCopies(databasePath, options.maxCopies ?? MAX_CORRUPT_COPIES)
  try {
    const opened = open()
    options.onRecovered?.({ copyName })
    return opened
  } catch (error) {
    log('Database recreation failed', error)
    options.onOpenFailed?.(error)
    return null
  }
}
