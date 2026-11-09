import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import test from 'node:test'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { registerPanelThemeIpc, type PanelThemeIpcDependencies } from '../electron/ipc/panel-theme.ts'
import { IPC_CHANNELS } from '../electron/ipc/channels.ts'
import { PanelThemeStore } from '../electron/panel-theme-store.ts'
import { prepareUserImage } from '../electron/panel-theme-images.ts'
import { emptyPanelThemeState, resolvePanelThemes, type PanelThemeSourcePlugin } from '../electron/plugin-panel-themes.ts'
import { DARK_COLORS, LIGHT_COLORS, jpeg, png, theme } from './support/panel-theme-fixtures.mts'

const REF = { pluginId: 'theme-pack', themeId: 'aurora' }

function fixture(options: { available?: boolean; dialog?: string[] | null } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-ipc-panel-theme-'))
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const calls: string[] = []
  const files = new Map<string, Uint8Array>()
  const themes = resolvePanelThemes([
    theme({ modes: { light: { colors: LIGHT_COLORS, userImage: { allowed: true, overlay: { color: '#eef6f6', opacity: 0.9 } } }, dark: { colors: DARK_COLORS } } }),
  ])!
  let sources: PanelThemeSourcePlugin[] = [{
    pluginId: 'theme-pack', version: '1.0.0', pluginName: { 'zh-TW': '主題包', 'en-US': 'Theme Pack' }, available: options.available ?? true, themes,
  }]
  const store = new PanelThemeStore(directory)
  let dialogOpen = false
  const window = { isDestroyed: () => false } as unknown as BrowserWindow
  const deps: PanelThemeIpcDependencies = {
    ipcMain: {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => { handlers.set(channel, handler) },
      on: (channel: string, handler: (...args: unknown[]) => unknown) => { handlers.set(channel, handler) },
    } as unknown as PanelThemeIpcDependencies['ipcMain'],
    setPanelAppearance: appearance => { calls.push(`appearance:${appearance.mode}:${appearance.forcedColors}`) },
    assertPluginPanelSender: event => { if ((event as unknown) !== 'panel') throw new Error('Unauthorized plugin panel IPC sender') },
    assertPetSender: event => { if ((event as unknown) !== 'pet') throw new Error('Unauthorized IPC sender') },
    getPetStatus: () => ({ light: null, dark: null }),
    getStore: () => store,
    getSources: () => sources,
    getState: () => emptyPanelThemeState(),
    publish: () => { calls.push('publish') },
    getPanelWindow: () => window,
    isDialogOpen: () => dialogOpen,
    setDialogOpen: value => { dialogOpen = value; calls.push(`dialog:${value}`) },
    showOpenDialog: async (_window, dialogOptions) => {
      calls.push(`picker:${dialogOptions.filters[0]!.extensions.join(',')}`)
      return options.dialog === null || !options.dialog?.length ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [options.dialog.shift()!] }
    },
    translate: key => key,
    readUserImage: async filePath => {
      const bytes = files.get(filePath)
      return bytes ? { ok: true, bytes } : { ok: false, error: 'image_invalid' }
    },
    prepareUserImage,
    storeUserImage: (pluginId, prepared) => { calls.push(`store:${pluginId}/${prepared.file}`) },
    deleteUserImage: (pluginId, file) => { calls.push(`delete:${pluginId}/${file}`) },
    pluginPanelError: error => ((error as { code?: string }).code === 'unsafe_file' ? 'preferences_unsafe' : 'plugin_action_failed'),
    now: () => Date.parse('2026-11-08T00:00:00.000Z'),
  }
  registerPanelThemeIpc(deps)
  const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)!('panel' as unknown as IpcMainInvokeEvent, ...args)
  return {
    handlers, calls, files, store, invoke,
    setSources: (next: PanelThemeSourcePlugin[]) => { sources = next },
    cleanup: () => fs.rmSync(directory, { recursive: true, force: true }),
  }
}

