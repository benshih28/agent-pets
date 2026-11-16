import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { StatementCache } from '../electron/sqlite-statements.ts'
import { HistoryStore } from '../electron/history.ts'
import { removeTempTree } from './support/temp-dir.mts'

test('statement cache prepares each SQL string once', () => {
  const prepared: string[] = []
  const cache = new StatementCache((sql: string) => {
    prepared.push(sql)
    return { sql }
  })
  const first = cache.get('SELECT 1')
  assert.equal(cache.get('SELECT 1'), first)
  cache.get('SELECT 2')
  assert.deepEqual(prepared, ['SELECT 1', 'SELECT 2'])
  cache.clear()
  cache.get('SELECT 1')
  assert.equal(prepared.length, 3)
})

test('history batch commits nested writes once and rolls back as a unit', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-batch-'))
  const now = Date.UTC(2026, 7, 13, 1, 0, 0)
  const store = new HistoryStore(path.join(directory, 'history.sqlite'), { now: () => now })
  t.after(() => { store.close(); removeTempTree(directory) })

  const usage = (id: string) => ({
    adapterId: 'codex',
    agentId: 'codex',
    sessionId: 'session-1',
    sourceEventId: id,
    occurredAt: now - 1_000,
    input: 10,
    output: 5,
    quality: 'exact' as const,
  })

  const imported = store.batch(() => Number(store.recordTokenUsage(usage('a'))) + Number(store.recordTokenUsage(usage('b'))))
  assert.equal(imported, 2)

  assert.throws(() => store.batch(() => {
    store.recordTokenUsage(usage('c'))
    throw new Error('abort batch')
  }), /abort batch/)
  // 回滾後 c 未寫入，可再次匯入；a 已存在，不重複計算。
  assert.equal(store.recordTokenUsage(usage('c')), true)
  assert.equal(store.recordTokenUsage(usage('a')), false)
  assert.equal(store.getSummary().totals.tokenInput, 30)
})
