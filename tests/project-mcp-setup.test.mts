import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { installProjectMcp } from '../electron/project-mcp-setup.ts'
import { installProjectMcp as install2, planProjectMcp, removeProjectMcp } from '../electron/project-mcp-setup.ts'
import { addLocalExcludes, findGitLocation, readTrackedPaths } from '../electron/git-tracking.ts'

function createProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-project-mcp-'))
}

function options(projectPath: string) {
  return {
    nodeExecutable: path.join(projectPath, 'node.exe'),
    bridgePath: path.join(projectPath, '.desktop-pet', 'presentation-mcp.mjs'),
  }
}

function cleanup(projectPath: string): void {
  fs.rmSync(projectPath, { recursive: true, force: true })
}

test('installs all supported project MCP configs and is idempotent', () => {
  const projectPath = createProject()
  try {
    const first = installProjectMcp(projectPath, options(projectPath))
    assert.equal(first.ok, true)
    assert.deepEqual(first.results.map(result => result.status), [
      'installed',
      'installed',
      'installed',
    ])

    const claude = JSON.parse(fs.readFileSync(path.join(projectPath, '.mcp.json'), 'utf8'))
    assert.equal(claude.mcpServers['agent-pets'].type, 'stdio')
    assert.deepEqual(claude.mcpServers['agent-pets'].args, [options(projectPath).bridgePath])

    const opencode = JSON.parse(fs.readFileSync(path.join(projectPath, 'opencode.json'), 'utf8'))
    assert.equal(opencode.mcp['agent-pets'].type, 'local')
    assert.deepEqual(opencode.mcp['agent-pets'].command, [
      options(projectPath).nodeExecutable,
      options(projectPath).bridgePath,
    ])
    assert.equal(opencode.mcp['agent-pets'].enabled, true)
    assert.equal(opencode.mcp.servers, undefined)

    const codex = fs.readFileSync(path.join(projectPath, '.codex', 'config.toml'), 'utf8')
    assert.match(codex, /\[mcp_servers\.agent-pets\]/)
    assert.match(codex, /command =/)

    const second = installProjectMcp(projectPath, options(projectPath))
    assert.equal(second.ok, true)
    assert.deepEqual(second.results.map(result => result.status), [
      'already_configured',
      'already_configured',
      'already_configured',
    ])
  } finally {
    cleanup(projectPath)
  }
})

test('migrates the legacy Agent Pets OpenCode wrapper without touching other servers', () => {
  const projectPath = createProject()
  try {
    const configPath = path.join(projectPath, 'opencode.json')
    const originalDce = {
      type: 'local',
      command: ['node', 'dce-mcp.mjs'],
      enabled: true,
    }
    fs.writeFileSync(configPath, `${JSON.stringify({
      mcp: {
        dce: originalDce,
        servers: {
          'agent-pets': {
            type: 'local',
            command: [options(projectPath).nodeExecutable, options(projectPath).bridgePath],
          },
        },
      },
    }, null, 2)}\n`, 'utf8')

    const result = installProjectMcp(projectPath, options(projectPath))
    const opencodeResult = result.results.find(item => item.client === 'opencode')
    const repaired = JSON.parse(fs.readFileSync(configPath, 'utf8'))

    assert.equal(result.ok, true)
    assert.equal(opencodeResult?.status, 'installed')
    assert.deepEqual(repaired.mcp.dce, originalDce)
    assert.equal(repaired.mcp.servers, undefined)
    assert.equal(repaired.mcp['agent-pets'].enabled, true)
    assert.deepEqual(repaired.mcp['agent-pets'].command, [
      options(projectPath).nodeExecutable,
      options(projectPath).bridgePath,
    ])
  } finally {
    cleanup(projectPath)
  }
})

test('does not overwrite a conflicting legacy OpenCode server', () => {
  const projectPath = createProject()
  try {
    const configPath = path.join(projectPath, 'opencode.json')
    const original = {
      mcp: {
        servers: {
          'agent-pets': {
            type: 'local',
            command: ['some-other-node', 'some-other-server.mjs'],
          },
        },
      },
    }
    fs.writeFileSync(configPath, `${JSON.stringify(original, null, 2)}\n`, 'utf8')

    const result = installProjectMcp(projectPath, options(projectPath))
    const opencodeResult = result.results.find(item => item.client === 'opencode')

    assert.equal(result.ok, false)
    assert.equal(opencodeResult?.status, 'conflict')
    assert.deepEqual(JSON.parse(fs.readFileSync(configPath, 'utf8')), original)
  } finally {
    cleanup(projectPath)
  }
})

