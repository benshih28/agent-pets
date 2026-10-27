import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ProjectRoutingStore } from '../electron/project-routing.ts'

function databasePath(): { filePath: string; directory: string; project: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-project-routing-'))
  const project = path.join(directory, 'workspace')
  fs.mkdirSync(project)
  return { filePath: path.join(directory, 'project-routing.sqlite'), directory, project }
}

test('project identity is anonymous, stable across path variants, and persists bindings', () => {
  const database = databasePath()
  const available = new Set(['aang-airbender', 'wolf'])
  const first = new ProjectRoutingStore(database.filePath, { now: () => 1_700_000_000_000 })
  try {
    const registered = first.registerPath(database.project, 1_700_000_000_000, available)
    assert.ok(registered)
    assert.equal(registered.displayName, 'workspace')
    assert.equal(JSON.stringify(registered).includes(database.project), false)

    const variant = process.platform === 'win32'
      ? database.project.toUpperCase()
      : path.join(database.project, '.')
    assert.equal(first.resolvePath(variant)?.projectId, registered.projectId)
    assert.equal(first.setBinding(registered.projectId, 'wolf', available)?.bindingStatus, 'bound')
    assert.deepEqual(first.route(registered.projectId, available), { petId: 'wolf', fallback: false })
  } finally {
    first.close()
  }

  const reopened = new ProjectRoutingStore(database.filePath, { now: () => 1_700_000_001_000 })
  try {
    const projects = reopened.listProjects(available)
    assert.equal(projects.length, 1)
    assert.equal(projects[0].boundPetId, 'wolf')
    assert.equal(JSON.stringify(projects).includes(database.project), false)

    const missing = reopened.route(projects[0].projectId, new Set(['aang-airbender']))
    assert.deepEqual(missing, { petId: 'aang-airbender', fallback: true })
  } finally {
    reopened.close()
    const rawDatabase = fs.readFileSync(database.filePath)
    assert.equal(rawDatabase.includes(Buffer.from(database.project)), false)
    fs.rmSync(database.directory, { recursive: true, force: true })
  }
})

test('project pet bindings accept the dedicated plugin skin id format', () => {
  const database = databasePath()
  const pluginSkinId = 'plugin:skin-pack:winter-fox'
  const available = new Set(['aang-airbender', pluginSkinId])
  const store = new ProjectRoutingStore(database.filePath)
  try {
    const project = store.registerPath(database.project, Date.now(), available)
    assert.ok(project)
    assert.equal(store.setBinding(project.projectId, pluginSkinId, available)?.boundPetId, pluginSkinId)
    assert.deepEqual(store.route(project.projectId, available), { petId: pluginSkinId, fallback: false })
  } finally {
    store.close()
    fs.rmSync(database.directory, { recursive: true, force: true })
  }
})

test('trackSeen resolves without hitting the filesystem twice and throttles the write', () => {
  const database = databasePath()
  let now = 1_700_000_000_000
  const store = new ProjectRoutingStore(database.filePath, { now: () => now })
  try {
    const first = store.trackSeen(database.project, now)
    assert.ok(first)

    // A second call moments later for the same raw path must resolve from
    // the in-memory cache (same identity) and skip the SQLite write - the
    // project row's last_seen_at should not have moved yet.
    now += 1_000
    const second = store.trackSeen(database.project, now)
    assert.equal(second?.projectId, first.projectId)
    const beforeThrottleExpires = store.getProject(first.projectId)
    assert.equal(beforeThrottleExpires?.lastSeenAt, 1_700_000_000_000)

    // Past the throttle window, the next call is allowed to write again.
    now += 30_000
    store.trackSeen(database.project, now)
    const afterThrottleExpires = store.getProject(first.projectId)
    assert.equal(afterThrottleExpires?.lastSeenAt, now)
  } finally {
    store.close()
    fs.rmSync(database.directory, { recursive: true, force: true })
  }
})

test('archiveProject removes a project from listProjects', () => {
  const database = databasePath()
  const available = new Set(['aang-airbender'])
  const store = new ProjectRoutingStore(database.filePath, { now: () => 1_700_000_000_000 })
  try {
    const registered = store.registerPath(database.project, 1_700_000_000_000, available)
    assert.ok(registered)
    assert.equal(store.listProjects(available).length, 1)

    assert.equal(store.archiveProject(registered.projectId), true)
    assert.equal(store.listProjects(available).length, 0)
    assert.equal(store.archiveProject(registered.projectId), false)
    assert.equal(store.archiveProject('not-a-valid-id'), false)
  } finally {
    store.close()
    fs.rmSync(database.directory, { recursive: true, force: true })
  }
})

test('disabling routing suppresses new resolution but keeps stored bindings for the UI', () => {
  const database = databasePath()
  const available = new Set(['aang-airbender', 'wolf'])
  const store = new ProjectRoutingStore(database.filePath, { now: () => 1_700_000_000_000 })
  try {
    assert.equal(store.isEnabled(), true)
    const registered = store.registerPath(database.project, 1_700_000_000_000, available)
    assert.ok(registered)
    assert.ok(store.setBinding(registered.projectId, 'wolf', available))

    store.setEnabled(false)
    assert.equal(store.isEnabled(), false)
    assert.equal(store.resolvePath(database.project), null)
    assert.equal(store.registerPath(database.project, 1_700_000_000_500, available), null)
    // Listing and rebinding previously seen projects must keep working while
    // disabled - only new path resolution (live routing) is suppressed.
    const stillListed = store.listProjects(available)
    assert.equal(stillListed.length, 1)
    assert.equal(stillListed[0].boundPetId, 'wolf')

    store.setEnabled(true)
    assert.equal(store.isEnabled(), true)
    assert.ok(store.resolvePath(database.project))
  } finally {
    store.close()
    fs.rmSync(database.directory, { recursive: true, force: true })
  }
})

test('the enabled flag persists across reopening the store', () => {
  const database = databasePath()
  const first = new ProjectRoutingStore(database.filePath)
  try {
    first.setEnabled(false)
  } finally {
    first.close()
  }
  const reopened = new ProjectRoutingStore(database.filePath)
  try {
    assert.equal(reopened.isEnabled(), false)
  } finally {
    reopened.close()
    fs.rmSync(database.directory, { recursive: true, force: true })
  }
})

test('invalid and missing project paths fail closed without touching the filesystem', () => {
  const database = databasePath()
  const store = new ProjectRoutingStore(database.filePath)
  try {
    assert.equal(store.resolvePath('relative/project'), null)
    assert.equal(store.resolvePath('C:\\bad\npath'), null)
    const missing = path.join(database.directory, 'does-not-exist')
    const identity = store.resolvePath(missing)
    assert.ok(identity)
    assert.equal(store.registerPath(missing)?.displayName, 'does-not-exist')
  } finally {
    store.close()
    fs.rmSync(database.directory, { recursive: true, force: true })
  }
})