test('every panel theme channel rejects senders other than the panel main frame', async () => {
  const context = fixture()
  try {
    const channels = [
      IPC_CHANNELS.panelThemeStateGet, IPC_CHANNELS.panelThemeSlotSet, IPC_CHANNELS.panelThemeUserImageImport,
      IPC_CHANNELS.panelThemeUserImageClear, IPC_CHANNELS.panelThemeUserImageOptionsSet, IPC_CHANNELS.panelThemeAppearanceSet,
    ]
    assert.deepEqual([...context.handlers.keys()].sort(), [...channels, IPC_CHANNELS.panelThemePetStatusGet].sort())
    for (const channel of channels) {
      for (const sender of ['pet', 'plugin-view', 'plugin-host', 'subframe']) {
        assert.throws(() => context.handlers.get(channel)!(sender, 'light', REF), /Unauthorized/)
      }
    }
    assert.deepEqual(context.calls, [])
    // 膠囊顏色只有寵物視窗能讀取。
    for (const sender of ['panel', 'plugin-view', 'plugin-host']) {
      assert.throws(() => context.handlers.get(IPC_CHANNELS.panelThemePetStatusGet)!(sender), /Unauthorized/)
    }
    assert.deepEqual(context.handlers.get(IPC_CHANNELS.panelThemePetStatusGet)!('pet'), { light: null, dark: null })
  } finally { context.cleanup() }
})

test('appearance report accepts exactly { mode, forcedColors } from the panel and ignores anything else', () => {
  const context = fixture()
  try {
    const send = (payload: unknown) => context.handlers.get(IPC_CHANNELS.panelThemeAppearanceSet)!('panel', payload)
    for (const payload of [
      null, 'dark', [], { mode: 'sepia', forcedColors: false }, { mode: 'dark' }, { mode: 'dark', forcedColors: 'yes' },
      { mode: 'dark', forcedColors: false, pluginId: 'theme-pack' },
    ]) send(payload)
    assert.deepEqual(context.calls, [])
    send({ mode: 'dark', forcedColors: false })
    send({ mode: 'light', forcedColors: true })
    assert.deepEqual(context.calls, ['appearance:dark:false', 'appearance:light:true'])
  } finally { context.cleanup() }
})

test('slot set validates mode, ref shape and the live catalog; one slot per mode is replaced', async () => {
  const context = fixture()
  try {
    assert.deepEqual(await context.invoke(IPC_CHANNELS.panelThemeSlotSet, 'sepia', REF), { ok: false, error: 'invalid_request' })
    assert.deepEqual(await context.invoke(IPC_CHANNELS.panelThemeSlotSet, 'light', { ...REF, x: 1 }), { ok: false, error: 'invalid_request' })
    assert.deepEqual(await context.invoke(IPC_CHANNELS.panelThemeSlotSet, 'light', { pluginId: 'theme-pack', themeId: 'missing' }), { ok: false, error: 'theme_unavailable' })
    assert.equal((await context.invoke(IPC_CHANNELS.panelThemeSlotSet, 'light', REF) as { ok: boolean }).ok, true)
    assert.deepEqual(context.store.get().slots.light, REF)
    // 設定另一個主題會取代插槽；null 會還原為內建。
    context.setSources([{ ...{ pluginId: 'other-pack', version: '1.0.0', pluginName: { 'zh-TW': '另一', 'en-US': 'Other' }, available: true }, themes: resolvePanelThemes([theme({ id: 'night' })])! }])
    assert.equal((await context.invoke(IPC_CHANNELS.panelThemeSlotSet, 'light', { pluginId: 'other-pack', themeId: 'night' }) as { ok: boolean }).ok, true)
    assert.deepEqual(context.store.get().slots.light, { pluginId: 'other-pack', themeId: 'night' })
    assert.equal((await context.invoke(IPC_CHANNELS.panelThemeSlotSet, 'light', null) as { ok: boolean }).ok, true)
    assert.equal(context.store.get().slots.light, null)
    assert.equal(context.calls.filter(call => call === 'publish').length, 3)
  } finally { context.cleanup() }
})

test('disabled plugins are not in the catalog: slot set and image import return theme_unavailable', async () => {
  const context = fixture({ available: false })
  try {
    assert.deepEqual(await context.invoke(IPC_CHANNELS.panelThemeSlotSet, 'light', REF), { ok: false, error: 'theme_unavailable' })
    assert.deepEqual(await context.invoke(IPC_CHANNELS.panelThemeUserImageImport, REF, 'light'), { ok: false, error: 'theme_unavailable' })
  } finally { context.cleanup() }
})

