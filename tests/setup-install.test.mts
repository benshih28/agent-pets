import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { configureSetupEnvironment } from '../electron/setup-environment.ts'
import { AgentConfigDirError, type AgentConfigEnv } from '../electron/agent-config-dirs.ts'
import {
  agentConfigDirStatus,
  agentPresence,
  claudeCodeSettingsPath,
  claudePermissionRespondPath,
  syncClaudePermissionRespondOptIn,
  upgradeClaudeCodeHooks,
  upgradeClaudeCodeHooksOnce,
  claudeHooksUpgradeMarkerPath,
  codexConfigPath,
  codexHooksPath,
  ensureEventToken,
  eventTokenPath,
  serializeInstaller,
  CLAUDE_CODE_HOOK_EVENTS,
  CLAUDE_CODE_UPGRADE_EVENTS,
  CODEX_HOOK_EVENTS,
  hookScriptDeployPath,
  hookScriptPath,
  installIntegration,
  openCodeCliPluginPath,
  refreshInstalledIntegrationScriptsAsync,
  uninstallIntegration,
} from '../electron/setup.ts'
import { codexHookCommand, fileHasAgentPetsHooksAsync, isCodexHooksFeatureEnabled } from '../electron/hook-config.ts'
import { DEPLOY_FILES } from '../src/types/local-wire.ts'
import { ConfigRefusedError } from '../electron/safe-config-write.ts'
import { removeTempTree } from './support/temp-dir.mts'

// Integration tests for the real installer against a throw-away HOME. Nothing here touches the
// user's actual home directory or the macOS Keychain.
const integrations = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'integrations')

// The machine's own CLAUDE_CONFIG_DIR／CODEX_HOME／XDG_CONFIG_HOME must never leak in: tests pass
// their own variables (default: none), so a developer's real config folder is never written.
async function withHome<T>(work: (home: string) => T | Promise<T>, env: (home: string) => AgentConfigEnv = () => ({})): Promise<T> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-setup-home-'))
  const agentEnv = env(home)
  configureSetupEnvironment({
    agentConfigEnv: () => agentEnv,
    homeDir: () => home,
    appData: () => path.join(home, 'AppData'),
    userData: () => path.join(home, 'userData'),
    isPackaged: () => false,
    integrationsDir: () => integrations,
    nodePath: () => process.execPath,
  })
  try {
    return await work(home)
  } finally {
    removeTempTree(home)
  }
}

test('fresh install writes hooks, the hook script and the Codex feature flag', async () => {
  await withHome(async () => {
    const results = await installIntegration('claudeCode')
    assert.ok(results.some(result => result.status === 'written'))
    assert.ok(fs.existsSync(hookScriptPath()))
    assert.equal(await fileHasAgentPetsHooksAsync(claudeCodeSettingsPath()), true)

    await installIntegration('codex')
    assert.equal(await fileHasAgentPetsHooksAsync(codexHooksPath()), true)
    assert.equal(isCodexHooksFeatureEnabled(fs.readFileSync(codexConfigPath(), 'utf8')), true)
  })
})

// 寫進使用者 dotfile 的 JSON 是外部契約：逐位元組鎖住新安裝的完整輸出（事件與鍵的順序、只有工具
// 事件有 matcher、只有 PermissionRequest 有 timeout、Codex 的頂層 description），型別重構不得改變任何字元。
test('a fresh Claude Code install writes exactly the expected settings.json bytes', async () => {
  await withHome(async () => {
    await installIntegration('claudeCode')
    const args = [hookScriptPath(), 'claude']
    const plain = { hooks: [{ type: 'command', command: process.execPath, args }] }
    // matcher 在現行輸出中排在 hooks 之後；比對原始字串才鎖得住鍵順序。
    const tool = { hooks: plain.hooks, matcher: '*' }
    const expected = {
      hooks: {
        SessionStart: [plain],
        UserPromptSubmit: [plain],
        PreToolUse: [tool],
        PermissionRequest: [{ hooks: [{ type: 'command', command: process.execPath, args, timeout: 135 }], matcher: '*' }],
        PostToolUse: [tool],
        PostToolUseFailure: [tool],
        Notification: [plain],
        Stop: [plain],
        StopFailure: [plain],
        PreCompact: [plain],
        PostCompact: [plain],
        SessionEnd: [plain],
      },
    }
    assert.equal(fs.readFileSync(claudeCodeSettingsPath(), 'utf8'), `${JSON.stringify(expected, null, 2)}\n`)
  })
})

