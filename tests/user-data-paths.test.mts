import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { createUserDataPaths, memoizeUserDataPaths, USER_DATA_ENTRIES } from '../electron/main/user-data-paths.ts'

const root = resolve('agent-pets-user-data-fixture')

test('every userData file keeps its persisted name', () => {
  // 這些名稱已在使用者磁碟上；改名會讓既有資料變成孤兒。
  assert.deepEqual({ ...USER_DATA_ENTRIES }, {
    logs: 'logs',
    plugins: 'plugins',
    panelSize: 'panel-size.json',
    desktopPreferences: 'desktop-preferences.json',
    notificationLog: 'notification-log.json',
    onboarding: 'onboarding.json',
    projectMcpRegistry: 'project-mcp-registry.json',
    projectRouting: 'project-routing.sqlite',
    progression: 'progression.sqlite',
    achievements: 'achievements.sqlite',
    history: 'history.sqlite',
    permissionAudit: 'permission-audit.jsonl',
    legacyPermissionAudit: 'permission-audit.json',
  })
})

test('the table matches the joins it replaced', () => {
  const paths = createUserDataPaths(root)
  assert.equal(paths.root, root)
  for (const [key, name] of Object.entries(USER_DATA_ENTRIES)) {
    assert.equal(paths[key as keyof typeof USER_DATA_ENTRIES], join(root, name), key)
  }
  assert.equal(paths.pluginVersionRoot('example.plugin', '1.2.3'), resolve(root, 'plugins', 'example.plugin', '1.2.3'))
  assert.ok(Object.isFrozen(paths))
})

test('the memoized table resolves the root once', () => {
  let calls = 0
  const paths = memoizeUserDataPaths(() => {
    calls += 1
    return root
  })
  assert.equal(calls, 0)
  assert.equal(paths(), paths())
  assert.equal(calls, 1)
})

test('main process sources build userData paths only through the table', () => {
  for (const file of ['electron/main.ts', 'electron/main/runtime.ts', 'electron/diagnostics/main-log.ts']) {
    const source = readFileSync(file, 'utf8')
    assert.doesNotMatch(source, /(?:join|resolve)\(\s*app\.getPath\('userData'\)/, file)
    assert.doesNotMatch(source, /'(?:panel-size\.json|history\.sqlite|progression\.sqlite|achievements\.sqlite|permission-audit\.jsonl?)'/, file)
  }
})
