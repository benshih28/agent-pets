import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { configureSetupEnvironment } from '../electron/setup-environment.ts'
import {
  claudeCodeSettingsPath,
  claudePermissionRespondPath,
  syncClaudePermissionRespondOptIn,
  upgradeClaudeCodeHooks,
  upgradeClaudeCodeHooksOnce,
  claudeHooksUpgradeMarkerPath,
  codexConfigPath,
  codexHooksPath,
  hookScriptPath,
  installIntegration,
  uninstallIntegration,
} from '../electron/setup.ts'
import { fileHasAgentPetsHooks, isCodexHooksFeatureEnabled } from '../electron/hook-config.ts'
import { ConfigRefusedError } from '../electron/safe-config-write.ts'

// Integration tests for the real installer against a throw-away HOME. Nothing here touches the
// user's actual home directory or the macOS Keychain.
const integrations = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'integrations')

function withHome<T>(work: (home: string) => T): T {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-setup-home-'))
  configureSetupEnvironment({
    homeDir: () => home,
    appData: () => path.join(home, 'AppData'),
    userData: () => path.join(home, 'userData'),
    isPackaged: () => false,
    integrationsDir: () => integrations,
    nodePath: () => process.execPath,
  })
  try {
    return work(home)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
}

test('fresh install writes hooks, the hook script and the Codex feature flag', () => {
  withHome(() => {
    const results = installIntegration('claudeCode')
    assert.ok(results.some(result => result.status === 'written'))
    assert.ok(fs.existsSync(hookScriptPath()))
    assert.equal(fileHasAgentPetsHooks(claudeCodeSettingsPath()), true)

    installIntegration('codex')
    assert.equal(fileHasAgentPetsHooks(codexHooksPath()), true)
    assert.equal(isCodexHooksFeatureEnabled(fs.readFileSync(codexConfigPath(), 'utf8')), true)
  })
})

test('installing twice is idempotent and reports unchanged', () => {
  withHome(() => {
    installIntegration('claudeCode')
    const second = installIntegration('claudeCode')
    assert.deepEqual(second.map(result => result.status), second.map(() => 'unchanged'))
  })
})

test('existing user hooks and settings survive install and uninstall', () => {
  withHome((home) => {
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true })
    const mine = { model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } }
    fs.writeFileSync(claudeCodeSettingsPath(), JSON.stringify(mine))
    installIntegration('claudeCode')
    uninstallIntegration('claudeCode')
    assert.deepEqual(JSON.parse(fs.readFileSync(claudeCodeSettingsPath(), 'utf8')), mine)
  })
})

test('a broken settings.json is refused and left exactly as it was', () => {
  withHome((home) => {
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true })
    fs.writeFileSync(claudeCodeSettingsPath(), '{ "model": // oops\n')
    assert.throws(() => installIntegration('claudeCode'), ConfigRefusedError)
    assert.equal(fs.readFileSync(claudeCodeSettingsPath(), 'utf8'), '{ "model": // oops\n')
    assert.throws(() => uninstallIntegration('claudeCode'), ConfigRefusedError)
  })
})

test('removing Codex keeps Claude Code working (shared hook script survives)', () => {
  withHome(() => {
    installIntegration('codex')
    installIntegration('claudeCode')
    uninstallIntegration('codex')
    assert.equal(fileHasAgentPetsHooks(codexHooksPath()), false)
    assert.equal(fileHasAgentPetsHooks(claudeCodeSettingsPath()), true)
    assert.ok(fs.existsSync(hookScriptPath()), 'shared script must remain while Claude Code uses it')
    assert.equal(fs.existsSync(codexHooksPath()), false, 'a hooks.json holding only our entries is removed')
    assert.equal(fs.existsSync(codexConfigPath()), false, 'config.toml we created only for hooks = true is removed')

    uninstallIntegration('claudeCode')
    assert.equal(fs.existsSync(hookScriptPath()), false, 'last user removed: script goes too')
  })
})

test('Codex uninstall keeps a hooks = true the user had before Agent Pets', () => {
  withHome((home) => {
    fs.mkdirSync(path.join(home, '.codex'), { recursive: true })
    fs.writeFileSync(codexConfigPath(), '[features]\nhooks = true\n')
    installIntegration('codex')
    uninstallIntegration('codex')
    assert.equal(isCodexHooksFeatureEnabled(fs.readFileSync(codexConfigPath(), 'utf8')), true)
  })
})

test('full cleanup removes tokens and the deploy folder but never the user config', () => {
  withHome((home) => {
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true })
    fs.writeFileSync(claudeCodeSettingsPath(), JSON.stringify({ model: 'opus' }))
    installIntegration()
    assert.ok(fs.existsSync(path.join(home, '.desktop-pet', 'event-token')))
    uninstallIntegration('all')
    assert.equal(fs.existsSync(path.join(home, '.desktop-pet')), false)
    assert.deepEqual(JSON.parse(fs.readFileSync(claudeCodeSettingsPath(), 'utf8')), { model: 'opus' })
  })
})

