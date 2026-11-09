import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import test from 'node:test'
import { PanelThemeRuntime } from '../electron/main/panel-theme-runtime.ts'
import { prepareUserImage, storeUserImage } from '../electron/panel-theme-images.ts'
import {
  USER_PANEL_THEME_CORRUPT_BACKUPS_KEPT,
  USER_PANEL_THEME_SCAN_LIMIT,
  USER_PANEL_THEMES_DIRECTORY,
  UserPanelThemeStore,
} from '../electron/panel-theme-user-store.ts'
import { USER_PANEL_THEME_OWNER, type UserPanelThemeDefinition, type UserPanelThemeRecord } from '../src/types/panel-theme-user.ts'
import { SKIP_WITHOUT_FILE_SYMLINKS } from './support/fs-capabilities.mts'
import { builtinDefinition, png } from './support/panel-theme-fixtures.mts'

// H1／M8：「我的主題」的修剪只能依「磁碟上確定不存在」來刪插槽與背景圖。

const STAMP = '2026-11-08T00:00:00.000Z'

function withImage(): UserPanelThemeDefinition {
  const definition = builtinDefinition()
  definition.modes.light.image = { fit: 'cover', overlayColor: 'rgb(255 255 255 / 1)', dim: 0.95 }
  return definition
}

function recordFile(id: string, definition: unknown, schemaVersion = 1): string {
  return JSON.stringify({ schemaVersion, id, name: 'Mine', createdAt: STAMP, updatedAt: STAMP, definition })
}

function setup() {
  const userData = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-user-prune-')))
  const runtimeIn = () => new PanelThemeRuntime({
    userDataDirectory: userData,
    pluginRoot: () => userData,
    readRegularFileWithin: async () => null,
    send: () => {},
    sendPetStatus: () => {},
    rendererOrigin: () => null,
    sendPluginTheme: () => {},
    schedulePluginTheme: callback => callback(),
  })
  const sync = (runtime: PanelThemeRuntime) => runtime.sync({ registry: [], contexts: new Map(), pluginsEnabled: true })
  const folder = path.join(userData, USER_PANEL_THEMES_DIRECTORY)
  /** 建一個有背景圖、套用在淺色模式的使用者主題（磁碟上的完整狀態）。 */
  const applied = (definition: UserPanelThemeDefinition = withImage()) => {
    const runtime = runtimeIn()
    const record = runtime.userThemes.create('Mine', definition)
    const prepared = prepareUserImage(png(300, 200))
    if (!prepared.ok) throw new Error('fixture')
    storeUserImage(userData, USER_PANEL_THEME_OWNER, prepared)
    const ref = { pluginId: USER_PANEL_THEME_OWNER, themeId: record.id }
    runtime.store.setSlot('light', ref)
    runtime.store.setUserImage(ref, 'light', {
      file: prepared.file, type: prepared.type, width: 300, height: 200, bytes: 1, fit: 'cover', position: 'center', dim: 0.9, blur: 0, importedAt: STAMP,
    })
    sync(runtime)
    const image = path.join(userData, 'panel-theme-images', USER_PANEL_THEME_OWNER, prepared.file)
    assert.equal(runtime.store.get().slots.light?.themeId, record.id, 'fixture slot survives a normal sync')
    assert.ok(fs.existsSync(image), 'fixture image survives a normal sync')
    return { record, image, file: path.join(folder, `${record.id}.json`) }
  }
  const kept = (image: string, id: string) => {
    const runtime = runtimeIn()
    sync(runtime)
    assert.equal(runtime.store.get().slots.light?.themeId, id)
    assert.equal(Object.keys(runtime.store.get().userImages[USER_PANEL_THEME_OWNER] ?? {}).length, 1)
    assert.ok(fs.existsSync(image))
    return runtime
  }
  return { userData, folder, runtimeIn, sync, applied, kept, cleanup: () => fs.rmSync(userData, { recursive: true, force: true }) }
}

test('a store directory that becomes unsafe keeps every My-themes slot and image', { skip: SKIP_WITHOUT_FILE_SYMLINKS }, () => {
  const context = setup()
  try {
    const { record, image } = context.applied()
    const moved = `${context.folder}-elsewhere`
    fs.renameSync(context.folder, moved)
    fs.symlinkSync(moved, context.folder)
    const runtime = context.kept(image, record.id)
    assert.equal(runtime.userThemes.isUnsafe(), true)
    assert.deepEqual(runtime.userThemes.list(), [])
  } finally { context.cleanup() }
})

