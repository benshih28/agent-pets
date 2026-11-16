import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { writeFileAtomic } from '../electron/atomic-file-write.ts'
import { renameWithRetry } from '../electron/fs-rename.ts'
import {
  BACKUP_MARKER,
  ConfigRefusedError,
  MAX_BACKUPS,
  MAX_CONFIG_BYTES,
  listBackups,
  listBackupsAsync,
  readConfigTextAsync,
  readJsonObjectConfigAsync,
  writeConfigSafelyAsync,
  writeConfigSafely,
  writeTextAtomicAsync,
} from '../electron/safe-config-write.ts'
import { POSIX_FILE_MODES, SKIP_WITHOUT_FILE_SYMLINKS } from './support/fs-capabilities.mts'
import { removeTempTree } from './support/temp-dir.mts'

// 非同步版與同步版必須遵守同一組規則（備份、symlink、大小上限、不覆寫壞檔、unchanged）。

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-safe-config-async-'))
}

test('async write backs up at 0600, prunes to MAX_BACKUPS, and reports unchanged for identical content', async () => {
  const dir = tempDir()
  try {
    const file = path.join(dir, 'a.json')
    fs.writeFileSync(file, '{}')
    assert.equal((await writeConfigSafelyAsync(file, '{}')).status, 'unchanged')
    for (let index = 0; index < MAX_BACKUPS + 3; index += 1) {
      const result = await writeConfigSafelyAsync(file, `{"n":${index}}\n`)
      assert.equal(result.status, 'written')
      assert.ok(result.backupPath)
      if (POSIX_FILE_MODES) assert.equal(fs.statSync(result.backupPath).mode & 0o777, 0o600)
    }
    const backups = await listBackupsAsync(file)
    assert.equal(backups.length, MAX_BACKUPS)
    assert.deepEqual(backups, listBackups(file), 'sync and async listings agree')
    assert.ok(backups.every(name => path.basename(name).includes(BACKUP_MARKER)))
    assert.equal((await writeConfigSafelyAsync(file, `{"n":${MAX_BACKUPS + 2}}\n`)).status, 'unchanged')
    assert.equal(fs.readdirSync(dir).filter(name => name.endsWith('.tmp')).length, 0)
  } finally { removeTempTree(dir) }
})

test('async and sync writers produce the same file and backup', async () => {
  const dir = tempDir()
  try {
    const a = path.join(dir, 'sync.json')
    const b = path.join(dir, 'async.json')
    fs.writeFileSync(a, '{"x":1}')
    fs.writeFileSync(b, '{"x":1}')
    const sync = writeConfigSafely(a, '{"x":2}\n')
    const async = await writeConfigSafelyAsync(b, '{"x":2}\n')
    assert.equal(fs.readFileSync(a, 'utf8'), fs.readFileSync(b, 'utf8'))
    assert.equal(fs.readFileSync(sync.backupPath!, 'utf8'), fs.readFileSync(async.backupPath!, 'utf8'))
  } finally { removeTempTree(dir) }
})

test('async write follows a symlinked dotfile and keeps its mode', { skip: SKIP_WITHOUT_FILE_SYMLINKS }, async () => {
  const dir = tempDir()
  try {
    const real = path.join(dir, 'real.json')
    const link = path.join(dir, 'link.json')
    fs.writeFileSync(real, '{}', { mode: 0o640 })
    fs.chmodSync(real, 0o640)
    fs.symlinkSync(real, link)
    await writeConfigSafelyAsync(link, '{"a":1}\n')
    assert.ok(fs.lstatSync(link).isSymbolicLink())
    assert.equal(fs.readFileSync(real, 'utf8'), '{"a":1}\n')
    if (POSIX_FILE_MODES) assert.equal(fs.statSync(real).mode & 0o777, 0o640)
    assert.equal(listBackups(real).length, 1)
  } finally { removeTempTree(dir) }
})

test('async readers refuse oversized, non-regular and unparseable files and never modify them', async () => {
  const dir = tempDir()
  try {
    const big = path.join(dir, 'big.json')
    fs.writeFileSync(big, ' '.repeat(MAX_CONFIG_BYTES + 1))
    await assert.rejects(() => readConfigTextAsync(big), (error: unknown) => error instanceof ConfigRefusedError && error.code === 'too_large')
    await assert.rejects(() => readConfigTextAsync(dir), (error: unknown) => error instanceof ConfigRefusedError && error.code === 'unsafe')

    const bad = path.join(dir, 'bad.json')
    fs.writeFileSync(bad, '{ "a": // c\n}')
    await assert.rejects(() => readJsonObjectConfigAsync(bad), (error: unknown) => error instanceof ConfigRefusedError && error.code === 'unparseable')
    fs.writeFileSync(bad, '[1]')
    await assert.rejects(() => readJsonObjectConfigAsync(bad), (error: unknown) => error instanceof ConfigRefusedError && error.code === 'not_object')
    assert.equal(fs.readFileSync(bad, 'utf8'), '[1]')

    assert.equal(await readConfigTextAsync(path.join(dir, 'missing.json')), null)
    assert.deepEqual(await readJsonObjectConfigAsync(path.join(dir, 'missing.json')), { exists: false, root: {}, raw: null })
    fs.writeFileSync(bad, '﻿{"a":1}')
    assert.deepEqual((await readJsonObjectConfigAsync(bad)).root, { a: 1 })
  } finally { removeTempTree(dir) }
})

test('async atomic write cleans its temporary file when the rename fails and keeps the old content', async () => {
  const dir = tempDir()
  try {
    const target = path.join(dir, 'x.json')
    fs.writeFileSync(target, 'old')
    // 目標是目錄：rename 檔案蓋過目錄一定失敗。
    const blocked = path.join(dir, 'blocked')
    fs.mkdirSync(blocked)
    await assert.rejects(() => writeFileAtomic(blocked, 'new', { temporaryPath: path.join(dir, '.blocked.tmp') }))
    assert.deepEqual(fs.readdirSync(dir).filter(name => name.endsWith('.tmp')), [])
    assert.equal(fs.readFileSync(target, 'utf8'), 'old')

    await assert.rejects(() => writeFileAtomic(target, 'new', { temporaryPath: path.join(os.tmpdir(), 'elsewhere.tmp') }), TypeError)
    await writeTextAtomicAsync(path.join(dir, 'nested', 'deep', 'y.json'), 'ok', { mode: 0o600 })
    assert.equal(fs.readFileSync(path.join(dir, 'nested', 'deep', 'y.json'), 'utf8'), 'ok')
  } finally { removeTempTree(dir) }
})

test('async rename retries only the Windows transient codes, without blocking', async () => {
  const delays: number[] = []
  let calls = 0
  await renameWithRetry('a', 'b', {
    platform: 'win32',
    rename: async () => { calls += 1; if (calls < 3) throw Object.assign(new Error('busy'), { code: 'EBUSY' }) },
    sleep: async ms => { delays.push(ms) },
  })
  assert.equal(calls, 3)
  assert.deepEqual(delays, [10, 20])

  calls = 0
  await assert.rejects(() => renameWithRetry('a', 'b', {
    platform: 'darwin',
    rename: async () => { calls += 1; throw Object.assign(new Error('perm'), { code: 'EPERM' }) },
    sleep: async () => { throw new Error('must not sleep') },
  }), { code: 'EPERM' })
  assert.equal(calls, 1)
})
