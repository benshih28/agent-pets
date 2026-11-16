import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  disableCodexHooksFeatureText,
  ensureAgentPetsHookEntries,
  enableCodexHooksFeatureText,
  fileHasAgentPetsHooksAsync,
  isAgentPetsHook,
  isLegacyElectronHook,
  mergeAgentPetsHooksFile,
  removeAgentPetsHooksFile,
  removeJsonKeyFile,
  setJsonKeyFile,
} from '../electron/hook-config.ts'
import type { HookMatcherEntry } from '../electron/hook-config.ts'
import {
  BACKUP_MARKER,
  ConfigRefusedError,
  listBackups,
  writeConfigSafely,
  writeTextAtomic,
} from '../electron/safe-config-write.ts'
import { SKIP_WITHOUT_FILE_SYMLINKS } from './support/fs-capabilities.mts'
import { removeTempTree } from './support/temp-dir.mts'

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-hook-config-'))
}

const HOOK = '/home/u/.desktop-pet/agent-hook.mjs'
function ours(extra: Record<string, unknown> = {}): HookMatcherEntry {
  return { hooks: [{ type: 'command', command: 'node', args: [HOOK, 'claude'] }], ...extra }
}
function desired() {
  return { SessionStart: [ours()], Stop: [ours()] }
}

test('merge refuses unparseable JSON and leaves the file untouched', async () => {
  const dir = tempDir()
  try {
    const file = path.join(dir, 'settings.json')
    const original = '{ "model": "opus", // comment\n "permissions": {} }'
    fs.writeFileSync(file, original)
    await assert.rejects(() => mergeAgentPetsHooksFile(file, desired()), (error: unknown) => (
      error instanceof ConfigRefusedError && error.code === 'unparseable' && error.message.includes(file)
    ))
    assert.equal(fs.readFileSync(file, 'utf8'), original)
    assert.deepEqual(listBackups(file), [])
  } finally { removeTempTree(dir) }
})

test('merge refuses non-object roots and malformed hooks values', async () => {
  const dir = tempDir()
  try {
    const file = path.join(dir, 'settings.json')
    fs.writeFileSync(file, '[1,2]')
    await assert.rejects(() => mergeAgentPetsHooksFile(file, desired()), ConfigRefusedError)
    fs.writeFileSync(file, '{"hooks": "nope"}')
    await assert.rejects(() => mergeAgentPetsHooksFile(file, desired()), ConfigRefusedError)
    fs.writeFileSync(file, '{"hooks": {"Stop": "nope"}}')
    await assert.rejects(() => mergeAgentPetsHooksFile(file, desired()), ConfigRefusedError)
    assert.equal(fs.readFileSync(file, 'utf8'), '{"hooks": {"Stop": "nope"}}')
  } finally { removeTempTree(dir) }
})

test('merge keeps user keys and hooks, backs up, and is idempotent', async () => {
  const dir = tempDir()
  try {
    const file = path.join(dir, 'settings.json')
    const user = { model: 'opus', permissions: { allow: ['Bash(ls)'] }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] } }
    fs.writeFileSync(file, JSON.stringify(user))

    const first = await mergeAgentPetsHooksFile(file, desired())
    assert.equal(first.status, 'written')
    assert.ok(first.backupPath && fs.existsSync(first.backupPath))
    assert.equal(first.backupPath && JSON.parse(fs.readFileSync(first.backupPath, 'utf8')).model, 'opus')
    const merged = JSON.parse(fs.readFileSync(file, 'utf8'))
    assert.equal(merged.model, 'opus')
    assert.deepEqual(merged.permissions, user.permissions)
    assert.equal(merged.hooks.Stop.length, 2)
    assert.equal(merged.hooks.Stop[0].hooks[0].command, 'echo hi')
    assert.equal(merged.hooks.SessionStart.length, 1)

    const second = await mergeAgentPetsHooksFile(file, desired())
    assert.equal(second.status, 'unchanged')
    assert.equal(second.backupPath, null)
    assert.equal(listBackups(file).length, 1)
  } finally { removeTempTree(dir) }
})

