import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import test from 'node:test'
import { RENAME_RETRY_DELAYS_MS, renameSyncWithRetry } from '../electron/fs-rename.ts'

const fsError = (code: string) => Object.assign(new Error(code), { code })

function flakyRename(failures: string[]) {
  const calls: Array<[string, string]> = []
  return {
    calls,
    rename: (from: string, to: string) => {
      calls.push([from, to])
      const code = failures.shift()
      if (code) throw fsError(code)
    },
  }
}

test('rename retries transient Windows locks with increasing backoff', () => {
  const flaky = flakyRename(['EPERM', 'EBUSY', 'EACCES'])
  const sleeps: number[] = []
  renameSyncWithRetry('a', 'b', { platform: 'win32', rename: flaky.rename, sleep: ms => sleeps.push(ms) })
  assert.equal(flaky.calls.length, 4)
  assert.deepEqual(sleeps, RENAME_RETRY_DELAYS_MS.slice(0, 3))
})

test('rename gives up after the retry budget and rethrows the last error', () => {
  const flaky = flakyRename(Array(RENAME_RETRY_DELAYS_MS.length + 1).fill('EPERM'))
  const sleeps: number[] = []
  assert.throws(
    () => renameSyncWithRetry('a', 'b', { platform: 'win32', rename: flaky.rename, sleep: ms => sleeps.push(ms) }),
    { code: 'EPERM' },
  )
  assert.equal(flaky.calls.length, RENAME_RETRY_DELAYS_MS.length + 1)
  assert.deepEqual(sleeps, [...RENAME_RETRY_DELAYS_MS])
})

test('rename does not retry real errors or non-Windows permission failures', () => {
  for (const [platform, code] of [['win32', 'ENOENT'], ['darwin', 'EPERM'], ['linux', 'EACCES']] as const) {
    const flaky = flakyRename([code])
    let slept = false
    assert.throws(
      () => renameSyncWithRetry('a', 'b', { platform, rename: flaky.rename, sleep: () => { slept = true } }),
      { code },
    )
    assert.equal(flaky.calls.length, 1, `${platform} ${code}`)
    assert.equal(slept, false)
  }
})

test('rename moves a real directory with the default dependencies', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-rename-'))
  try {
    fs.mkdirSync(path.join(root, 'staging'))
    fs.writeFileSync(path.join(root, 'staging', 'plugin.json'), '{}')
    renameSyncWithRetry(path.join(root, 'staging'), path.join(root, '1.0.0'))
    assert.equal(fs.readFileSync(path.join(root, '1.0.0', 'plugin.json'), 'utf8'), '{}')
    assert.equal(fs.existsSync(path.join(root, 'staging')), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
