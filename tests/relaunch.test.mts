import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import test from 'node:test'
import { acquireSingleInstanceLock, RELAUNCH_FLAG, resolveRelaunchOptions } from '../electron/relaunch.ts'

test('relaunch uses the portable launcher on windows, default exec path elsewhere', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'relaunch-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const portable = path.join(directory, 'AgentPets.exe')
  fs.writeFileSync(portable, '')

  assert.deepEqual(
    resolveRelaunchOptions('win32', true, ['C:\\Temp\\x.exe'], portable, 'C:\\Temp\\x.exe'),
    { execPath: portable, args: [RELAUNCH_FLAG] },
  )
  // Missing/invalid launcher falls back to the default exec path.
  const missing = resolveRelaunchOptions('win32', true, ['x.exe'], path.join(directory, 'gone.exe'), 'x.exe')
  assert.equal(missing.execPath, undefined)
  assert.deepEqual(resolveRelaunchOptions('win32', false, ['x.exe'], portable, 'x.exe').execPath, undefined)
  assert.deepEqual(resolveRelaunchOptions('darwin', true, ['app', '--a', RELAUNCH_FLAG], '/ignored', '/app'), { args: ['--a', RELAUNCH_FLAG] })
})

test('single-instance lock retries only for relaunched instances', async () => {
  let attempts = 0
  const sleeps: number[] = []
  const grantOnThird = () => ++attempts >= 3
  assert.equal(await acquireSingleInstanceLock(grantOnThird, { argv: ['a', RELAUNCH_FLAG], sleep: async ms => { sleeps.push(ms) } }), true)
  assert.equal(attempts, 3)
  assert.deepEqual(sleeps, [250, 250])

  attempts = 0
  assert.equal(await acquireSingleInstanceLock(() => { attempts += 1; return false }, { argv: ['a'], sleep: () => {} }), false)
  assert.equal(attempts, 1)

  attempts = 0
  assert.equal(await acquireSingleInstanceLock(() => { attempts += 1; return false }, { argv: [RELAUNCH_FLAG], sleep: () => {} }), false)
  assert.equal(attempts, 9)
})

test('single-instance lock waits asynchronously instead of blocking the thread', async () => {
  let granted = false
  const started = Date.now()
  setTimeout(() => { granted = true }, 20)
  let ticked = false
  const pending = acquireSingleInstanceLock(() => granted, { argv: [RELAUNCH_FLAG], delayMs: 10, attempts: 20 })
  setImmediate(() => { ticked = true })
  assert.equal(await pending, true)
  assert.equal(ticked, true)
  assert.ok(Date.now() - started >= 15)
})