test('merge creates a missing file from defaults without a backup', async () => {
  const dir = tempDir()
  try {
    const file = path.join(dir, 'nested', 'hooks.json')
    const result = await mergeAgentPetsHooksFile(file, desired(), { description: 'Agent Pets' })
    assert.equal(result.backupPath, null)
    const written = JSON.parse(fs.readFileSync(file, 'utf8'))
    assert.equal(written.description, 'Agent Pets')
    assert.ok(await fileHasAgentPetsHooksAsync(file))
  } finally { removeTempTree(dir) }
})

test('merge treats an empty file as an empty object', async () => {
  const dir = tempDir()
  try {
    const file = path.join(dir, 'settings.json')
    fs.writeFileSync(file, '')
    await mergeAgentPetsHooksFile(file, desired())
    assert.ok(await fileHasAgentPetsHooksAsync(file))
  } finally { removeTempTree(dir) }
})

test('backups are pruned to the most recent entries', () => {
  const dir = tempDir()
  try {
    const file = path.join(dir, 'a.json')
    fs.writeFileSync(file, '{}')
    for (let index = 0; index < 8; index += 1) writeConfigSafely(file, `{"n":${index}}\n`)
    const backups = listBackups(file)
    assert.equal(backups.length, 5)
    assert.ok(backups.every(name => path.basename(name).includes(BACKUP_MARKER)))
  } finally { removeTempTree(dir) }
})

test('writes go through a symlink to the real target and preserve file mode', { skip: process.platform === 'win32' }, async () => {
  const dir = tempDir()
  try {
    const real = path.join(dir, 'real.json')
    const link = path.join(dir, 'link.json')
    fs.writeFileSync(real, '{}', { mode: 0o640 })
    fs.chmodSync(real, 0o640)
    fs.symlinkSync(real, link)
    await mergeAgentPetsHooksFile(link, desired())
    assert.ok(fs.lstatSync(link).isSymbolicLink())
    assert.ok(await fileHasAgentPetsHooksAsync(real))
    assert.equal(fs.statSync(real).mode & 0o777, 0o640)
  } finally { removeTempTree(dir) }
})

test('concurrent atomic writers never leave a partial file', () => {
  const dir = tempDir()
  try {
    const file = path.join(dir, 'x.json')
    for (let index = 0; index < 20; index += 1) writeTextAtomic(file, JSON.stringify({ index }))
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { index: 19 })
    assert.deepEqual(fs.readdirSync(dir).filter(name => name.endsWith('.tmp')), [])
  } finally { removeTempTree(dir) }
})

test('remove only strips Agent Pets hooks and keeps user hooks and keys', async () => {
  const dir = tempDir()
  try {
    const file = path.join(dir, 'settings.json')
    fs.writeFileSync(file, JSON.stringify({ model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] } }))
    await mergeAgentPetsHooksFile(file, desired())
    const result = await removeAgentPetsHooksFile(file)
    assert.equal(result.status, 'removed')
    const after = JSON.parse(fs.readFileSync(file, 'utf8'))
    assert.equal(after.model, 'opus')
    assert.deepEqual(Object.keys(after.hooks), ['Stop'])
    assert.equal(after.hooks.Stop[0].hooks[0].command, 'echo hi')
    assert.equal((await removeAgentPetsHooksFile(file)).status, 'absent')
  } finally { removeTempTree(dir) }
})

test('remove deletes a hooks file that only contained Agent Pets content', async () => {
  const dir = tempDir()
  try {
    const file = path.join(dir, 'hooks.json')
    await mergeAgentPetsHooksFile(file, desired(), { description: 'Agent Pets' })
    const result = await removeAgentPetsHooksFile(file, { description: 'Agent Pets' })
    assert.equal(result.status, 'deleted_file')
    assert.equal(fs.existsSync(file), false)
  } finally { removeTempTree(dir) }
})

test('remove refuses to touch an unparseable file', async () => {
  const dir = tempDir()
  try {
    const file = path.join(dir, 'settings.json')
    fs.writeFileSync(file, '{ broken')
    await assert.rejects(() => removeAgentPetsHooksFile(file), ConfigRefusedError)
    assert.equal(fs.readFileSync(file, 'utf8'), '{ broken')
  } finally { removeTempTree(dir) }
})