test('a fresh Codex install writes exactly the expected hooks.json bytes', async () => {
  await withHome(async () => {
    await installIntegration('codex')
    const isWindows = process.platform === 'win32'
    const command = codexHookCommand({
      isWindows,
      nodeBin: isWindows ? '' : process.execPath,
      hookScript: hookScriptPath(),
      wrapper: path.join(hookScriptDeployPath(), DEPLOY_FILES.hookWrapper),
    })
    const entry = [{ hooks: [{ type: 'command', command, statusMessage: 'Updating Agent Pets status' }] }]
    const expected = {
      description: 'Agent Pets lifecycle hooks for Codex CLI.',
      hooks: {
        SessionStart: entry,
        UserPromptSubmit: entry,
        PreToolUse: entry,
        PermissionRequest: entry,
        PostToolUse: entry,
        Stop: entry,
        SessionEnd: entry,
      },
    }
    assert.equal(fs.readFileSync(codexHooksPath(), 'utf8'), `${JSON.stringify(expected, null, 2)}\n`)
  })
})

test('installing twice is idempotent and reports unchanged', async () => {
  await withHome(async () => {
    await installIntegration('claudeCode')
    const second = await installIntegration('claudeCode')
    assert.deepEqual(second.map(result => result.status), second.map(() => 'unchanged'))
  })
})

test('existing user hooks and settings survive install and uninstall', async () => {
  await withHome(async (home) => {
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true })
    const mine = { model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } }
    fs.writeFileSync(claudeCodeSettingsPath(), JSON.stringify(mine))
    await installIntegration('claudeCode')
    await uninstallIntegration('claudeCode')
    assert.deepEqual(JSON.parse(fs.readFileSync(claudeCodeSettingsPath(), 'utf8')), mine)
  })
})

test('a broken settings.json is refused and left exactly as it was', async () => {
  await withHome(async (home) => {
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true })
    fs.writeFileSync(claudeCodeSettingsPath(), '{ "model": // oops\n')
    await assert.rejects(() => installIntegration('claudeCode'), ConfigRefusedError)
    assert.equal(fs.readFileSync(claudeCodeSettingsPath(), 'utf8'), '{ "model": // oops\n')
    await assert.rejects(() => uninstallIntegration('claudeCode'), ConfigRefusedError)
  })
})

test('removing Codex keeps Claude Code working (shared hook script survives)', async () => {
  await withHome(async () => {
    await installIntegration('codex')
    await installIntegration('claudeCode')
    await uninstallIntegration('codex')
    assert.equal(await fileHasAgentPetsHooksAsync(codexHooksPath()), false)
    assert.equal(await fileHasAgentPetsHooksAsync(claudeCodeSettingsPath()), true)
    assert.ok(fs.existsSync(hookScriptPath()), 'shared script must remain while Claude Code uses it')
    assert.equal(fs.existsSync(codexHooksPath()), false, 'a hooks.json holding only our entries is removed')
    assert.equal(fs.existsSync(codexConfigPath()), false, 'config.toml we created only for hooks = true is removed')

    await uninstallIntegration('claudeCode')
    assert.equal(fs.existsSync(hookScriptPath()), false, 'last user removed: script goes too')
  })
})