test('does not overwrite a conflicting project server', () => {
  const projectPath = createProject()
  try {
    const configPath = path.join(projectPath, '.mcp.json')
    const original = {
      mcpServers: {
        'agent-pets': {
          type: 'stdio',
          command: 'some-other-node',
          args: ['some-other-server.mjs'],
        },
      },
    }
    fs.writeFileSync(configPath, `${JSON.stringify(original, null, 2)}\n`, 'utf8')

    const result = installProjectMcp(projectPath, options(projectPath))
    const claudeResult = result.results.find(item => item.client === 'claude')
    assert.equal(result.ok, false)
    assert.equal(claudeResult?.status, 'conflict')
    assert.deepEqual(JSON.parse(fs.readFileSync(configPath, 'utf8')), original)
  } finally {
    cleanup(projectPath)
  }
})

test('reports invalid JSON without modifying the invalid file', () => {
  const projectPath = createProject()
  try {
    const configPath = path.join(projectPath, 'opencode.json')
    const original = '{"mcp":\n'
    fs.writeFileSync(configPath, original, 'utf8')

    const result = installProjectMcp(projectPath, options(projectPath))
    const opencodeResult = result.results.find(item => item.client === 'opencode')
    assert.equal(opencodeResult?.status, 'error')
    assert.equal(fs.readFileSync(configPath, 'utf8'), original)
  } finally {
    cleanup(projectPath)
  }
})

test('fails closed for an unsafe project config directory', () => {
  const projectPath = createProject()
  try {
    fs.writeFileSync(path.join(projectPath, '.codex'), 'not a directory', 'utf8')
    const result = installProjectMcp(projectPath, options(projectPath))
    const codexResult = result.results.find(item => item.client === 'codex')
    assert.equal(codexResult?.status, 'error')
    assert.equal(fs.readFileSync(path.join(projectPath, '.codex'), 'utf8'), 'not a directory')
  } finally {
    cleanup(projectPath)
  }
})

test('requires absolute executable and bridge paths', () => {
  const projectPath = createProject()
  try {
    assert.throws(
      () => installProjectMcp(projectPath, { nodeExecutable: 'node', bridgePath: 'bridge.mjs' }),
      /absolute Node\.js and bridge paths/,
    )
  } finally {
    cleanup(projectPath)
  }
})

// A minimal Git index (version 2) listing the given paths.
function writeGitIndex(projectPath: string, tracked: string[]): void {
  const gitDir = path.join(projectPath, '.git')
  fs.mkdirSync(path.join(gitDir, 'info'), { recursive: true })
  const entries = tracked.map(name => {
    const nameBytes = Buffer.from(name, 'utf8')
    const fixed = Buffer.alloc(62)
    fixed.writeUInt16BE(Math.min(nameBytes.length, 0xfff), 60)
    const length = Math.ceil((62 + nameBytes.length + 1) / 8) * 8
    const entry = Buffer.alloc(length)
    fixed.copy(entry)
    nameBytes.copy(entry, 62)
    return entry
  })
  const header = Buffer.alloc(12)
  header.write('DIRC', 0, 'latin1')
  header.writeUInt32BE(2, 4)
  header.writeUInt32BE(entries.length, 8)
  fs.writeFileSync(path.join(gitDir, 'index'), Buffer.concat([header, ...entries]))
}

test('installs only the selected clients', () => {
  const projectPath = createProject()
  try {
    const summary = install2(projectPath, options(projectPath), { clients: ['claude'] })
    assert.deepEqual(summary.results.map(item => item.client), ['claude'])
    assert.equal(fs.existsSync(path.join(projectPath, '.mcp.json')), true)
    assert.equal(fs.existsSync(path.join(projectPath, 'opencode.json')), false)
    assert.equal(fs.existsSync(path.join(projectPath, '.codex')), false)
    assert.throws(() => install2(projectPath, options(projectPath), { clients: [] }), /at least one/)
  } finally { cleanup(projectPath) }
})

test('supports project paths with spaces and non-ASCII characters', () => {
  const base = createProject()
  try {
    const projectPath = path.join(base, '我的 專案 with space')
    fs.mkdirSync(projectPath)
    const summary = install2(projectPath, options(base))
    assert.equal(summary.ok, true)
    const codex = fs.readFileSync(path.join(projectPath, '.codex', 'config.toml'), 'utf8')
    assert.match(codex, /\[mcp_servers\.agent-pets\]/)
  } finally { cleanup(base) }
})