test('single-key helpers only remove a value Agent Pets wrote', async () => {
  const dir = tempDir()
  try {
    const file = path.join(dir, 'claude_desktop_config.json')
    fs.writeFileSync(file, JSON.stringify({ mcpServers: { a: 1 } }))
    assert.equal((await setJsonKeyFile(file, 'agent', HOOK)).status, 'written')
    assert.equal((await setJsonKeyFile(file, 'agent', HOOK)).status, 'unchanged')
    assert.equal((await removeJsonKeyFile(file, 'agent', '/something/else')).status, 'absent')
    assert.equal((await removeJsonKeyFile(file, 'agent', HOOK)).status, 'removed')
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { mcpServers: { a: 1 } })
  } finally { removeTempTree(dir) }
})

test('codex feature text: enable adds once, disable reverts only that line', () => {
  const fresh = enableCodexHooksFeatureText('')
  assert.equal(fresh.added, true)
  assert.equal(fresh.content, '[features]\nhooks = true\n')
  assert.equal(disableCodexHooksFeatureText(fresh.content), '')

  const base = 'model = "x"\n\n[features]\nother = true\n\n[tui]\nx = 1\n'
  const enabled = enableCodexHooksFeatureText(base)
  assert.equal(enabled.added, true)
  assert.ok(enabled.content.includes('hooks = true'))
  const reverted = disableCodexHooksFeatureText(enabled.content)
  assert.equal(reverted, base)

  const already = enableCodexHooksFeatureText('[features]\nhooks = false\n')
  assert.equal(already.added, false)
  assert.equal(already.content, '[features]\nhooks = true\n')
})

test('removing Codex hooks leaves Claude Code hooks (shared script) intact', async () => {
  const dir = tempDir()
  try {
    const codex = path.join(dir, 'hooks.json')
    const claude = path.join(dir, 'settings.json')
    fs.writeFileSync(codex, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } }))
    await mergeAgentPetsHooksFile(codex, desired())
    await mergeAgentPetsHooksFile(claude, desired())
    await removeAgentPetsHooksFile(codex, { description: 'Agent Pets lifecycle hooks for Codex CLI.' })
    assert.equal(await fileHasAgentPetsHooksAsync(codex), false)
    assert.equal(await fileHasAgentPetsHooksAsync(claude), true)
    const kept = JSON.parse(fs.readFileSync(codex, 'utf8'))
    assert.equal(kept.hooks.Stop[0].hooks[0].command, 'echo mine')
  } finally { removeTempTree(dir) }
})

import { configuredHookExecutableFromRoot, isCodexHooksFeatureEnabled, leadingExecutable } from '../electron/hook-config.ts'

test('codex hooks feature requires an explicit hooks = true under [features]', () => {
  assert.equal(isCodexHooksFeatureEnabled(null), false)
  assert.equal(isCodexHooksFeatureEnabled('model = "x"\n'), false)
  assert.equal(isCodexHooksFeatureEnabled('[features]\nother = true\n'), false)
  assert.equal(isCodexHooksFeatureEnabled('[features]\nhooks = false\n'), false)
  assert.equal(isCodexHooksFeatureEnabled('[features]\nhooks = true # on\n'), true)
  assert.equal(isCodexHooksFeatureEnabled('[tui]\nhooks = true\n[features]\n'), false)
})

test('configured hook executable is read from exec-form and shell-form hooks', () => {
  assert.equal(configuredHookExecutableFromRoot({ hooks: { Stop: [{ hooks: [{ type: 'command', command: '/opt/node', args: [HOOK, 'claude'] }] }] } }), '/opt/node')
  assert.equal(configuredHookExecutableFromRoot({ hooks: { Stop: [{ hooks: [{ type: 'command', command: `"/opt/my node/node" "${HOOK}" codex` }] }] } }), '/opt/my node/node')
  assert.equal(configuredHookExecutableFromRoot({}), null)
  assert.equal(leadingExecutable('node /x/.desktop-pet/agent-hook.mjs codex'), 'node')
})

import { codexHookCommand, escapeCmdQuotedPath } from '../electron/hook-config.ts'