test('Codex uninstall keeps a hooks = true the user had before Agent Pets', async () => {
  await withHome(async (home) => {
    fs.mkdirSync(path.join(home, '.codex'), { recursive: true })
    fs.writeFileSync(codexConfigPath(), '[features]\nhooks = true\n')
    await installIntegration('codex')
    await uninstallIntegration('codex')
    assert.equal(isCodexHooksFeatureEnabled(fs.readFileSync(codexConfigPath(), 'utf8')), true)
  })
})

test('full cleanup removes tokens and the deploy folder but never the user config', async () => {
  await withHome(async (home) => {
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true })
    fs.writeFileSync(claudeCodeSettingsPath(), JSON.stringify({ model: 'opus' }))
    await installIntegration()
    assert.ok(fs.existsSync(path.join(home, '.desktop-pet', 'event-token')))
    await uninstallIntegration('all')
    assert.equal(fs.existsSync(path.join(home, '.desktop-pet')), false)
    assert.deepEqual(JSON.parse(fs.readFileSync(claudeCodeSettingsPath(), 'utf8')), { model: 'opus' })
  })
})

test('install.mjs is a thin wrapper around the same installer', { skip: process.platform === 'win32' }, async () => {
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
    removeTempTree(home)
  }
})

test('Claude Code install registers PermissionRequest with a timeout above the longest wait', async () => {
  await withHome(async () => {
    await installIntegration('claudeCode')
    const hooks = JSON.parse(fs.readFileSync(claudeCodeSettingsPath(), 'utf8')).hooks
    assert.deepEqual(Object.keys(hooks), [
      'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse',
      'PostToolUseFailure', 'Notification', 'Stop', 'StopFailure', 'PreCompact', 'PostCompact', 'SessionEnd',
    ])
    for (const event of ['PreCompact', 'PostCompact']) {
      assert.equal(hooks[event].length, 1, event)
      assert.equal(hooks[event][0].matcher, undefined, `${event} is not a tool event`)
    }
    assert.equal(hooks.PermissionRequest[0].matcher, '*')
    assert.equal(hooks.PermissionRequest[0].hooks[0].timeout, 135)
    assert.equal(hooks.PostToolUseFailure[0].matcher, '*')
    for (const event of Object.keys(hooks).filter(name => name !== 'PermissionRequest')) {
      assert.equal(hooks[event][0].hooks[0].timeout, undefined, event)
    }
  })
})

test('startup upgrade adds the new Claude handlers to an older install and keeps user hooks', async () => {
  await withHome(async (home) => {
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
    const result = await upgradeClaudeCodeHooks()
    assert.equal(result?.status, 'written')
    assert.ok(result?.backupPath)
    const upgraded = JSON.parse(fs.readFileSync(claudeCodeSettingsPath(), 'utf8'))
    assert.deepEqual(upgraded.hooks.PermissionRequest, [{ matcher: '*', hooks: [{ type: 'command', command: '/old/node', args: [hook, 'claude'], timeout: 135 }] }])
    assert.deepEqual(upgraded.hooks.PostToolUseFailure, [ours('*')])
    assert.deepEqual(upgraded.hooks.Stop, legacy.hooks.Stop)
    assert.equal(upgraded.model, 'opus')
    assert.equal((await upgradeClaudeCodeHooks())?.status, 'unchanged')

    // Not installed: nothing to upgrade, nothing written.
    await uninstallIntegration('claudeCode')
    const text = fs.readFileSync(claudeCodeSettingsPath(), 'utf8')
    assert.equal(await upgradeClaudeCodeHooks(), null)
    assert.equal(fs.readFileSync(claudeCodeSettingsPath(), 'utf8'), text)
  })
})

// 1.10.x 之前只裝這七個事件；之後新增的事件都得靠啟動升級補給舊安裝。
const ORIGINAL_CLAUDE_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'SessionEnd']