test('a truncated scan keeps slots for themes it did not reach; unrelated entries never push real themes out', () => {
  const context = setup()
  try {
    const { record, image } = context.applied()
    // 不相干的項目（.DS_Store、其他檔案、損毀備份）不佔掃描名額。
    fs.writeFileSync(path.join(context.folder, '.DS_Store'), '')
    for (let index = 0; index < USER_PANEL_THEME_SCAN_LIMIT + 20; index += 1) fs.writeFileSync(path.join(context.folder, `note-${index}.txt`), '')
    const runtime = context.kept(image, record.id)
    assert.deepEqual(runtime.userThemes.list().map(theme => theme.id), [record.id])

    // 主題檔多到超過掃描上限：沒看到的檔案可能存在，所以什麼都不修剪。
    for (let index = 0; index <= USER_PANEL_THEME_SCAN_LIMIT; index += 1) {
      const id = `u-${(index + 1).toString(16).padStart(12, 'f')}`
      fs.writeFileSync(path.join(context.folder, `${id}.json`), recordFile(id, builtinDefinition(), 2))
    }
    fs.rmSync(path.join(context.folder, `${record.id}.json`))
    context.kept(image, record.id)
  } finally { context.cleanup() }
})

test('a record that a tightened validator rejects keeps its slot and image; explicit delete removes them', () => {
  const context = setup()
  try {
    const { record, image, file } = context.applied()
    // 結構合法、但語意驗證失敗的記錄（模擬日後變嚴格的規則）。
    const unreadable = withImage()
    unreadable.modes.light.colors.text = unreadable.modes.light.colors.bg
    fs.writeFileSync(file, recordFile(record.id, unreadable))
    const runtime = context.kept(image, record.id)
    assert.equal(runtime.userThemes.get(record.id)?.id, record.id)
    assert.equal(runtime.getSources().find(source => source.pluginId === USER_PANEL_THEME_OWNER)?.themes.length, 0)

    assert.equal(runtime.userThemes.delete(record.id), true)
    runtime.refreshUserThemes()
    assert.equal(runtime.store.get().slots.light, null)
    assert.equal(fs.existsSync(image), false)
  } finally { context.cleanup() }
})

test('saving a theme with its background image turned off prunes the image but keeps the slot', () => {
  const context = setup()
  try {
    const { record, image } = context.applied()
    const runtime = context.runtimeIn()
    runtime.userThemes.update(record.id, builtinDefinition())
    runtime.refreshUserThemes()
    assert.equal(runtime.store.get().slots.light?.themeId, record.id)
    assert.equal(fs.existsSync(image), false)
  } finally { context.cleanup() }
})

test('a record from a newer schemaVersion is left untouched, hidden, never pruned and never overwritten', () => {
  const context = setup()
  try {
    const { record, image, file } = context.applied()
    const future = recordFile(record.id, { somethingNew: true }, 2)
    fs.writeFileSync(file, future)
    const runtime = context.kept(image, record.id)
    assert.deepEqual(runtime.userThemes.list(), [])
    assert.equal(fs.readFileSync(file, 'utf8'), future)
    assert.ok(!fs.readdirSync(context.folder).some(name => name.includes('.corrupt-')))
    // 唯讀：不能修改或刪除，新主題也不會拿到同一個 id。
    assert.equal(runtime.userThemes.delete(record.id), false)
    const store = new UserPanelThemeStore(context.userData, { randomHex: () => record.id.slice(2) })
    const created = store.create('Other', builtinDefinition())
    assert.notEqual(created.id, record.id)
    assert.equal(fs.readFileSync(file, 'utf8'), future)
  } finally { context.cleanup() }
})

test('unreadable theme files are not treated as deleted', { skip: process.platform === 'win32' || process.getuid?.() === 0 ? 'needs POSIX permissions as a regular user' : false }, () => {
  const context = setup()
  try {
    const { record, image, file } = context.applied()
    fs.chmodSync(file, 0o000)
    try {
      const runtime = context.kept(image, record.id)
      assert.deepEqual(runtime.userThemes.list(), [])
    } finally {
      fs.chmodSync(file, 0o600)
    }
  } finally { context.cleanup() }
})

test('corrupt backups rotate: only the newest few are kept', () => {
  const context = setup()
  try {
    const store = new UserPanelThemeStore(context.userData, { now: () => 9_000 })
    const kept = store.create('Kept', builtinDefinition()) satisfies UserPanelThemeRecord
    for (let index = 0; index < USER_PANEL_THEME_CORRUPT_BACKUPS_KEPT + 3; index += 1) {
      fs.writeFileSync(path.join(context.folder, `u-aaaaaaaaaaaa.json.corrupt-${1_000 + index}`), '{')
    }
    fs.writeFileSync(path.join(context.folder, 'u-bbbbbbbbbbbb.json'), '{ not json')
    const reopened = new UserPanelThemeStore(context.userData, { now: () => 9_000 })
    assert.deepEqual(reopened.list().map(theme => theme.id), [kept.id])
    const backups = fs.readdirSync(context.folder).filter(name => name.includes('.corrupt-')).sort()
    assert.equal(backups.length, USER_PANEL_THEME_CORRUPT_BACKUPS_KEPT)
    assert.ok(backups.includes('u-bbbbbbbbbbbb.json.corrupt-9000'), 'the newest backup is the one just made')
    assert.ok(!backups.includes('u-aaaaaaaaaaaa.json.corrupt-1000'), 'the oldest backups are removed')
  } finally { context.cleanup() }
})