test('keeps other MCP servers, indentation and CRLF line endings', () => {
  const projectPath = createProject()
  try {
    const file = path.join(projectPath, '.mcp.json')
    const original = '{\r\n    "mcpServers": {\r\n        "other": { "command": "x" }\r\n    }\r\n}\r\n'
    fs.writeFileSync(file, original)
    install2(projectPath, options(projectPath), { clients: ['claude'] })
    const written = fs.readFileSync(file, 'utf8')
    assert.ok(written.includes('\r\n'))
    assert.ok(!/[^\r]\n/.test(written), 'every newline stays CRLF')
    assert.ok(written.includes('\r\n    "mcpServers"'), 'keeps 4-space indentation')
    const parsed = JSON.parse(written)
    assert.deepEqual(parsed.mcpServers.other, { command: 'x' })
    assert.ok(parsed.mcpServers['agent-pets'])
  } finally { cleanup(projectPath) }
})

test('JSONC config is left untouched with an actionable code and manual snippet', () => {
  const projectPath = createProject()
  try {
    const file = path.join(projectPath, 'opencode.json')
    const original = '{\n  // my settings\n  "theme": "dark",\n}\n'
    fs.writeFileSync(file, original)
    const summary = install2(projectPath, options(projectPath), { clients: ['opencode'] })
    const result = summary.results[0]!
    assert.equal(result.status, 'error')
    assert.equal(result.code, 'jsonc')
    assert.match(result.manualSnippet ?? '', /agent-pets/)
    assert.equal(fs.readFileSync(file, 'utf8'), original)
  } finally { cleanup(projectPath) }
})

test('oversized config reports size and limit without modifying the file', () => {
  const projectPath = createProject()
  try {
    const file = path.join(projectPath, '.mcp.json')
    const big = JSON.stringify({ filler: 'x'.repeat(1_100_000) })
    fs.writeFileSync(file, big)
    const result = install2(projectPath, options(projectPath), { clients: ['claude'] }).results[0]!
    assert.equal(result.code, 'too_large')
    assert.match(result.message ?? '', /bytes/)
    assert.equal(fs.readFileSync(file, 'utf8'), big)
  } finally { cleanup(projectPath) }
})

test('read-only directory yields a write_failed error and no partial file', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () => {
  const projectPath = createProject()
  try {
    fs.chmodSync(projectPath, 0o500)
    const result = install2(projectPath, options(projectPath), { clients: ['claude'] }).results[0]!
    assert.equal(result.status, 'error')
    assert.equal(result.code, 'write_failed')
    fs.chmodSync(projectPath, 0o700)
    assert.deepEqual(fs.readdirSync(projectPath), [])
  } finally { fs.chmodSync(projectPath, 0o700); cleanup(projectPath) }
})

test('plan previews files and Git tracking without writing anything', () => {
  const projectPath = createProject()
  const home = createProject()
  try {
    fs.mkdirSync(path.join(home, '.claude'))
    fs.writeFileSync(path.join(projectPath, '.mcp.json'), '{}\n')
    writeGitIndex(projectPath, ['.mcp.json', 'README.md'])
    const before = fs.readdirSync(projectPath).sort()
    const plan = planProjectMcp(projectPath, options(projectPath), home)
    assert.equal(plan.isGitRepo, true)
    const byClient = Object.fromEntries((plan.clients ?? []).map(item => [item.client, item]))
    assert.equal(byClient.claude!.gitTracked, true)
    assert.equal(byClient.claude!.exists, true)
    assert.equal(byClient.claude!.suggested, true)
    assert.equal(byClient.claude!.status, 'not_configured')
    assert.equal(byClient.codex!.gitTracked, false)
    assert.equal(byClient.codex!.suggested, false)
    assert.equal(byClient.opencode!.exists, false)
    assert.match(byClient.codex!.preview, /mcp_servers\.agent-pets/)
    assert.deepEqual(fs.readdirSync(projectPath).sort(), before)
  } finally { cleanup(projectPath); cleanup(home) }
})

