import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import test from 'node:test'
import {
  isPanelThemeDim,
  isPanelThemeRef,
  isPanelThemeUserImageOptions,
  PANEL_THEME_MAX_USER_IMAGES,
  PANEL_THEME_STORE_FILENAME,
  PanelThemeStore,
} from '../electron/panel-theme-store.ts'
import type { PanelThemeStoredUserImage } from '../src/types/panel-theme.ts'
import { SKIP_WITHOUT_FILE_SYMLINKS } from './support/fs-capabilities.mts'

function withDirectory(run: (directory: string) => void): void {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-panel-theme-store-'))
  try { run(directory) } finally { fs.rmSync(directory, { recursive: true, force: true }) }
}

function image(file = `${'a'.repeat(64)}.png`): PanelThemeStoredUserImage {
  return { file, type: 'image/png', width: 640, height: 400, bytes: 1234, fit: 'cover', position: 'center', dim: 0.9, blur: 0, importedAt: '2026-11-08T00:00:00.000Z' }
}

const REF = { pluginId: 'theme-pack', themeId: 'aurora' }

test('slots and user images persist across instances with a restrictive file mode', () => {
  withDirectory(directory => {
    const store = new PanelThemeStore(directory)
    assert.deepEqual(store.get().slots, { light: null, dark: null })
    store.setSlot('light', REF)
    assert.equal(store.setUserImage(REF, 'light', image()), null)
    const reopened = new PanelThemeStore(directory)
    assert.deepEqual(reopened.get().slots.light, REF)
    assert.equal(reopened.getUserImage(REF, 'light')?.file, image().file)
    if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(directory, PANEL_THEME_STORE_FILENAME)).mode & 0o777, 0o600)
    // 取代圖片時會回傳先前的檔案，讓呼叫端可以刪除它。
    assert.equal(reopened.setUserImage(REF, 'light', image(`${'b'.repeat(64)}.jpg`)), image().file)
    assert.equal(reopened.updateUserImageOptions(REF, 'light', { fit: 'tile', position: 'top-left', dim: 0.95, blur: 16 }), true)
    assert.equal(new PanelThemeStore(directory).getUserImage(REF, 'light')?.blur, 16)
    assert.equal(reopened.clearUserImage(REF, 'light'), `${'b'.repeat(64)}.jpg`)
    assert.deepEqual(new PanelThemeStore(directory).get().userImages, {})
  })
})

test('corrupt or oversize files read as built-in and are backed up on the next write', () => {
  withDirectory(directory => {
    const file = path.join(directory, PANEL_THEME_STORE_FILENAME)
    fs.writeFileSync(file, '{not json')
    const store = new PanelThemeStore(directory)
    assert.deepEqual(store.get().slots, { light: null, dark: null })
    store.setSlot('dark', REF)
    assert.ok(fs.readdirSync(directory).some(name => name.startsWith(`${PANEL_THEME_STORE_FILENAME}.corrupt-`)))
    fs.writeFileSync(file, JSON.stringify({ version: 1, slots: {}, userImages: {}, pad: 'x'.repeat(70 * 1024) }))
    assert.deepEqual(new PanelThemeStore(directory).get().slots, { light: null, dark: null })
  })
})

test('invalid stored entries are dropped field by field', () => {
  withDirectory(directory => {
    fs.writeFileSync(path.join(directory, PANEL_THEME_STORE_FILENAME), JSON.stringify({
      version: 1,
      slots: { light: { pluginId: '_host', themeId: 'x' }, dark: { pluginId: 'theme-pack', themeId: 'aurora', extra: 1 } },
      userImages: {
        'theme-pack': {
          aurora: { light: { ...image(), file: '../../etc/passwd' }, dark: { ...image(), dim: 0.3 } },
          ok: { light: image() },
        },
        'Bad Id': { aurora: { light: image() } },
      },
    }))
    const data = new PanelThemeStore(directory).get()
    assert.deepEqual(data.slots, { light: null, dark: null })
    assert.deepEqual(Object.keys(data.userImages), ['theme-pack'])
    assert.deepEqual(Object.keys(data.userImages['theme-pack']!), ['ok'])
  })
})