test('every installed Claude Code event is either an original one or in the startup upgrade list', () => {
  const original = new Set(ORIGINAL_CLAUDE_EVENTS)
  // 事件清單是字面值聯集；這裡要拿任意字串去查，所以放寬成 string。
  const installed: readonly string[] = CLAUDE_CODE_HOOK_EVENTS
  const upgrade = new Set<string>(CLAUDE_CODE_UPGRADE_EVENTS)
  for (const event of installed) assert.ok(original.has(event) || upgrade.has(event), `${event} would never reach existing installs`)
  for (const event of upgrade) assert.ok(installed.includes(event) && !original.has(event), event)
  for (const event of ['StopFailure', 'PreCompact', 'PostCompact']) assert.ok(upgrade.has(event), event)
})

test('Codex keeps its fixed event list (new Claude events are not mirrored: Codex re-trusts every new hook)', () => {
  assert.deepEqual(CODEX_HOOK_EVENTS, ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'Stop', 'SessionEnd'])
})

test('the startup upgrade gives an old install StopFailure, PreCompact and PostCompact exactly once', async () => {
  await withHome(async (home) => {
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true })
    const hook = hookScriptPath()
    const ours = (matcher?: string) => ({ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command: '/old/node', args: [hook, 'claude'] }] })
    const mine = { type: 'command', command: 'echo mine' }
    // 只有原始七個事件（含使用者自己的 Stop 與 PreCompact handler），沒有 StopFailure。
    const legacy = {
      model: 'opus',
      hooks: {
        SessionStart: [ours()], UserPromptSubmit: [ours()], PreToolUse: [ours('*')], PostToolUse: [ours('*')],
        Notification: [ours()], Stop: [{ hooks: [mine] }, ours()], SessionEnd: [ours()],
        PreCompact: [{ hooks: [mine] }],
      },
    }
    fs.writeFileSync(claudeCodeSettingsPath(), `${JSON.stringify(legacy, null, 2)}\n`)
    const result = await upgradeClaudeCodeHooksOnce('2.0.0')
    assert.equal(result?.status, 'written')
    assert.ok(result?.backupPath && fs.existsSync(result.backupPath))
    assert.deepEqual(JSON.parse(fs.readFileSync(result.backupPath, 'utf8')), legacy, 'the backup holds the pre-upgrade file')

    const upgraded = JSON.parse(fs.readFileSync(claudeCodeSettingsPath(), 'utf8'))
    for (const event of ['StopFailure', 'PostCompact']) assert.deepEqual(upgraded.hooks[event], [ours()].map(entry => ({ hooks: entry.hooks })), event)
    assert.deepEqual(upgraded.hooks.PreCompact, [{ hooks: [mine] }, ours()], 'the user handler stays; ours is appended')
    assert.deepEqual(upgraded.hooks.Stop, legacy.hooks.Stop)
    assert.equal(upgraded.model, 'opus')

    const after = fs.readFileSync(claudeCodeSettingsPath(), 'utf8')
    assert.equal(await upgradeClaudeCodeHooksOnce('2.0.0'), null, 'same version: marker short-circuits')
    assert.equal((await upgradeClaudeCodeHooks())?.status, 'unchanged', 'nothing left to add')
    assert.equal(fs.readFileSync(claudeCodeSettingsPath(), 'utf8'), after)
  })
})