test('Windows Codex hook commands never start with a quoted path (PowerShell parse error)', () => {
  const winCommand = (home: string) => codexHookCommand({ isWindows: true, nodeBin: '', hookScript: `${home}\\.desktop-pet\\agent-hook.mjs`, wrapper: `${home}\\.desktop-pet\\agent-hook.cmd` })
  for (const home of ['C:\\Users\\dgh', 'C:\\Users\\first.last', 'D:\\home\\a-b_c']) {
    const win = winCommand(home)
    assert.equal(win, `${home}\\.desktop-pet\\agent-hook.cmd codex`)
    assert.equal(leadingExecutable(win), `${home}\\.desktop-pet\\agent-hook.cmd`)
    assert.ok(isAgentPetsHook({ type: 'command', command: win }), home)
  }
  for (const home of ['C:\\Users\\Jane Doe', 'C:\\Users\\王小明', 'C:\\Users\\a&b', 'C:\\Users\\a^b', "C:\\Users\\o'brien", 'C:\\Users\\a(b)']) {
    const win = winCommand(home)
    assert.equal(win, `cmd /d /c "${home}\\.desktop-pet\\agent-hook.cmd" codex`)
    assert.ok(!win.startsWith('"'))
    assert.equal(leadingExecutable(win), `${home}\\.desktop-pet\\agent-hook.cmd`)
    assert.ok(isAgentPetsHook({ type: 'command', command: win }), home)
  }
})