test('import: image_not_allowed, cancel, invalid bytes, then a JPEG with EXIF rotation is stored by sha256', async () => {
  const context = fixture({ dialog: ['/photos/a.gif', '/photos/b.png', '/photos/c.jpg', '/photos/d.jpg'] })
  try {
    assert.deepEqual(await context.invoke(IPC_CHANNELS.panelThemeUserImageImport, REF, 'dark'), { ok: false, error: 'image_not_allowed' })
    assert.equal(context.calls.includes('dialog:true'), false)
    context.files.set('/photos/a.gif', new TextEncoder().encode('GIF89a'))
    assert.deepEqual(await context.invoke(IPC_CHANNELS.panelThemeUserImageImport, REF, 'light'), { ok: false, error: 'image_invalid' })
    context.files.set('/photos/b.png', png(256, 256, { animated: true }))
    assert.deepEqual(await context.invoke(IPC_CHANNELS.panelThemeUserImageImport, REF, 'light'), { ok: false, error: 'image_invalid', reason: 'animated' })
    const first = jpeg(4032, 3024, { orientation: 6 })
    context.files.set('/photos/c.jpg', first)
    assert.equal((await context.invoke(IPC_CHANNELS.panelThemeUserImageImport, REF, 'light') as { ok: boolean }).ok, true)
    const stored = context.store.getUserImage(REF, 'light')!
    assert.match(stored.file, /^[0-9a-f]{64}\.jpg$/)
    assert.equal(stored.width, 4032)
    assert.equal(stored.dim, 0.9)
    assert.ok(context.calls.includes(`store:theme-pack/${stored.file}`))
    assert.ok(context.calls.includes('picker:png,jpg,jpeg,webp'))
    // 取代時會刪除先前那個已不再被引用的檔案。
    context.files.set('/photos/d.jpg', jpeg(800, 600))
    assert.equal((await context.invoke(IPC_CHANNELS.panelThemeUserImageImport, REF, 'light') as { ok: boolean }).ok, true)
    assert.ok(context.calls.includes(`delete:theme-pack/${stored.file}`))
    // 對話框被取消。
    assert.deepEqual(await context.invoke(IPC_CHANNELS.panelThemeUserImageImport, REF, 'light'), { ok: false, error: 'cancelled', cancelled: true })
    assert.equal(context.calls.filter(call => call === 'dialog:false').length, context.calls.filter(call => call === 'dialog:true').length)
  } finally { context.cleanup() }
})

test('options: reject (never clamp) dims below the minimum, odd blurs and unknown keys; clear deletes the file', async () => {
  const context = fixture({ dialog: ['/photos/c.jpg'] })
  try {
    context.files.set('/photos/c.jpg', jpeg(800, 600))
    await context.invoke(IPC_CHANNELS.panelThemeUserImageImport, REF, 'light')
    const file = context.store.getUserImage(REF, 'light')!.file
    for (const options of [
      { fit: 'cover', position: 'center', dim: 0.5, blur: 0 },
      { fit: 'cover', position: 'center', dim: 0.96, blur: 0 },
      { fit: 'cover', position: 'center', dim: 0.905, blur: 0 },
      { fit: 'cover', position: 'center', dim: 0.9, blur: 4 },
      { fit: 'stretch', position: 'center', dim: 0.9, blur: 0 },
      { fit: 'cover', position: 'center', dim: 0.9, blur: 0, url: 'https://example.com' },
      null,
    ]) {
      assert.deepEqual(await context.invoke(IPC_CHANNELS.panelThemeUserImageOptionsSet, REF, 'light', options), { ok: false, error: 'invalid_request' })
    }
    assert.equal((await context.invoke(IPC_CHANNELS.panelThemeUserImageOptionsSet, REF, 'light', { fit: 'tile', position: 'top-left', dim: 0.95, blur: 24 }) as { ok: boolean }).ok, true)
    assert.equal(context.store.getUserImage(REF, 'light')!.blur, 24)
    assert.equal((await context.invoke(IPC_CHANNELS.panelThemeUserImageClear, REF, 'light') as { ok: boolean }).ok, true)
    assert.ok(context.calls.includes(`delete:theme-pack/${file}`))
    assert.equal(context.store.getUserImage(REF, 'light'), null)
    assert.deepEqual(await context.invoke(IPC_CHANNELS.panelThemeUserImageOptionsSet, REF, 'light', { fit: 'cover', position: 'center', dim: 0.9, blur: 0 }), { ok: false, error: 'invalid_request' })
  } finally { context.cleanup() }
})