test('overlapping install and uninstall requests are serialized and never interleave writes', async () => {
  await withHome(async () => {
    const order: string[] = []
    // rename 到 settings.json 前後各讓出事件迴圈：若兩個請求並行，start/end 就會交錯。
    const settings = claudeCodeSettingsPath()
    await installIntegration('claudeCode')
    const original = fs.promises.rename
    fs.promises.rename = (async (from: fs.PathLike, to: fs.PathLike) => {
      if (String(to) === settings) {
        order.push('rename:start')
        await new Promise(resolve => setTimeout(resolve, 15))
        await original(from, to)
        order.push('rename:end')
        return
      }
      await original(from, to)
    }) as typeof fs.promises.rename
    syncBuiltinESMExports()
    try {
      const results = await Promise.allSettled([
        uninstallIntegration('claudeCode'),
        installIntegration('claudeCode'),
        uninstallIntegration('claudeCode'),
        installIntegration('claudeCode'),
      ])
      assert.deepEqual(results.map(result => result.status), ['fulfilled', 'fulfilled', 'fulfilled', 'fulfilled'])
    } finally {
      fs.promises.rename = original
      syncBuiltinESMExports()
    }
    // 每一次 rename 都完整結束才開始下一次。
    assert.deepEqual(order, order.map((_entry, index) => (index % 2 === 0 ? 'rename:start' : 'rename:end')))
    assert.ok(order.length >= 4)
    // 排隊順序即結果順序：最後一個請求是 install，所以最終是已安裝。
    assert.equal(await fileHasAgentPetsHooksAsync(settings), true)
    const hooks = JSON.parse(fs.readFileSync(settings, 'utf8')).hooks
    for (const event of CLAUDE_CODE_HOOK_EVENTS) assert.equal(hooks[event].length, 1, `${event} has exactly one Agent Pets entry`)
  })
})

test('a failed request does not block the ones queued behind it', async () => {
  await withHome(async (home) => {
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true })
    fs.writeFileSync(claudeCodeSettingsPath(), '{ broken')
    const [bad, good] = await Promise.allSettled([installIntegration('claudeCode'), installIntegration('opencode')])
    assert.equal(bad.status, 'rejected')
    assert.equal(good.status, 'fulfilled')
    assert.equal(fs.readFileSync(claudeCodeSettingsPath(), 'utf8'), '{ broken')
  })
})

test('the startup refresh repairs deployed scripts and upgrades Claude hooks without blocking, in queue order', async () => {
  await withHome(async () => {
    await installIntegration('claudeCode')
    fs.writeFileSync(hookScriptPath(), '// stale\n')
    await refreshInstalledIntegrationScriptsAsync('9.9.9')
    assert.notEqual(fs.readFileSync(hookScriptPath(), 'utf8'), '// stale\n')
    assert.equal(fs.readFileSync(claudeHooksUpgradeMarkerPath(), 'utf8').trim(), '9.9.9')
  })
})

test('the Claude respond opt-in file is private, clamped, removable and cleared by full cleanup', async () => {
  await withHome(async () => {
    syncClaudePermissionRespondOptIn(90)
    const file = claudePermissionRespondPath()
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { enabled: true, waitSeconds: 90 })
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600)
    syncClaudePermissionRespondOptIn(9_999)
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).waitSeconds, 120)
    syncClaudePermissionRespondOptIn(null)
    assert.equal(fs.existsSync(file), false)
    syncClaudePermissionRespondOptIn(null)

    await installIntegration('claudeCode')
    syncClaudePermissionRespondOptIn(30)
    await uninstallIntegration('all')
    assert.equal(fs.existsSync(file), false)
  })
})

test('the startup upgrade runs once per app version and never re-adds an entry the user removed', async () => {
  await withHome(async () => {
    await installIntegration('claudeCode')
    const settings = () => JSON.parse(fs.readFileSync(claudeCodeSettingsPath(), 'utf8'))
    // The user deliberately drops our PermissionRequest handler.
    const edited = settings()
    delete edited.hooks.PermissionRequest
    fs.writeFileSync(claudeCodeSettingsPath(), `${JSON.stringify(edited, null, 2)}\n`)

    assert.equal((await upgradeClaudeCodeHooksOnce('1.11.0'))?.status, 'written')
    assert.ok(settings().hooks.PermissionRequest)
    assert.equal(fs.readFileSync(claudeHooksUpgradeMarkerPath(), 'utf8').trim(), '1.11.0')

    delete edited.hooks.PermissionRequest
    fs.writeFileSync(claudeCodeSettingsPath(), `${JSON.stringify(edited, null, 2)}\n`)
    assert.equal(await upgradeClaudeCodeHooksOnce('1.11.0'), null)
    assert.equal(settings().hooks.PermissionRequest, undefined, 'same version: the removal sticks')

    await uninstallIntegration('all')
    assert.equal(fs.existsSync(claudeHooksUpgradeMarkerPath()), false)
  })
})