test('a symlinked store file is refused for writes (preferences_unsafe)', { skip: SKIP_WITHOUT_FILE_SYMLINKS }, () => {
  withDirectory(directory => {
    const target = path.join(directory, 'elsewhere.json')
    fs.writeFileSync(target, JSON.stringify({ version: 1, slots: { light: REF, dark: null }, userImages: {} }))
    fs.symlinkSync(target, path.join(directory, PANEL_THEME_STORE_FILENAME))
    const store = new PanelThemeStore(directory)
    assert.deepEqual(store.get().slots.light, null)
    assert.equal(store.isUnsafe(), true)
    assert.throws(() => store.setSlot('light', REF), (error: unknown) => (error as { code?: string }).code === 'unsafe_file')
    assert.equal(fs.readFileSync(target, 'utf8').includes('aurora'), true)
  })
})

test('removePlugin clears slots and entries; prune keeps disabled/unknown plugins and drops vanished modes', () => {
  withDirectory(directory => {
    const store = new PanelThemeStore(directory)
    store.setSlot('light', REF)
    store.setSlot('dark', { pluginId: 'other-pack', themeId: 'night' })
    store.setUserImage(REF, 'light', image())
    store.setUserImage({ pluginId: 'other-pack', themeId: 'night' }, 'dark', image(`${'c'.repeat(64)}.webp`))
    const removed = store.prune({
      isInstalled: id => id === 'theme-pack' || id === 'other-pack',
      modeExists: (id, themeId, mode) => id === 'other-pack' || (themeId === 'aurora' && mode === 'light'),
      allowsUserImage: id => id === 'other-pack',
    })
    // theme-pack 的淺色模式不再允許使用者圖片：項目被丟棄，插槽保留。
    assert.deepEqual(removed, [`theme-pack/${image().file}`])
    assert.deepEqual(store.get().slots.light, REF)
    assert.equal(store.removePlugin('other-pack'), true)
    assert.deepEqual(store.get().slots.dark, null)
    assert.deepEqual(store.get().userImages, {})
    assert.equal(store.removePlugin('other-pack'), false)
  })
})

test('at most 64 user image entries are stored', () => {
  withDirectory(directory => {
    const store = new PanelThemeStore(directory)
    for (let index = 0; index < PANEL_THEME_MAX_USER_IMAGES; index += 1) {
      store.setUserImage({ pluginId: 'theme-pack', themeId: `t${index}` }, 'light', image(`${index.toString(16).padStart(64, '0')}.png`))
    }
    assert.throws(() => store.setUserImage({ pluginId: 'theme-pack', themeId: 'overflow' }, 'light', image()), RangeError)
    // 已達上限時，取代既有項目仍然可行。
    assert.doesNotThrow(() => store.setUserImage({ pluginId: 'theme-pack', themeId: 't0' }, 'light', image()))
  })
})

test('payload validators reject unknown keys, out-of-range dims and odd blurs', () => {
  assert.equal(isPanelThemeRef(REF), true)
  assert.equal(isPanelThemeRef({ ...REF, extra: 1 }), false)
  assert.equal(isPanelThemeRef({ pluginId: '_shared', themeId: 'a' }), false)
  assert.equal(isPanelThemeRef({ pluginId: 'theme-pack', themeId: 'A' }), false)
  assert.equal(isPanelThemeDim(0.82, 0.82), true)
  assert.equal(isPanelThemeDim(0.81, 0.82), false)
  assert.equal(isPanelThemeDim(0.96, 0.5), false)
  assert.equal(isPanelThemeDim(0.825, 0.5), false)
  assert.equal(isPanelThemeUserImageOptions({ fit: 'cover', position: 'center', dim: 0.9, blur: 8 }, 0.5), true)
  assert.equal(isPanelThemeUserImageOptions({ fit: 'cover', position: 'center', dim: 0.9, blur: 7 }, 0.5), false)
  assert.equal(isPanelThemeUserImageOptions({ fit: 'cover', position: 'middle', dim: 0.9, blur: 8 }, 0.5), false)
  assert.equal(isPanelThemeUserImageOptions({ fit: 'cover', position: 'center', dim: 0.9, blur: 8, url: 'x' }, 0.5), false)
})
