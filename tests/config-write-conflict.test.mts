import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { afterEach } from 'node:test'
import { writeFileAtomic } from '../electron/atomic-file-write.ts'
import { mergeAgentPetsHooksFile, setJsonKeyFile, type HookMatcherEntry } from '../electron/hook-config.ts'
import { classifyInstallError } from '../electron/install-outcome.ts'
import {
  ConfigChangedError,
  ConfigRefusedError,
  backupConfigAsync,
  configWriteTestSeam,
  listBackups,
  withConfigConflictRetry,
  writeConfigSafelyAsync,
} from '../electron/safe-config-write.ts'
import { removeTempTree } from './support/temp-dir.mts'

// 讀 → 合併 → 寫之間，Claude Code / Codex 可能剛好也寫了同一個檔案：不能把它的修改蓋掉。

const HOOK = '/home/u/.desktop-pet/agent-hook.mjs'
const desired = (): Record<string, HookMatcherEntry[]> => ({ Stop: [{ hooks: [{ type: 'command', command: 'node', args: [HOOK, 'claude'] }] }] })

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-config-conflict-'))
}

afterEach(() => { configWriteTestSeam.beforeFinalCheck = undefined })

test('the temp file is written first and beforeRename can veto the rename', async () => {
  const dir = tempDir()
  try {
    const target = path.join(dir, 'a.txt')
    fs.writeFileSync(target, 'old')
    const temporaryPath = path.join(dir, '.a.txt.tmp')
    await assert.rejects(writeFileAtomic(target, 'new', {
      temporaryPath,
      beforeRename: async () => {
        assert.equal(fs.readFileSync(temporaryPath, 'utf8'), 'new', 'temp is complete before the check')
        throw new Error('veto')
      },
    }), /veto/)
    assert.equal(fs.readFileSync(target, 'utf8'), 'old')
    assert.deepEqual(fs.readdirSync(dir), ['a.txt'])
  } finally { removeTempTree(dir) }
})

test('the backup is the originally read content, not a fresh read of the file', async () => {
  const dir = tempDir()
  try {
    const file = path.join(dir, 'a.json')
    fs.writeFileSync(file, 'READ-BY-US')
    const result = await writeConfigSafelyAsync(file, 'NEXT\n', 'READ-BY-US')
    assert.equal(fs.readFileSync(result.backupPath!, 'utf8'), 'READ-BY-US')
    assert.equal(fs.readFileSync(file, 'utf8'), 'NEXT\n')
    assert.equal((await backupConfigAsync(file, 5, 'explicit')) !== null, true)
  } finally { removeTempTree(dir) }
})

test('an external edit before the rename is retried and merged, not overwritten', async () => {
  const dir = tempDir()
  try {
    const file = path.join(dir, 'settings.json')
    fs.writeFileSync(file, '{"theme":"dark"}\n')
    let injected = 0
    configWriteTestSeam.beforeFinalCheck = async () => {
      if (injected++ === 0) fs.writeFileSync(file, '{"theme":"dark","external":true}\n')
    }
    const result = await mergeAgentPetsHooksFile(file, desired())
    assert.equal(injected, 2, 'second attempt re-read and checked again')
    const final = JSON.parse(fs.readFileSync(file, 'utf8'))
    assert.equal(final.external, true, 'the external edit is preserved')
    assert.equal(final.theme, 'dark')
    assert.equal(final.hooks.Stop.length, 1)
    assert.equal(fs.readFileSync(result.backupPath!, 'utf8'), '{"theme":"dark","external":true}\n', 'backup is what we replaced')
    assert.deepEqual(fs.readdirSync(dir).filter(name => name.endsWith('.tmp')), [])
  } finally { removeTempTree(dir) }
})

test('a file created or deleted during the write also counts as a change', async () => {
  const dir = tempDir()
  try {
    const created = path.join(dir, 'new.json')
    let first = true
    configWriteTestSeam.beforeFinalCheck = async () => {
      if (first) { first = false; fs.writeFileSync(created, '{"other":1}\n') }
    }
    await setJsonKeyFile(created, 'k', 1)
    assert.deepEqual(JSON.parse(fs.readFileSync(created, 'utf8')), { other: 1, k: 1 })

    const gone = path.join(dir, 'gone.json')
    fs.writeFileSync(gone, '{}\n')
    first = true
    configWriteTestSeam.beforeFinalCheck = async () => {
      if (first) { first = false; fs.rmSync(gone) }
    }
    await setJsonKeyFile(gone, 'k', 2)
    assert.deepEqual(JSON.parse(fs.readFileSync(gone, 'utf8')), { k: 2 })
  } finally { removeTempTree(dir) }
})

test('changed on both attempts: refused with changed_during_write, external content intact, nothing left behind', async () => {
  const dir = tempDir()
  try {
    const file = path.join(dir, 'settings.json')
    fs.writeFileSync(file, '{"a":1}\n')
    let n = 0
    let latest = ''
    configWriteTestSeam.beforeFinalCheck = async () => {
      n += 1
      latest = `{"a":1,"external":${n}}\n`
      fs.writeFileSync(file, latest)
    }
    await assert.rejects(mergeAgentPetsHooksFile(file, desired()), (error: unknown) => {
      assert.ok(error instanceof ConfigRefusedError)
      assert.equal(error.code, 'changed_during_write')
      assert.equal(error.filePath, file)
      assert.match(error.message, /did not modify it/)
      assert.deepEqual(classifyInstallError(error), { code: 'config_changed', path: file })
      return true
    })
    assert.equal(n, 2)
    assert.equal(fs.readFileSync(file, 'utf8'), latest, 'the external content is left as it was')
    assert.deepEqual(fs.readdirSync(dir), ['settings.json'], 'no temp file and no backup of unwritten content')
    assert.deepEqual(listBackups(file), [])
  } finally { removeTempTree(dir) }
})

test('withConfigConflictRetry only retries conflicts, once, and passes other errors through', async () => {
  let calls = 0
  assert.equal(await withConfigConflictRetry('/f', async () => {
    calls += 1
    if (calls === 1) throw new ConfigChangedError('/f')
    return 'ok'
  }), 'ok')
  assert.equal(calls, 2)

  calls = 0
  await assert.rejects(withConfigConflictRetry('/f', async () => { calls += 1; throw new Error('boom') }), /boom/)
  assert.equal(calls, 1)
})