test('the startup upgrade leaves settings without Agent Pets hooks untouched', async () => {
  await withHome(async (home) => {
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true })
    const mine = '{"hooks":{"PermissionRequest":[{"hooks":[{"type":"command","command":"echo mine"}]}]}}'
    fs.writeFileSync(claudeCodeSettingsPath(), mine)
    assert.equal(await upgradeClaudeCodeHooksOnce('1.11.0'), null)
    assert.equal(fs.readFileSync(claudeCodeSettingsPath(), 'utf8'), mine)
  })
})

// --- CLAUDE_CONFIG_DIR／CODEX_HOME／XDG_CONFIG_HOME ------------------------------------------------

function made(dir: string): string {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

test('without the variables every path and status is the 1.12.5 default', async () => {
  await withHome(async (home) => {
    assert.equal(claudeCodeSettingsPath(), path.join(home, '.claude', 'settings.json'))
    assert.equal(codexHooksPath(), path.join(home, '.codex', 'hooks.json'))
    assert.equal(codexConfigPath(), path.join(home, '.codex', 'config.toml'))
    assert.equal(openCodeCliPluginPath(), path.join(home, '.config', 'opencode', 'plugin', 'desktop-pet.js'))
    await installIntegration()
    for (const kind of ['claude', 'codex', 'opencode'] as const) {
      const status = await agentConfigDirStatus(kind)
      assert.equal(status.source, 'default')
      assert.equal(status.ignored, undefined)
      assert.equal(status.staleLocation, undefined)
    }
  })
})

test('CLAUDE_CONFIG_DIR and CODEX_HOME receive the hooks; the default folders stay untouched', async () => {
  await withHome(async (home) => {
    await installIntegration('claudeCode')
    await installIntegration('codex')
    const claudeDir = path.join(home, 'work', 'claude')
    const codexHome = path.join(home, 'work', 'codex')
    assert.equal(await fileHasAgentPetsHooksAsync(path.join(claudeDir, 'settings.json')), true)
    assert.equal(await fileHasAgentPetsHooksAsync(path.join(codexHome, 'hooks.json')), true)
    assert.equal(isCodexHooksFeatureEnabled(fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8')), true)
    assert.equal(fs.existsSync(path.join(home, '.claude')), false)
    assert.equal(fs.existsSync(path.join(home, '.codex')), false)
    assert.deepEqual({ ...await agentPresence(), opencode: false }, { claude: true, codex: true, opencode: false })
    const status = await agentConfigDirStatus('claude')
    assert.deepEqual(status, { variable: 'CLAUDE_CONFIG_DIR', path: claudeDir, source: 'env' })
  }, home => ({
    CLAUDE_CONFIG_DIR: made(path.join(home, 'work', 'claude')),
    CODEX_HOME: made(path.join(home, 'work', 'codex')),
  }))
})

test('XDG_CONFIG_HOME moves the OpenCode CLI plugin', async () => {
  await withHome(async (home) => {
    await installIntegration('opencode')
    assert.ok(fs.existsSync(path.join(home, 'xdg', 'opencode', 'plugin', 'desktop-pet.js')))
    assert.equal(fs.existsSync(path.join(home, '.config', 'opencode')), false)
  }, home => ({ XDG_CONFIG_HOME: path.join(home, 'xdg') }))
})

test('an unusable variable refuses the install and writes nothing anywhere', async () => {
  const cases: Array<[Parameters<typeof installIntegration>[0], (home: string) => AgentConfigEnv]> = [
    ['claudeCode', () => ({ CLAUDE_CONFIG_DIR: 'relative/claude' })],
    ['claudeCode', home => ({ CLAUDE_CONFIG_DIR: path.join(home, 'not-created') })],
    ['codex', home => ({ CODEX_HOME: path.join(home, 'not-created') })],
    ['codex', () => ({ CODEX_HOME: '~/codex' })],
    ['opencode', () => ({ XDG_CONFIG_HOME: 'relative' })],
  ]
  for (const [target, env] of cases) {
    await withHome(async (home) => {
      await assert.rejects(() => installIntegration(target), AgentConfigDirError, JSON.stringify(env(home)))
      assert.deepEqual(fs.readdirSync(home), [], 'not even the hook script or tokens are written')
    }, env)
  }
})

test('an ignored variable is reported without its value, and reads fall back to the default', async () => {
  await withHome(async (home) => {
    const status = await agentConfigDirStatus('codex')
    assert.deepEqual(status, { variable: 'CODEX_HOME', path: path.join(home, '.codex'), source: 'default', ignored: 'missing' })
  }, () => ({ CODEX_HOME: path.join(os.tmpdir(), 'agent-pets-missing-codex-home-x9') }))
})

test('setting the variables after installing reports the old location and uninstall clears both', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-setup-move-'))
  try {
    await withHomeAt(home, {}, async () => {
      await installIntegration()
    })
    const moved = {
      CLAUDE_CONFIG_DIR: made(path.join(home, 'moved', 'claude')),
      CODEX_HOME: made(path.join(home, 'moved', 'codex')),
      XDG_CONFIG_HOME: path.join(home, 'moved', 'xdg'),
    }
    await withHomeAt(home, moved, async () => {
      assert.equal((await agentConfigDirStatus('claude')).staleLocation, path.join(home, '.claude', 'settings.json'))
      assert.equal((await agentConfigDirStatus('codex')).staleLocation, path.join(home, '.codex', 'hooks.json'))
      assert.equal((await agentConfigDirStatus('opencode')).staleLocation, path.join(home, '.config', 'opencode', 'plugin', 'desktop-pet.js'))
      await installIntegration()
      await uninstallIntegration()
      for (const file of [
        path.join(home, '.claude', 'settings.json'), path.join(moved.CLAUDE_CONFIG_DIR, 'settings.json'),
        path.join(home, '.codex', 'hooks.json'), path.join(moved.CODEX_HOME, 'hooks.json'),
      ]) assert.equal(await fileHasAgentPetsHooksAsync(file), false, file)
      assert.equal(fs.existsSync(path.join(home, '.config', 'opencode', 'plugin', 'desktop-pet.js')), false)
      assert.equal(fs.existsSync(path.join(moved.XDG_CONFIG_HOME, 'opencode', 'plugin', 'desktop-pet.js')), false)
      assert.equal(fs.existsSync(hookScriptPath()), false, 'no remaining config refers to the shared script')
      for (const kind of ['claude', 'codex', 'opencode'] as const) assert.equal((await agentConfigDirStatus(kind)).staleLocation, undefined)
    })
  } finally {
    removeTempTree(home)
  }
})

test('the shared hook script stays while only the old location still uses it', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-setup-stale-'))
  try {
    await withHomeAt(home, {}, async () => { await installIntegration('claudeCode') })
    await withHomeAt(home, { CLAUDE_CONFIG_DIR: made(path.join(home, 'moved')) }, async () => {
      await uninstallIntegration('codex')
      assert.ok(fs.existsSync(hookScriptPath()), 'the default settings.json still runs the script')
    })
  } finally {
    removeTempTree(home)
  }
})

async function withHomeAt(home: string, env: AgentConfigEnv, work: () => void | Promise<void>): Promise<void> {
  configureSetupEnvironment({
    agentConfigEnv: () => env,
    homeDir: () => home,
    appData: () => path.join(home, 'AppData'),
    userData: () => path.join(home, 'userData'),
    isPackaged: () => false,
    integrationsDir: () => integrations,
    nodePath: () => process.execPath,
  })
  await work()
}

const VALID_TOKEN = /^[a-f0-9]{64}\n$/

test('regenerating an invalid token replaces the file instead of truncating it in place (sync)', async () => {
  await withHome(async () => {
    fs.mkdirSync(path.dirname(eventTokenPath()), { recursive: true })
    fs.writeFileSync(eventTokenPath(), 'garbage\n', { mode: 0o600 })
    const before = fs.statSync(eventTokenPath()).ino
    const token = ensureEventToken()
    assert.match(fs.readFileSync(eventTokenPath(), 'utf8'), VALID_TOKEN)
    assert.equal(fs.readFileSync(eventTokenPath(), 'utf8').trim(), token)
    // 新 inode = 暫存檔 + rename；原地以 'w' 截斷會沿用同一個 inode，讀取端就可能看到空檔。
    assert.notEqual(fs.statSync(eventTokenPath()).ino, before)
    assert.deepEqual(fs.readdirSync(path.dirname(eventTokenPath())).filter(name => name.endsWith('.tmp')), [])
    assert.equal(ensureEventToken(), token, 'a valid token is reused')
  })
})

test('a reader never sees an empty or partial token while the async install regenerates it', async () => {
  await withHome(async () => {
    fs.mkdirSync(path.dirname(eventTokenPath()), { recursive: true })
    fs.writeFileSync(eventTokenPath(), 'garbage\n', { mode: 0o600 })
    const before = fs.statSync(eventTokenPath()).ino
    let done = false
    const observed = new Set<string>()
    const reader = (async () => {
      while (!done) {
        try { observed.add(fs.readFileSync(eventTokenPath(), 'utf8')) } catch { observed.add('<missing>') }
        await new Promise(resolve => setImmediate(resolve))
      }
    })()
    await installIntegration('claudeCode')
    done = true
    await reader
    for (const value of observed) assert.ok(value === 'garbage\n' || VALID_TOKEN.test(value), `unexpected token content ${JSON.stringify(value)}`)
    assert.match(fs.readFileSync(eventTokenPath(), 'utf8'), VALID_TOKEN)
    assert.notEqual(fs.statSync(eventTokenPath()).ino, before)
  })
})

test('a symlinked token path is refused and its target is not written', async () => {
  await withHome(async (home) => {
    const victim = path.join(home, 'victim')
    fs.writeFileSync(victim, 'keep')
    fs.mkdirSync(path.dirname(eventTokenPath()), { recursive: true })
    try { fs.symlinkSync(victim, eventTokenPath()) } catch { return }
    assert.throws(() => ensureEventToken(), /not a regular file/)
    await assert.rejects(installIntegration('claudeCode'), /not a regular file/)
    assert.equal(fs.readFileSync(victim, 'utf8'), 'keep')
  })
})

test('the installer queue runs tasks one at a time without handing them the previous result or error', async () => {
  const received: unknown[][] = []
  const order: string[] = []
  const failing = serializeInstaller(async (...args: unknown[]) => {
    received.push(args)
    order.push('fail-start')
    await new Promise(resolve => setTimeout(resolve, 5))
    order.push('fail-end')
    throw new Error('previous failure')
  })
  const next = serializeInstaller(async (...args: unknown[]) => {
    received.push(args)
    order.push('next')
    return 'ok'
  })
  const after = serializeInstaller(async (...args: unknown[]) => {
    received.push(args)
    return 'after'
  })
  await assert.rejects(failing, /previous failure/)
  assert.equal(await next, 'ok')
  assert.equal(await after, 'after')
  assert.deepEqual(order, ['fail-start', 'fail-end', 'next'])
  assert.deepEqual(received, [[], [], []])
})