test('Codex hook commands quote every POSIX path (spaces, non-ASCII, shell metacharacters)', () => {
  const nasty = ["C:\\Users\\Jane Doe", "C:\\Users\\王小明", "C:\\Users\\a&b", "/Users/o'brien", "C:\\Users\\a^b", '/Users/$(touch x)', '/Users/`id`', '/Users/a"b', '/Users/a\\b']
  for (const home of nasty) {
    const mac = codexHookCommand({ isWindows: false, nodeBin: `${home}/node`, hookScript: `${home}/.desktop-pet/agent-hook.mjs`, wrapper: '' })
    const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`
    assert.equal(mac, `${quote(`${home}/node`)} ${quote(`${home}/.desktop-pet/agent-hook.mjs`)} codex`)
    assert.equal(leadingExecutable(mac), `${home}/node`)
    assert.ok(isAgentPetsHook({ type: 'command', command: mac }), home)
  }
})

test('unsafe paths are refused instead of producing an ambiguous hook command', () => {
  assert.throws(() => codexHookCommand({ isWindows: true, nodeBin: '', hookScript: '', wrapper: 'C:\\Users\\50%off\\.desktop-pet\\agent-hook.cmd' }), ConfigRefusedError)
  assert.throws(() => codexHookCommand({ isWindows: true, nodeBin: '', hookScript: '', wrapper: 'C:\\Users\\a"b\\agent-hook.cmd' }), ConfigRefusedError)
  assert.throws(() => codexHookCommand({ isWindows: true, nodeBin: '', hookScript: '', wrapper: 'C:\\Users\\$env\\agent-hook.cmd' }), ConfigRefusedError)
  assert.throws(() => codexHookCommand({ isWindows: true, nodeBin: '', hookScript: '', wrapper: 'C:\\Users\\a`b\\agent-hook.cmd' }), ConfigRefusedError)
  assert.throws(() => codexHookCommand({ isWindows: false, nodeBin: '/n\node', hookScript: '/h', wrapper: '' }), ConfigRefusedError)
  assert.throws(() => codexHookCommand({ isWindows: false, nodeBin: '/node', hookScript: '/h\0', wrapper: '' }), ConfigRefusedError)
})

test('isAgentPetsHook matches only our deployed hook script, not look-alikes', () => {
  const mk = (command: string, args?: string[]) => ({ type: 'command', command, ...(args ? { args } : {}) })
  assert.equal(isAgentPetsHook(mk('/usr/bin/node', ['/home/u/.desktop-pet/agent-hook.mjs', 'claude'])), true)
  assert.equal(isAgentPetsHook(mk('"C:\\Users\\u\\.desktop-pet\\agent-hook.cmd" codex')), true)
  assert.equal(isAgentPetsHook(mk('~/desktop-pet-project/agent-hook.sh')), false)
  assert.equal(isAgentPetsHook(mk('/opt/desktop-pet/agent-hook.mjs')), false)
  assert.equal(isAgentPetsHook(mk('node', ['/x/.desktop-pet/agent-hook.mjs.bak'])), false)
  assert.equal(isAgentPetsHook(mk('echo agent-hook desktop-pet')), false)
})

test('legacy Electron hooks are detected, a different Node install is not', () => {
  assert.equal(isLegacyElectronHook({ command: 'C:\\Users\\u\\AppData\\Local\\Programs\\Agent Pets\\Agent Pets.exe' }), true)
  assert.equal(isLegacyElectronHook({ command: '"C:\\Program Files\\Agent Pets\\Agent Pets.exe" "x" codex' }), true)
  assert.equal(isLegacyElectronHook({ command: 'D:\\tools\\node\\node.exe' }), false)
  assert.equal(isLegacyElectronHook({ command: '/usr/local/bin/node' }), false)
})

test('removing hooks from a symlinked dotfile keeps the link and its target', { skip: SKIP_WITHOUT_FILE_SYMLINKS }, async () => {
  const dir = tempDir()
  try {
    const target = path.join(dir, 'real.json')
    const link = path.join(dir, 'settings.json')
    fs.writeFileSync(target, JSON.stringify({ hooks: { Stop: [ours()] } }))
    fs.symlinkSync(target, link)
    await removeAgentPetsHooksFile(link)
    assert.ok(fs.lstatSync(link).isSymbolicLink())
    assert.deepEqual(JSON.parse(fs.readFileSync(target, 'utf8')), {})
  } finally { removeTempTree(dir) }
})

test('batch wrapper path escaping doubles percent signs and rejects quotes', () => {
  assert.equal(escapeCmdQuotedPath('C:\\Users\\50%off\\node.exe'), 'C:\\Users\\50%%off\\node.exe')
  assert.equal(escapeCmdQuotedPath('C:\\Users\\a&b^c\\node.exe'), 'C:\\Users\\a&b^c\\node.exe')
  assert.throws(() => escapeCmdQuotedPath('C:\\bad"name\\node.exe'))
  // $-sequences must reach the file literally (function replacer, not a replacement pattern).
  assert.equal('X __N__ Y'.replace('__N__', () => escapeCmdQuotedPath('C:\\a$&b\\node.exe')), 'X C:\\a$&b\\node.exe Y')
})

test('ensureAgentPetsHookEntries adds missing handlers and timeouts without touching user handlers', async () => {
  const dir = tempDir()
  try {
    const file = path.join(dir, 'settings.json')
    const userStop = { hooks: [{ type: 'command', command: 'echo mine', timeout: 5 }] }
    const userPermission = { matcher: 'Bash', hooks: [{ type: 'command', command: '/opt/other-tool/hook', timeout: 30 }] }
    const before = {
      model: 'opus',
      hooks: {
        Stop: [userStop, ours()],
        PermissionRequest: [userPermission],
        PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: '/custom/node', args: [HOOK, 'claude'] }] }],
      },
    }
    fs.writeFileSync(file, `${JSON.stringify(before, null, 2)}\n`)
    const required = [
      { event: 'Stop' },
      { event: 'PreToolUse', matcher: '*' },
      { event: 'PermissionRequest', matcher: '*', timeout: 135 },
      { event: 'PostToolUseFailure', matcher: '*' },
    ]
    const result = await ensureAgentPetsHookEntries(file, required)
    assert.equal(result?.status, 'written')
    assert.ok(result?.backupPath && fs.existsSync(result.backupPath))
    const after = JSON.parse(fs.readFileSync(file, 'utf8'))
    assert.equal(after.model, 'opus')
    assert.deepEqual(after.hooks.Stop, before.hooks.Stop)
    assert.deepEqual(after.hooks.PreToolUse, before.hooks.PreToolUse)
    // The user's own PermissionRequest handler is kept as-is; ours is appended with the timeout,
    // reusing the command the user already has (never the current Node path).
    assert.deepEqual(after.hooks.PermissionRequest[0], userPermission)
    assert.deepEqual(after.hooks.PermissionRequest[1], { matcher: '*', hooks: [{ type: 'command', command: 'node', args: [HOOK, 'claude'], timeout: 135 }] })
    assert.deepEqual(after.hooks.PostToolUseFailure, [{ matcher: '*', hooks: [{ type: 'command', command: 'node', args: [HOOK, 'claude'] }] }])
    const userText = JSON.stringify(userStop, null, 2).split('\n').map(line => `      ${line}`).join('\n').trimStart()
    assert.ok(fs.readFileSync(file, 'utf8').includes(userText), 'user handlers keep their exact text')

    // Idempotent: a second run writes nothing.
    assert.equal((await ensureAgentPetsHookEntries(file, required))?.status, 'unchanged')

    // A wrong timeout on our own handler is corrected; the other tool's timeout is not.
    after.hooks.PermissionRequest[1].hooks[0].timeout = 20
    fs.writeFileSync(file, `${JSON.stringify(after, null, 2)}\n`)
    assert.equal((await ensureAgentPetsHookEntries(file, required))?.status, 'written')
    const fixed = JSON.parse(fs.readFileSync(file, 'utf8'))
    assert.equal(fixed.hooks.PermissionRequest[1].hooks[0].timeout, 135)
    assert.equal(fixed.hooks.PermissionRequest[0].hooks[0].timeout, 30)
  } finally {
    removeTempTree(dir)
  }
})