test('local-only mode excludes untracked files and warns about tracked ones', () => {
  const projectPath = createProject()
  try {
    fs.writeFileSync(path.join(projectPath, 'opencode.json'), '{}\n')
    writeGitIndex(projectPath, ['opencode.json'])
    const summary = install2(projectPath, options(projectPath), { localOnly: true })
    assert.deepEqual(summary.trackedFiles, ['opencode.json'])
    assert.deepEqual([...(summary.excluded ?? [])].sort(), ['.codex/config.toml', '.mcp.json'])
    const exclude = fs.readFileSync(path.join(projectPath, '.git', 'info', 'exclude'), 'utf8')
    assert.match(exclude, /^\/\.mcp\.json$/m)
    assert.match(exclude, /^\/\.codex\/config\.toml$/m)
    assert.doesNotMatch(exclude, /opencode\.json/)
    // Idempotent.
    const again = install2(projectPath, options(projectPath), { localOnly: true })
    assert.deepEqual(again.excluded, [])
  } finally { cleanup(projectPath) }
})

test('git helpers: in-project gitdir file, index parsing and exclude edits', () => {
  const base = createProject()
  try {
    const project = path.join(base, 'wt')
    const real = path.join(project, 'meta.git')
    fs.mkdirSync(path.join(real, 'info'), { recursive: true })
    fs.writeFileSync(path.join(project, '.git'), `gitdir: ${real}\n`)
    const location = findGitLocation(project)
    assert.equal(location?.gitDir, fs.realpathSync(real))
    assert.equal(location?.outside, undefined)
    assert.equal(readTrackedPaths(location!), null)
    assert.deepEqual(addLocalExcludes(location!, ['a.json']), ['a.json'])
    assert.deepEqual(addLocalExcludes(location!, ['a.json']), [])
    assert.equal(findGitLocation(base), null)
  } finally { cleanup(base) }
})

test('git helpers never follow gitdir or commondir outside the picked folder', () => {
  const base = createProject()
  try {
    const outside = path.join(base, 'elsewhere')
    fs.mkdirSync(path.join(outside, 'info'), { recursive: true })
    // gitdir outside
    const project = path.join(base, 'p1')
    fs.mkdirSync(project)
    fs.writeFileSync(path.join(project, '.git'), `gitdir: ${outside}\n`)
    const location = findGitLocation(project)
    assert.equal(location?.outside, true)
    assert.equal(readTrackedPaths(location!), null)
    assert.throws(() => addLocalExcludes(location!, ['a.json']), /outside/)
    assert.equal(fs.existsSync(path.join(outside, 'info', 'exclude')), false)
    // relative traversal
    const project2 = path.join(base, 'p2')
    fs.mkdirSync(project2)
    fs.writeFileSync(path.join(project2, '.git'), 'gitdir: ../elsewhere\n')
    assert.equal(findGitLocation(project2)?.outside, true)
    // in-project gitdir whose commondir escapes
    const project3 = path.join(base, 'p3')
    fs.mkdirSync(path.join(project3, 'g'), { recursive: true })
    fs.writeFileSync(path.join(project3, 'g', 'commondir'), `${outside}\n`)
    fs.writeFileSync(path.join(project3, '.git'), 'gitdir: g\n')
    const escaped = findGitLocation(project3)
    assert.equal(escaped?.outside, true)
    assert.throws(() => addLocalExcludes(escaped!, ['a.json']), /outside/)
    assert.equal(fs.existsSync(path.join(outside, 'info', 'exclude')), false)
    // symlinked gitdir pointing outside
    const project4 = path.join(base, 'p4')
    fs.mkdirSync(project4)
    fs.symlinkSync(outside, path.join(project4, 'link.git'))
    fs.writeFileSync(path.join(project4, '.git'), 'gitdir: link.git\n')
    assert.equal(findGitLocation(project4)?.outside, true)
  } finally { cleanup(base) }
})

test('git helpers refuse a symlinked info directory or exclude file', () => {
  const base = createProject()
  try {
    const outside = path.join(base, 'elsewhere')
    fs.mkdirSync(outside)
    const project = path.join(base, 'p')
    fs.mkdirSync(path.join(project, '.git'), { recursive: true })
    fs.symlinkSync(outside, path.join(project, '.git', 'info'))
    const location = findGitLocation(project)!
    assert.throws(() => addLocalExcludes(location, ['a.json']), /unsafe/)
    assert.equal(fs.readdirSync(outside).length, 0)
    fs.rmSync(path.join(project, '.git', 'info'))
    fs.mkdirSync(path.join(project, '.git', 'info'))
    fs.writeFileSync(path.join(outside, 'x'), '')
    fs.symlinkSync(path.join(outside, 'x'), path.join(project, '.git', 'info', 'exclude'))
    assert.throws(() => addLocalExcludes(location, ['a.json']), /unsafe/)
    assert.equal(fs.readFileSync(path.join(outside, 'x'), 'utf8'), '')
  } finally { cleanup(base) }
})

