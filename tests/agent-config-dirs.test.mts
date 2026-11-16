import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AGENT_CONFIG_DIR_VARIABLES,
  LOGIN_SHELL_TIMEOUT_MS,
  createAgentConfigEnvironment,
  parseLoginShellEnv,
  pickAgentConfigEnv,
  resolveAgentConfigDir,
  resolveAgentConfigDirs,
  type AgentConfigDirDeps,
  type AgentConfigEnvironmentDeps,
} from '../electron/agent-config-dirs.ts'

function posix(env: AgentConfigDirDeps['env'] = {}, dirs: ReadonlySet<string> = new Set()): AgentConfigDirDeps {
  return { env, homeDir: '/home/u', platform: 'linux', isDirectory: target => dirs.has(target) }
}

function windows(env: AgentConfigDirDeps['env'] = {}, dirs: ReadonlySet<string> = new Set()): AgentConfigDirDeps {
  return { env, homeDir: 'C:\\Users\\u', platform: 'win32', isDirectory: target => dirs.has(target) }
}

test('unset variables keep the 1.12.5 default paths on POSIX and Windows', () => {
  assert.deepEqual(resolveAgentConfigDirs(posix()), {
    claude: { path: '/home/u/.claude', defaultPath: '/home/u/.claude', source: 'default', variable: 'CLAUDE_CONFIG_DIR' },
    codex: { path: '/home/u/.codex', defaultPath: '/home/u/.codex', source: 'default', variable: 'CODEX_HOME' },
    opencode: { path: '/home/u/.config/opencode', defaultPath: '/home/u/.config/opencode', source: 'default', variable: 'XDG_CONFIG_HOME' },
  })
  const win = resolveAgentConfigDirs(windows())
  assert.equal(win.claude.path, 'C:\\Users\\u\\.claude')
  assert.equal(win.codex.path, 'C:\\Users\\u\\.codex')
  assert.equal(win.opencode.path, 'C:\\Users\\u\\.config\\opencode')
})

test('valid absolute values are used and normalized', () => {
  const dirs = resolveAgentConfigDirs(posix(
    { CLAUDE_CONFIG_DIR: '/work/claude/../claude-cfg/', CODEX_HOME: '/work/codex', XDG_CONFIG_HOME: '/xdg' },
    new Set(['/work/codex']),
  ))
  assert.deepEqual(dirs.claude, { path: '/work/claude-cfg', defaultPath: '/home/u/.claude', source: 'env', variable: 'CLAUDE_CONFIG_DIR' })
  assert.equal(dirs.codex.path, '/work/codex')
  assert.equal(dirs.codex.source, 'env')
  // XDG_CONFIG_HOME 指向上一層，OpenCode 目錄是 <XDG>/opencode。
  assert.equal(dirs.opencode.path, '/xdg/opencode')

  const win = resolveAgentConfigDirs(windows(
    { CLAUDE_CONFIG_DIR: 'D:\\claude-work', CODEX_HOME: '\\\\server\\share\\codex' },
    new Set(['\\\\server\\share\\codex']),
  ))
  assert.equal(win.claude.path, 'D:\\claude-work')
  assert.equal(win.codex.path, '\\\\server\\share\\codex')
})

test('relative, ~, drive-relative, whitespace, NUL and over-long values fall back with a reason', () => {
  const cases: Array<[AgentConfigDirDeps, string]> = [
    [posix({ CLAUDE_CONFIG_DIR: 'relative/dir' }), 'not_absolute'],
    [posix({ CLAUDE_CONFIG_DIR: '~/claude' }), 'not_absolute'],
    [windows({ CLAUDE_CONFIG_DIR: '\\claude' }), 'not_absolute'],
    [windows({ CLAUDE_CONFIG_DIR: 'D:claude' }), 'not_absolute'],
    [posix({ CLAUDE_CONFIG_DIR: ' /padded' }), 'invalid'],
    [posix({ CLAUDE_CONFIG_DIR: '/a\0b' }), 'invalid'],
    [posix({ CLAUDE_CONFIG_DIR: `/${'x'.repeat(1024)}` }), 'invalid'],
  ]
  for (const [deps, reason] of cases) {
    const dir = resolveAgentConfigDir('claude', deps)
    assert.equal(dir.source, 'default', JSON.stringify(deps.env))
    assert.equal(dir.path, dir.defaultPath)
    assert.equal(dir.ignored, reason, JSON.stringify(deps.env))
  }
})

test('an empty value counts as unset, without a warning', () => {
  for (const value of ['', '   ']) {
    const dir = resolveAgentConfigDir('codex', posix({ CODEX_HOME: value }))
    assert.equal(dir.source, 'default')
    assert.equal(dir.ignored, undefined)
  }
})

