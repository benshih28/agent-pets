import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import test from 'node:test'
import { USER_PANEL_THEMES_DIRECTORY, UserPanelThemeStore, UserPanelThemeStoreError } from '../electron/panel-theme-user-store.ts'
import { USER_PANEL_THEME_MAX_COUNT } from '../src/types/panel-theme-user.ts'
import { SKIP_WITHOUT_FILE_SYMLINKS } from './support/fs-capabilities.mts'
import { builtinDefinition } from './support/panel-theme-fixtures.mts'

function withDirectory(run: (directory: string) => void): void {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-user-themes-'))
  try { run(directory) } finally { fs.rmSync(directory, { recursive: true, force: true }) }
}

function counter() {
  let next = 0
  return () => (next++).toString(16).padStart(12, '0')
}

function storeIn(directory: string, now = () => Date.parse('2026-11-08T00:00:00.000Z')) {
  return new UserPanelThemeStore(directory, { now, randomHex: counter() })
}

function codeOf(run: () => unknown): string | undefined {
  try {
    run()
  } catch (error) {
    return error instanceof UserPanelThemeStoreError ? error.code : String(error)
  }
  return undefined
}

test('create, update, rename, duplicate and delete persist one private file per theme', () => {
  withDirectory(directory => {
    const store = storeIn(directory)
    const created = store.create('Sakura', builtinDefinition())
    assert.equal(created.id, 'u-000000000000')
    const file = path.join(directory, USER_PANEL_THEMES_DIRECTORY, `${created.id}.json`)
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700)
      assert.equal(fs.statSync(file).mode & 0o777, 0o600)
    }
    const definition = builtinDefinition()
    definition.shape = { radiusSm: 4, radiusMd: 8, radiusLg: 12 }
    assert.equal(store.update(created.id, definition).definition.shape.radiusLg, 12)
    assert.equal(store.rename(created.id, '  Night  ').name, 'Night')
    const copy = store.duplicate(created.id, 'Night copy')
    assert.notEqual(copy.id, created.id)
    const reopened = storeIn(directory)
    assert.deepEqual(reopened.list().map(theme => theme.name), ['Night', 'Night copy'])
    assert.equal(reopened.get(created.id)?.definition.shape.radiusLg, 12)
    assert.equal(reopened.delete(created.id), true)
    assert.equal(reopened.delete(created.id), false)
    assert.equal(fs.existsSync(file), false)
    assert.deepEqual(storeIn(directory).list().map(theme => theme.id), [copy.id])
    // 沒有暫存檔留下。
    assert.deepEqual(fs.readdirSync(path.dirname(file)).filter(name => name.endsWith('.tmp')), [])
  })
})

test('every write is validated with the theme validator; invalid input never reaches the disk', () => {
  withDirectory(directory => {
    const store = storeIn(directory)
    const unreadable = builtinDefinition()
    unreadable.modes.light.colors.text = 'rgb(200 200 200 / 1)'
    let error: unknown
    try { store.create('Bad', unreadable) } catch (caught) { error = caught }
    assert.ok(error instanceof UserPanelThemeStoreError)
    assert.equal(error.code, 'invalid_definition')
    assert.equal(error.validation?.valid, false)
    assert.ok(error.validation!.issues.length > 0)
    assert.equal(codeOf(() => store.create('Bad', { not: 'a theme' })), 'invalid_definition')
    assert.equal(codeOf(() => store.create('', builtinDefinition())), 'invalid_name')
    assert.equal(codeOf(() => store.update('u-ffffffffffff', builtinDefinition())), 'not_found')
    assert.equal(codeOf(() => store.update('../../etc/passwd', builtinDefinition())), 'not_found')
    assert.equal(fs.existsSync(path.join(directory, USER_PANEL_THEMES_DIRECTORY)), false)
  })
})

test('the number of themes is capped', () => {
  withDirectory(directory => {
    const store = storeIn(directory)
    for (let index = 0; index < USER_PANEL_THEME_MAX_COUNT; index += 1) store.create(`Theme ${index}`, builtinDefinition())
    assert.equal(codeOf(() => store.create('One more', builtinDefinition())), 'limit_reached')
    assert.equal(codeOf(() => store.duplicate(store.list()[0]!.id, 'Copy')), 'limit_reached')
    assert.equal(storeIn(directory).list().length, USER_PANEL_THEME_MAX_COUNT)
  })
})

test('corrupt, oversized and mismatched files are backed up and skipped; other themes survive', () => {
  withDirectory(directory => {
    const store = storeIn(directory)
    const kept = store.create('Kept', builtinDefinition())
    const folder = path.join(directory, USER_PANEL_THEMES_DIRECTORY)
    fs.writeFileSync(path.join(folder, 'u-aaaaaaaaaaaa.json'), '{ not json')
    fs.writeFileSync(path.join(folder, 'u-bbbbbbbbbbbb.json'), JSON.stringify({ ...kept, id: 'u-cccccccccccc' }))
    fs.writeFileSync(path.join(folder, 'u-dddddddddddd.json'), 'x'.repeat(17 * 1024))
    fs.writeFileSync(path.join(folder, '.u-eeeeeeeeeeee.00000000-0000-4000-8000-000000000000.tmp'), 'partial')
    fs.writeFileSync(path.join(folder, 'notes.txt'), 'ignored')
    const reopened = storeIn(directory)
    assert.deepEqual(reopened.list().map(theme => theme.id), [kept.id])
    const names = fs.readdirSync(folder).sort()
    assert.ok(names.some(name => name.startsWith('u-aaaaaaaaaaaa.json.corrupt-')))
    assert.ok(names.some(name => name.startsWith('u-bbbbbbbbbbbb.json.corrupt-')))
    assert.ok(names.some(name => name.startsWith('u-dddddddddddd.json.corrupt-')))
    assert.ok(!names.some(name => name.endsWith('.tmp')))
    assert.ok(names.includes('notes.txt'))
    // 備份檔不會在下次啟動被當成主題讀回來。
    assert.deepEqual(storeIn(directory).list().map(theme => theme.id), [kept.id])
  })
})

test('a symlinked store directory or theme file is refused', { skip: SKIP_WITHOUT_FILE_SYMLINKS }, () => {
  withDirectory(directory => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-user-themes-outside-'))
    try {
      fs.symlinkSync(outside, path.join(directory, USER_PANEL_THEMES_DIRECTORY))
      const store = storeIn(directory)
      assert.deepEqual(store.list(), [])
      assert.equal(store.isUnsafe(), true)
      assert.equal(codeOf(() => store.create('Mine', builtinDefinition())), 'unsafe_directory')
      assert.deepEqual(fs.readdirSync(outside), [])
    } finally {
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })
  withDirectory(directory => {
    const store = storeIn(directory)
    const created = store.create('Mine', builtinDefinition())
    const folder = path.join(directory, USER_PANEL_THEMES_DIRECTORY)
    const target = path.join(directory, 'elsewhere.json')
    fs.writeFileSync(target, fs.readFileSync(path.join(folder, `${created.id}.json`)))
    fs.rmSync(path.join(folder, `${created.id}.json`))
    fs.symlinkSync(target, path.join(folder, `${created.id}.json`))
    assert.deepEqual(storeIn(directory).list(), [])
    // 寫入也不會跟著 symlink 寫到外面。
    assert.equal(codeOf(() => store.rename(created.id, 'Renamed')), 'unsafe_directory')
    assert.equal(JSON.parse(fs.readFileSync(target, 'utf8')).name, 'Mine')
  })
})