test('local-only mode skips and reports a .git pointer outside the project', () => {
  const base = createProject()
  try {
    const outside = path.join(base, 'elsewhere')
    fs.mkdirSync(path.join(outside, 'info'), { recursive: true })
    const projectPath = path.join(base, 'proj')
    fs.mkdirSync(projectPath)
    fs.writeFileSync(path.join(projectPath, '.git'), `gitdir: ${outside}\n`)
    const summary = install2(projectPath, options(projectPath), { localOnly: true })
    assert.deepEqual(summary.warnings, ['git_outside_project'])
    assert.equal(summary.excluded, undefined)
    assert.equal(fs.existsSync(path.join(outside, 'info', 'exclude')), false)
  } finally { cleanup(base) }
})

test('removal still deletes only Agent Pets entries and preserves other servers', () => {
  const projectPath = createProject()
  try {
    const file = path.join(projectPath, '.mcp.json')
    fs.writeFileSync(file, JSON.stringify({ mcpServers: { other: { command: 'x' } } }, null, 2))
    install2(projectPath, options(projectPath), { clients: ['claude'] })
    const removal = removeProjectMcp(projectPath, options(projectPath))
    assert.equal(removal.results.find(item => item.client === 'claude')?.status, 'removed')
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { mcpServers: { other: { command: 'x' } } })
  } finally { cleanup(projectPath) }
})

test('moved App/Node paths are reported as stale and repaired only on request', () => {
  const projectPath = createProject()
  try {
    const old = { nodeExecutable: path.join(projectPath, 'old-bin', 'node'), bridgePath: path.join(projectPath, 'old', 'presentation-mcp.mjs') }
    install2(projectPath, old)
    const opts = options(projectPath)
    const plan = planProjectMcp(projectPath, opts)
    assert.deepEqual((plan.clients ?? []).map(item => item.status), ['stale', 'stale', 'stale'])

    const refused = install2(projectPath, opts)
    assert.deepEqual(refused.results.map(item => item.status), ['stale', 'stale', 'stale'])
    assert.equal(refused.ok, false)

    const fixed = install2(projectPath, opts, { updateStale: true })
    assert.equal(fixed.ok, true)
    assert.deepEqual(fixed.results.map(item => item.code), ['updated', 'updated', 'updated'])
    const claude = JSON.parse(fs.readFileSync(path.join(projectPath, '.mcp.json'), 'utf8'))
    assert.deepEqual(claude.mcpServers['agent-pets'].args, [opts.bridgePath])
    const codex = fs.readFileSync(path.join(projectPath, '.codex', 'config.toml'), 'utf8')
    assert.equal((codex.match(/\[mcp_servers\.agent-pets\]/g) ?? []).length, 1)
    assert.ok(codex.includes(opts.bridgePath.replace(/\\/g, '\\\\')))
    assert.equal(install2(projectPath, opts).ok, true)
  } finally { cleanup(projectPath) }
})

test('an entry running an arbitrary command is never treated as ours, even with our bridge name', () => {
  const projectPath = createProject()
  try {
    const opts = options(projectPath)
    const entry = { type: 'stdio', command: '/bin/sh', args: ['/tmp/presentation-mcp.mjs'] }
    const file = path.join(projectPath, '.mcp.json')
    fs.writeFileSync(file, JSON.stringify({ mcpServers: { 'agent-pets': entry } }))
    const removal = removeProjectMcp(projectPath, opts)
    assert.equal(removal.results.find(item => item.client === 'claude')?.status, 'conflict')
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers['agent-pets'], entry)
    const refused = install2(projectPath, opts, { updateStale: true, clients: ['claude'] })
    assert.equal(refused.results[0]?.status, 'conflict')
  } finally { cleanup(projectPath) }
})

test('a customized entry is a conflict, never stale, and survives updateStale', () => {
  const projectPath = createProject()
  try {
    const file = path.join(projectPath, '.mcp.json')
    const custom = { mcpServers: { 'agent-pets': { type: 'stdio', command: 'x', args: ['/a/presentation-mcp.mjs'], env: { K: '1' } } } }
    fs.writeFileSync(file, JSON.stringify(custom))
    const result = install2(projectPath, options(projectPath), { clients: ['claude'], updateStale: true }).results[0]!
    assert.equal(result.status, 'conflict')
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), custom)
  } finally { cleanup(projectPath) }
})
