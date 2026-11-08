import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { isCorruptDatabaseError, openWithCorruptionRecovery, pruneCorruptCopies } from '../electron/main/db-recovery.ts'
import { HistoryStore } from '../electron/history.ts'

const corruptError = () => Object.assign(new Error('file is not a database'), { code: 'ERR_SQLITE_ERROR', errcode: 26 })

test('corruption classification is limited to CORRUPT/NOTADB', () => {
  assert.equal(isCorruptDatabaseError(corruptError()), true)
  assert.equal(isCorruptDatabaseError(Object.assign(new Error('x'), { errcode: 11 })), true)
  assert.equal(isCorruptDatabaseError(new Error('database disk image is malformed')), true)
  for (const errcode of [5, 6, 13, 14, 8, 10]) {
    assert.equal(isCorruptDatabaseError(Object.assign(new Error('x'), { errcode })), false, String(errcode))
  }
  assert.equal(isCorruptDatabaseError(Object.assign(new Error('EACCES'), { code: 'EACCES' })), false)
  assert.equal(isCorruptDatabaseError(new Error('migration exploded')), false)
  assert.equal(isCorruptDatabaseError(undefined), false)
})

test('a corrupt database is moved aside and recreated once, and the user is told', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ap-db-'))
  const file = join(dir, 'history.sqlite')
  writeFileSync(file, 'garbage')
  let calls = 0
  let recovered = ''
  const result = openWithCorruptionRecovery(file, () => {
    calls += 1
    if (existsSync(file)) throw corruptError()
    return 'fresh'
  }, { now: () => 42, onRecovered: info => { recovered = info.copyName } })
  assert.equal(result, 'fresh')
  assert.equal(calls, 2)
  assert.equal(recovered, 'history.sqlite.corrupt-42')
  assert.ok(readdirSync(dir).includes('history.sqlite.corrupt-42'))
})

test('locked, busy, full-disk, permission and migration errors never rename the database', () => {
  for (const error of [
    Object.assign(new Error('database is locked'), { errcode: 5 }),
    Object.assign(new Error('busy'), { errcode: 6 }),
    Object.assign(new Error('full'), { errcode: 13 }),
    Object.assign(new Error('EACCES'), { code: 'EACCES' }),
    new Error('migration failed'),
  ]) {
    const dir = mkdtempSync(join(tmpdir(), 'ap-db-'))
    const file = join(dir, 'history.sqlite')
    writeFileSync(file, 'precious')
    let failed: unknown
    const result = openWithCorruptionRecovery(file, () => { throw error }, { onOpenFailed: e => { failed = e } })
    assert.equal(result, null)
    assert.equal(failed, error)
    assert.deepEqual(readdirSync(dir), ['history.sqlite'])
    assert.equal(readFileSync(file, 'utf8'), 'precious')
  }
})

test('a failed integrity check counts as corruption', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ap-db-'))
  const file = join(dir, 'history.sqlite')
  writeFileSync(file, 'x')
  const disposed: string[] = []
  const result = openWithCorruptionRecovery(file, () => (existsSync(file) ? 'old' : 'new'), {
    now: () => 7,
    verify: value => value !== 'old',
    dispose: value => { disposed.push(value) },
  })
  assert.equal(result, 'new')
  assert.deepEqual(disposed, ['old'])
  assert.ok(readdirSync(dir).includes('history.sqlite.corrupt-7'))
})

test('returns null when recovery cannot help and does not retry forever', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ap-db-'))
  const file = join(dir, 'missing.sqlite')
  let calls = 0
  const result = openWithCorruptionRecovery(file, () => { calls += 1; throw corruptError() })
  assert.equal(result, null)
  assert.equal(calls, 1)
})

test('at most three corrupt copies are kept and clear removes them all', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ap-db-'))
  const file = join(dir, 'history.sqlite')
  for (const stamp of [1, 2, 3, 4]) {
    writeFileSync(`${file}.corrupt-${stamp}`, 'x')
    writeFileSync(`${file}.corrupt-${stamp}-wal`, 'x')
  }
  writeFileSync(file, 'garbage')
  openWithCorruptionRecovery(file, () => {
    if (existsSync(file)) throw corruptError()
    return 1
  }, { now: () => 5 })
  assert.deepEqual(readdirSync(dir).filter(n => !n.endsWith('-wal')).sort(), [
    'history.sqlite.corrupt-3', 'history.sqlite.corrupt-4', 'history.sqlite.corrupt-5',
  ])
  assert.ok(!readdirSync(dir).includes('history.sqlite.corrupt-2-wal'))
  pruneCorruptCopies(file, 0)
  assert.deepEqual(readdirSync(dir), [])
})

test('a failing history migration rolls back and keeps the original data', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ap-db-'))
  const file = join(dir, 'history.sqlite')
  new HistoryStore(file).close()
  // Simulate a pre-v6 database whose migration will fail (events table gone).
  const raw = new DatabaseSync(file)
  raw.exec("DELETE FROM schema_migrations WHERE version = 6; DROP TABLE events;")
  raw.close()
  let result: HistoryStore | null = null
  assert.doesNotThrow(() => {
    result = openWithCorruptionRecovery(file, () => new HistoryStore(file), { verify: s => s.quickCheck(), dispose: s => s.close() })
  })
  assert.equal(result, null)
  assert.deepEqual(readdirSync(dir).filter(n => n.includes('corrupt')), [])
  const check = new DatabaseSync(file)
  const versions = (check.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map(r => r.version)
  check.close()
  assert.ok(!versions.includes(6))
  assert.ok(versions.includes(1))
})