test('ensureAgentPetsHookEntries leaves files without Agent Pets hooks or with invalid JSON alone', async () => {
  const dir = tempDir()
  try {
    const file = path.join(dir, 'settings.json')
    assert.equal(await ensureAgentPetsHookEntries(file, [{ event: 'PermissionRequest' }]), null)
    const userOnly = '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"echo mine"}]}]}}'
    fs.writeFileSync(file, userOnly)
    assert.equal(await ensureAgentPetsHookEntries(file, [{ event: 'PermissionRequest' }]), null)
    assert.equal(fs.readFileSync(file, 'utf8'), userOnly)
    fs.writeFileSync(file, '{ "hooks": // broken')
    assert.equal(await ensureAgentPetsHookEntries(file, [{ event: 'PermissionRequest' }]), null)
    assert.equal(fs.readFileSync(file, 'utf8'), '{ "hooks": // broken')
  } finally {
    removeTempTree(dir)
  }
})

// Codex 在 Windows 透過 PowerShell 執行 hook 指令；這裡用真的 shell 驗證產生的指令兩種都能啟動 wrapper。
test('Windows Codex hook command launches the wrapper under PowerShell and cmd.exe', { skip: process.platform !== 'win32' }, async () => {
  const { spawnSync } = await import('node:child_process')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-hook-shell-'))
  try {
    for (const home of [path.join(root, 'plain'), path.join(root, 'Jane Doe')]) {
      const deploy = path.join(home, '.desktop-pet')
      fs.mkdirSync(deploy, { recursive: true })
      const wrapper = path.join(deploy, 'agent-hook.cmd')
      const marker = path.join(deploy, 'ran.txt')
      fs.writeFileSync(wrapper, `@echo off\r\n>>"%~dp0ran.txt" echo %1\r\n`)
      const command = codexHookCommand({ isWindows: true, nodeBin: '', hookScript: '', wrapper })
      const runs: Array<[string, string, string[], boolean]> = [
        ['powershell', 'powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], false],
        ['cmd', 'cmd.exe', ['/d', '/s', '/c', `"${command}"`], true],
      ]
      for (const [shell, exe, args, verbatim] of runs) {
        fs.rmSync(marker, { force: true })
        const result = spawnSync(exe, args, { encoding: 'utf8', windowsVerbatimArguments: verbatim, timeout: 30_000 })
        assert.equal(result.status, 0, `${shell} ${command}: ${result.stderr}`)
        assert.equal(fs.readFileSync(marker, 'utf8').trim(), 'codex', `${shell} ${command}`)
      }
    }
  } finally {
    removeTempTree(root)
  }
})
