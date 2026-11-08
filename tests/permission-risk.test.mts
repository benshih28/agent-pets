import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { classifyClaudeFileEdit, classifyClaudeToolRisk, classifyPermissionRisk, isClaudeNetworkTool, isNetworkPermission, toolBaseName } from '../electron/permission-risk.ts'
import { PermissionBroker } from '../electron/permission-broker.ts'

test('only exact read-only tools are low risk', () => {
  for (const name of ['read', 'glob', 'grep', 'list', 'READ', ' Read ']) {
    assert.equal(classifyPermissionRisk(name), 'low', name)
  }
})

test('unknown, renamed and compound tool names fail closed to high', () => {
  for (const name of ['bash', 'edit', 'write', 'multiedit', 'patch', 'apply_patch', 'notebook', 'task', 'unheard_of', 'read_secrets', 'reader', 'webfetch', '']) {
    assert.equal(classifyPermissionRisk(name), 'high', name)
  }
})

test('MCP-wrapped, separated and argument-bearing names are high risk', () => {
  for (const name of ['mcp__server__bash', 'mcp__files__read', 'mcp__x__read', 'mcp__read__bash', 'foo:list', 'a b list',
    'x/read', 'x\\read', 'ns.read', 'rm -rf x list', 'read file', 'read\tgrep', 'read\nbash', 'read;rm']) {
    assert.equal(classifyPermissionRisk(name), 'high', name)
  }
  assert.equal(toolBaseName('mcp__srv__Do.Thing'), 'thing')
})

test('network tools are flagged', () => {
  assert.equal(isNetworkPermission('webfetch'), true)
  assert.equal(isNetworkPermission('external_directory'), true)
  assert.equal(isNetworkPermission('read'), false)
})

test('unclassified and high-risk requests are never hotkey eligible', () => {
  const broker = new PermissionBroker()
  broker.registerAdapter({
    id: 'a',
    capabilities: { permissions: 'respond', permissionModes: ['allow_once', 'deny'] },
    async respond() { return 'delivered' as const },
  })
  const make = (id: string, risk?: string) => broker.createRequest('a', {
    requestId: id, agentId: 'x', sessionId: 's', generation: 1, action: 'tool',
    description: 'd', responseHandle: {}, ...(risk ? { risk } : {}),
  })
  make('r-unknown')
  make('r-high', 'high')
  make('r-medium', 'medium')
  make('r-low', 'low')
  const byId = new Map(broker.listRequests().map((v) => [v.requestId, v]))
  assert.equal(byId.get('r-unknown')?.risk, 'unknown')
  assert.equal(byId.get('r-unknown')?.hotkeyEligible, false)
  assert.equal(byId.get('r-high')?.hotkeyEligible, false)
  assert.equal(byId.get('r-medium')?.hotkeyEligible, true)
  assert.equal(byId.get('r-low')?.hotkeyEligible, true)
  broker.shutdown()
})

test('Claude Code tools map to the Claude risk table; anything unlisted is unknown', () => {
  const expected: Record<string, string> = {
    // File edits start high; classifyClaudeFileEdit lowers ordinary in-project edits to medium.
    Bash: 'high', Write: 'high', Edit: 'high', MultiEdit: 'high', NotebookEdit: 'high',
    WebFetch: 'high', WebSearch: 'high',
  }
  for (const [tool, risk] of Object.entries(expected)) assert.equal(classifyClaudeToolRisk(tool), risk, tool)
  // Case and prefixes matter: a renamed or MCP-wrapped tool never inherits a softer level.
  for (const tool of ['bash', 'write', 'mcp__fs__Write', 'mcp__github__create_issue', 'Task', 'Read', '', 'constructor', '__proto__', 'toString']) {
    assert.equal(classifyClaudeToolRisk(tool), 'unknown', tool)
  }
  assert.equal(isClaudeNetworkTool('WebFetch'), true)
  assert.equal(isClaudeNetworkTool('WebSearch'), true)
  assert.equal(isClaudeNetworkTool('Bash'), false)
})

test('Claude file edits are medium only for ordinary files inside the project (POSIX)', () => {
  const p = path.posix
  const cwd = '/Users/alice/work/app'
  assert.deepEqual(classifyClaudeFileEdit('/Users/alice/work/app/src/a.ts', cwd, p), { risk: 'medium', relativePath: 'src/a.ts' })
  assert.deepEqual(classifyClaudeFileEdit('src/b.ts', cwd, p), { risk: 'medium', relativePath: 'src/b.ts' })
  assert.deepEqual(classifyClaudeFileEdit('..foo/c.ts', cwd, p), { risk: 'medium', relativePath: '..foo/c.ts' })
  for (const target of [
    '/Users/alice/.zshrc', '/Users/alice/work/app/../other/x.ts', '/Users/alice/work/app', '/etc/hosts',
    '/Users/alice/work/app/.git/hooks/pre-commit', '/Users/alice/work/app/sub/.GIT/config',
    '/Users/alice/work/app/.claude/settings.json', '/Users/alice/work/app/.husky/pre-push',
    '/Users/alice/work/app/.vscode/settings.json', '/Users/alice/work/app/node_modules/.bin/vite',
    '/Users/alice/work/app/.bashrc', '/Users/alice/work/app/.npmrc', '/Users/alice/work/app/.mcp.json',
  ]) {
    assert.equal(classifyClaudeFileEdit(target, cwd, p).risk, 'high', target)
  }
  for (const [file, dir] of [[undefined, cwd], ['a.ts', undefined], ['a.ts', 'relative/cwd'], ['a\0.ts', cwd], [42, cwd]]) {
    assert.equal(classifyClaudeFileEdit(file, dir, p).risk, 'high', String(file))
  }
  // A symlink that leaves the project (resolved via realpath) is high even if the lexical path is inside.
  const realpath = (value: string) => (value.startsWith('/Users/alice/work/app/linked') ? value.replace('/Users/alice/work/app/linked', '/tmp/elsewhere') : value)
  assert.equal(classifyClaudeFileEdit('/Users/alice/work/app/linked/x.ts', cwd, p, realpath).risk, 'high')
  const intoGit = (value: string) => value.replace('/Users/alice/work/app/hooks-link', '/Users/alice/work/app/.git/hooks')
  assert.equal(classifyClaudeFileEdit('/Users/alice/work/app/hooks-link/pre-commit', cwd, p, intoGit).risk, 'high')
  // Missing files resolve through their nearest existing parent.
  const parentOnly = (value: string) => (value.endsWith('new.ts') ? null : value)
  assert.equal(classifyClaudeFileEdit('/Users/alice/work/app/src/new.ts', cwd, p, parentOnly).risk, 'medium')
  assert.equal(classifyClaudeFileEdit('/Users/alice/work/app/src/a.ts', cwd, p, () => null).risk, 'high')
})

test('Claude file edits on Windows paths', () => {
  const w = path.win32
  const cwd = 'C:\\Users\\alice\\app'
  assert.equal(classifyClaudeFileEdit('C:\\Users\\alice\\app\\src\\a.ts', cwd, w).risk, 'medium')
  assert.equal(classifyClaudeFileEdit('D:\\app\\a.ts', cwd, w).risk, 'high')
  assert.equal(classifyClaudeFileEdit('C:\\Users\\alice\\app\\.Husky\\pre-commit', cwd, w).risk, 'high')
  assert.equal(classifyClaudeFileEdit('C:\\Users\\alice\\.bashrc', cwd, w).risk, 'high')
})
