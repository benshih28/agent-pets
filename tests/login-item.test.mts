import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import test from 'node:test'
import { createLoginItemAdapter, mapDarwinLoginItemStatus, type LoginItemApp } from '../electron/login-item.ts'

test('maps macOS SMAppService status', () => {
  assert.equal(mapDarwinLoginItemStatus({ openAtLogin: true, status: 'enabled' }, true), 'enabled')
  assert.equal(mapDarwinLoginItemStatus({ openAtLogin: false, status: 'requires-approval' }, true), 'requires-approval')
  assert.equal(mapDarwinLoginItemStatus({ openAtLogin: false, status: 'not-registered' }, true), 'disabled')
  assert.equal(mapDarwinLoginItemStatus({ openAtLogin: false, status: 'not-found' }, false), 'not-in-applications')
  assert.equal(mapDarwinLoginItemStatus({ openAtLogin: true }, true), 'enabled')
})

function fakeApp(overrides: Partial<LoginItemApp> = {}) {
  const calls: unknown[] = []
  const app: LoginItemApp = {
    isPackaged: true,
    isInApplicationsFolder: () => true,
    getLoginItemSettings: () => ({ openAtLogin: false, status: 'not-registered' }),
    setLoginItemSettings: (settings) => { calls.push(settings) },
    ...overrides,
  }
  return { app, calls }
}

test('darwin adapter drops path and reports approval or location problems', () => {
  const approval = fakeApp({ getLoginItemSettings: () => ({ openAtLogin: false, status: 'requires-approval' }) })
  const adapter = createLoginItemAdapter({ platform: 'darwin', app: approval.app, execPath: '/x/Agent Pets' })
  assert.equal(adapter.supported, true)
  assert.equal(adapter.setLaunchAtStartup(true), 'requires-approval')
  assert.deepEqual(approval.calls, [{ openAtLogin: true, type: 'mainAppService' }])

  const outside = fakeApp({ isInApplicationsFolder: () => false })
  assert.equal(createLoginItemAdapter({ platform: 'darwin', app: outside.app, execPath: '/x' }).setLaunchAtStartup(true), 'not-in-applications')

  const refused = fakeApp()
  assert.equal(createLoginItemAdapter({ platform: 'darwin', app: refused.app, execPath: '/x' }).setLaunchAtStartup(true), 'error')

  const throwing = fakeApp({ setLoginItemSettings: () => { throw new Error('boom') } })
  assert.equal(createLoginItemAdapter({ platform: 'darwin', app: throwing.app, execPath: '/x' }).setLaunchAtStartup(true), 'error')
})

test('unpackaged apps are unsupported and windows keeps the portable path', (t) => {
  const dev = fakeApp({ isPackaged: false })
  const unsupported = createLoginItemAdapter({ platform: 'darwin', app: dev.app, execPath: '/x' })
  assert.equal(unsupported.supported, false)
  assert.equal(unsupported.getStatus(), 'unsupported')

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'login-item-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const portable = path.join(directory, 'AgentPets.exe')
  fs.writeFileSync(portable, '')
  let open = false
  const win = fakeApp({
    getLoginItemSettings: () => ({ openAtLogin: open }),
    setLoginItemSettings: (settings) => { open = settings.openAtLogin },
  })
  const adapter = createLoginItemAdapter({ platform: 'win32', app: win.app, execPath: 'C:\\Temp\\x.exe', portableExecutableFile: portable })
  assert.equal(adapter.supported, true)
  assert.equal(adapter.setLaunchAtStartup(true), 'enabled')
  assert.equal(adapter.getStatus(), 'enabled')
  assert.equal(createLoginItemAdapter({ platform: 'win32', app: win.app, execPath: 'C:\\Temp\\x.exe' }).supported, false)
})
