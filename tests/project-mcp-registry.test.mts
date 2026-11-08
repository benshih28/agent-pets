import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { ProjectMcpRegistryStore } from '../electron/project-mcp-registry.ts'
import { installProjectMcp, removeProjectMcp } from '../electron/project-mcp-setup.ts'

function createProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-project-registry-'))
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

test('registry tracks multiple projects and reflects their client status', () => {
  const root = createProject()
  const first = path.join(root, 'first')
  const second = path.join(root, 'second')
  fs.mkdirSync(first)
  fs.mkdirSync(second)
  const registryPath = path.join(root, 'registry.json')
  const nowValues = ['2026-08-13T01:00:00.000Z', '2026-08-13T01:01:00.000Z', '2026-08-13T01:02:00.000Z']
  const store = new ProjectMcpRegistryStore(registryPath, { now: () => nowValues.shift() ?? '2026-08-13T01:03:00.000Z' })
  try {
    assert.equal(installProjectMcp(first, options(root)).ok, true)
    store.register(first)
    store.register(second)

    const snapshot = store.list(options(root))
    assert.equal(snapshot.ok, true)
    assert.deepEqual(snapshot.projects.map(project => project.projectName), ['first', 'second'])
    assert.deepEqual(snapshot.projects.map(project => project.status), ['connected', 'partial'])
    assert.equal(snapshot.projects[0].results.every(result => result.status === 'already_configured'), true)
  } finally {
    cleanup(root)
  }
})

test('registry marks missing folders and can forget only the selected record', () => {
  const root = createProject()
  const project = path.join(root, 'project')
  fs.mkdirSync(project)
  const registryPath = path.join(root, 'registry.json')
  const store = new ProjectMcpRegistryStore(registryPath, { now: () => '2026-08-13T01:00:00.000Z' })
  try {
    store.register(project)
    fs.rmSync(project, { recursive: true, force: true })
    const missing = store.list(options(root))
    assert.equal(missing.projects[0].status, 'missing')
    assert.equal(store.forget(project), true)
    assert.deepEqual(store.list(options(root)).projects, [])
  } finally {
    cleanup(root)
  }
})

test('removal deletes only matching Agent Pets entries and preserves conflicts', () => {
  const project = createProject()
  try {
    const setup = installProjectMcp(project, options(project))
    assert.equal(setup.ok, true)
    const result = removeProjectMcp(project, options(project))
    assert.equal(result.ok, true)
    assert.deepEqual(result.results.map(item => item.status), ['removed', 'removed', 'removed'])
    assert.equal(fs.existsSync(path.join(project, '.mcp.json')), true)
    assert.equal(JSON.parse(fs.readFileSync(path.join(project, '.mcp.json'), 'utf8')).mcpServers['agent-pets'], undefined)

    installProjectMcp(project, options(project))
    const claudePath = path.join(project, '.mcp.json')
    const claude = JSON.parse(fs.readFileSync(claudePath, 'utf8'))
    claude.mcpServers['agent-pets'].env = { CUSTOMIZED: '1' }
    fs.writeFileSync(claudePath, `${JSON.stringify(claude, null, 2)}\n`, 'utf8')
    const conflict = removeProjectMcp(project, options(project))
    assert.equal(conflict.results.find(item => item.client === 'claude')?.status, 'conflict')
    assert.equal(JSON.parse(fs.readFileSync(claudePath, 'utf8')).mcpServers['agent-pets'].env.CUSTOMIZED, '1')
  } finally {
    cleanup(project)
  }
})

test('list is read-only, keeps error text, and sets a corrupt registry aside', () => {
  const root = createProject()
  const project = path.join(root, 'p')
  fs.mkdirSync(project)
  const registryPath = path.join(root, 'registry.json')
  const store = new ProjectMcpRegistryStore(registryPath)
  try {
    store.register(project)
    const before = fs.readFileSync(registryPath, 'utf8')
    store.list(options(root))
    store.list(options(root))
    assert.equal(fs.readFileSync(registryPath, 'utf8'), before, 'listing must not rewrite the registry')

    fs.writeFileSync(registryPath, '{ corrupt')
    const snapshot = store.list(options(root))
    assert.equal(snapshot.ok, true)
    assert.equal(snapshot.recovered, true)
    assert.deepEqual(snapshot.projects, [])
    assert.ok(fs.readdirSync(root).some(name => name.startsWith('registry.json.corrupt-')))
  } finally { cleanup(root) }
})