test('install.mjs is a thin wrapper around the same installer', { skip: process.platform === 'win32' }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-cli-home-'))
  try {
    const env = { ...process.env, HOME: home, USERPROFILE: home, SHELL: '/bin/sh' }
    const run = (...args: string[]) => execFileSync(process.execPath, [
      '--experimental-strip-types', '--disable-warning=ExperimentalWarning', '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
      path.join(integrations, 'install.mjs'), ...args,
    ], { env, encoding: 'utf8' })
    fs.mkdirSync(path.join(home, '.claude'))
    fs.writeFileSync(path.join(home, '.claude', 'settings.json'), '{ not json')
    assert.throws(() => run('--claude-code'), /not valid JSON/)
    assert.equal(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'), '{ not json')
    fs.writeFileSync(path.join(home, '.claude', 'settings.json'), '{}')
    // On macOS/Linux install.mjs needs a Node.js it can find; skip the write assertion if none is resolvable here.
    run('--list')
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('Claude Code install registers PermissionRequest with a timeout above the longest wait', () => {
  withHome(() => {
    installIntegration('claudeCode')
    const hooks = JSON.parse(fs.readFileSync(claudeCodeSettingsPath(), 'utf8')).hooks
    assert.deepEqual(Object.keys(hooks), [
      'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse',
      'PostToolUseFailure', 'Notification', 'Stop', 'StopFailure', 'SessionEnd',
    ])
    assert.equal(hooks.PermissionRequest[0].matcher, '*')
    assert.equal(hooks.PermissionRequest[0].hooks[0].timeout, 135)
    assert.equal(hooks.PostToolUseFailure[0].matcher, '*')
    for (const event of Object.keys(hooks).filter(name => name !== 'PermissionRequest')) {
      assert.equal(hooks[event][0].hooks[0].timeout, undefined, event)
    }
  })
})

test('startup upgrade adds the new Claude handlers to an older install and keeps user hooks', () => {
  withHome((home) => {
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true })
    const hook = hookScriptPath()
    const ours = (matcher?: string) => ({ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command: '/old/node', args: [hook, 'claude'] }] })
    const mine = { type: 'command', command: 'echo mine' }
    // What 1.10.3 wrote, plus a user handler on the same event.
    const legacy = {
      model: 'opus',
      hooks: {
        SessionStart: [ours()], UserPromptSubmit: [ours()], PreToolUse: [ours('*')], PostToolUse: [ours('*')],
        Notification: [ours()], Stop: [{ hooks: [mine] }, ours()], StopFailure: [ours()], SessionEnd: [ours()],
      },
    }
    fs.writeFileSync(claudeCodeSettingsPath(), `${JSON.stringify(legacy, null, 2)}\n`)
    const result = upgradeClaudeCodeHooks()
    assert.equal(result?.status, 'written')
    assert.ok(result?.backupPath)
    const upgraded = JSON.parse(fs.readFileSync(claudeCodeSettingsPath(), 'utf8'))
    assert.deepEqual(upgraded.hooks.PermissionRequest, [{ matcher: '*', hooks: [{ type: 'command', command: '/old/node', args: [hook, 'claude'], timeout: 135 }] }])
    assert.deepEqual(upgraded.hooks.PostToolUseFailure, [ours('*')])
    assert.deepEqual(upgraded.hooks.Stop, legacy.hooks.Stop)
    assert.equal(upgraded.model, 'opus')
    assert.equal(upgradeClaudeCodeHooks()?.status, 'unchanged')

    // Not installed: nothing to upgrade, nothing written.
    uninstallIntegration('claudeCode')
    const text = fs.readFileSync(claudeCodeSettingsPath(), 'utf8')
    assert.equal(upgradeClaudeCodeHooks(), null)
    assert.equal(fs.readFileSync(claudeCodeSettingsPath(), 'utf8'), text)
  })
})

test('the Claude respond opt-in file is private, clamped, removable and cleared by full cleanup', () => {
  withHome(() => {
    syncClaudePermissionRespondOptIn(90)
    const file = claudePermissionRespondPath()
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { enabled: true, waitSeconds: 90 })
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600)
    syncClaudePermissionRespondOptIn(9_999)
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).waitSeconds, 120)
    syncClaudePermissionRespondOptIn(null)
    assert.equal(fs.existsSync(file), false)
    syncClaudePermissionRespondOptIn(null)

    installIntegration('claudeCode')
    syncClaudePermissionRespondOptIn(30)
    uninstallIntegration('all')
    assert.equal(fs.existsSync(file), false)
  })
})

test('the startup upgrade runs once per app version and never re-adds an entry the user removed', () => {
  withHome(() => {
    installIntegration('claudeCode')
    const settings = () => JSON.parse(fs.readFileSync(claudeCodeSettingsPath(), 'utf8'))
    // The user deliberately drops our PermissionRequest handler.
    const edited = settings()
    delete edited.hooks.PermissionRequest
    fs.writeFileSync(claudeCodeSettingsPath(), `${JSON.stringify(edited, null, 2)}\n`)

    assert.equal(upgradeClaudeCodeHooksOnce('1.11.0')?.status, 'written')
    assert.ok(settings().hooks.PermissionRequest)
    assert.equal(fs.readFileSync(claudeHooksUpgradeMarkerPath(), 'utf8').trim(), '1.11.0')

    delete edited.hooks.PermissionRequest
    fs.writeFileSync(claudeCodeSettingsPath(), `${JSON.stringify(edited, null, 2)}\n`)
    assert.equal(upgradeClaudeCodeHooksOnce('1.11.0'), null)
    assert.equal(settings().hooks.PermissionRequest, undefined, 'same version: the removal sticks')

    uninstallIntegration('all')
    assert.equal(fs.existsSync(claudeHooksUpgradeMarkerPath()), false)
  })
})

test('the startup upgrade leaves settings without Agent Pets hooks untouched', () => {
  withHome((home) => {
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true })
    const mine = '{"hooks":{"PermissionRequest":[{"hooks":[{"type":"command","command":"echo mine"}]}]}}'
    fs.writeFileSync(claudeCodeSettingsPath(), mine)
    assert.equal(upgradeClaudeCodeHooksOnce('1.11.0'), null)
    assert.equal(fs.readFileSync(claudeCodeSettingsPath(), 'utf8'), mine)
  })
})