test('CODEX_HOME must be an existing directory; CLAUDE_CONFIG_DIR and XDG_CONFIG_HOME need not', () => {
  assert.equal(resolveAgentConfigDir('codex', posix({ CODEX_HOME: '/missing' })).ignored, 'missing')
  assert.equal(resolveAgentConfigDir('claude', posix({ CLAUDE_CONFIG_DIR: '/missing' })).source, 'env')
  assert.equal(resolveAgentConfigDir('opencode', posix({ XDG_CONFIG_HOME: '/missing' })).source, 'env')
})

test('pickAgentConfigEnv copies only the three variables and drops empty ones', () => {
  assert.deepEqual(pickAgentConfigEnv({ CODEX_HOME: '/c', CLAUDE_CONFIG_DIR: '', PATH: '/bin', HOME: '/home/u' }), { CODEX_HOME: '/c' })
})

test('login shell output: values, empty values, rc-file noise and malformed output', () => {
  const sentinel = '__AGENT_PETS_CONFIG_ENV__'
  assert.deepEqual(parseLoginShellEnv(`${sentinel}\0/c\0/x y\0\0`), { CLAUDE_CONFIG_DIR: '/c', CODEX_HOME: '/x y' })
  assert.deepEqual(parseLoginShellEnv(`${sentinel}\0\0\0\0`), {})
  assert.deepEqual(parseLoginShellEnv(`Welcome!\n${sentinel}\0fake\0\0\0\0${sentinel}\0/real\0\0\0`), { CLAUDE_CONFIG_DIR: '/real' })
  assert.deepEqual(parseLoginShellEnv('no sentinel here'), {})
  assert.deepEqual(parseLoginShellEnv(`${sentinel}\0/only-one`), {})
})

function environmentDeps(overrides: Partial<AgentConfigEnvironmentDeps> = {}): AgentConfigEnvironmentDeps & { calls: Array<{ file: string, args: string[], timeout: number }> } {
  const calls: Array<{ file: string, args: string[], timeout: number }> = []
  return {
    platform: 'darwin',
    env: { SHELL: '/bin/zsh' },
    run: async (file, args, timeout) => {
      calls.push({ file, args, timeout })
      return `__AGENT_PETS_CONFIG_ENV__\0/shell-claude\0/shell-codex\0\0`
    },
    calls,
    ...overrides,
  }
}

test('macOS asks the login shell once, with -lc and the 2 s timeout, and process.env wins', async () => {
  const deps = environmentDeps({ env: { SHELL: '/bin/zsh', CODEX_HOME: '/direct-codex' } })
  const environment = createAgentConfigEnvironment(deps)
  assert.deepEqual(environment.snapshot(), { CODEX_HOME: '/direct-codex' }, 'before the query only process.env is used')
  await Promise.all([environment.ready(), environment.ready()])
  await environment.ready()
  assert.equal(deps.calls.length, 1)
  assert.equal(deps.calls[0]!.file, '/bin/zsh')
  assert.equal(deps.calls[0]!.args[0], '-lc')
  assert.equal(deps.calls[0]!.timeout, LOGIN_SHELL_TIMEOUT_MS)
  for (const name of AGENT_CONFIG_DIR_VARIABLES) assert.match(deps.calls[0]!.args[1]!, new RegExp(`"\\$${name}"`))
  assert.deepEqual(environment.snapshot(), { CLAUDE_CONFIG_DIR: '/shell-claude', CODEX_HOME: '/direct-codex' })
})

test('a failing or timed-out login shell leaves process.env as the only source', async () => {
  const deps = environmentDeps({ env: { SHELL: '/bin/bash' }, run: async () => { throw Object.assign(new Error('timed out'), { killed: true }) } })
  const environment = createAgentConfigEnvironment(deps)
  await environment.ready()
  assert.deepEqual(environment.snapshot(), {})
})

test('Windows, or all three variables already set, never spawns a shell', async () => {
  for (const deps of [
    environmentDeps({ platform: 'win32', env: {} }),
    environmentDeps({ env: { CLAUDE_CONFIG_DIR: '/a', CODEX_HOME: '/b', XDG_CONFIG_HOME: '/c' } }),
  ]) {
    await createAgentConfigEnvironment(deps).ready()
    assert.equal(deps.calls.length, 0)
  }
})

test('a relative or missing SHELL falls back to the platform shell', async () => {
  const mac = environmentDeps({ env: { SHELL: 'zsh' } })
  await createAgentConfigEnvironment(mac).ready()
  assert.equal(mac.calls[0]!.file, '/bin/zsh')
  const linux = environmentDeps({ platform: 'linux', env: {} })
  await createAgentConfigEnvironment(linux).ready()
  assert.equal(linux.calls[0]!.file, '/bin/sh')
})
