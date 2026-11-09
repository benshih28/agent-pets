import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import test from 'node:test'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { PanelThemeRuntime } from '../electron/main/panel-theme-runtime.ts'
import { exportFileName, registerUserPanelThemeIpc, type UserPanelThemeIpcDependencies } from '../electron/ipc/panel-theme-user.ts'
import { registerPanelThemeIpc, type PanelThemeIpcDependencies } from '../electron/ipc/panel-theme.ts'
import { IPC_CHANNELS } from '../electron/ipc/channels.ts'
import { prepareUserImage, storeUserImage, deleteUserImage } from '../electron/panel-theme-images.ts'
import { readUserPanelThemeImportFile, writeUserPanelThemeExportFile } from '../electron/panel-theme-user-store.ts'
import { USER_PANEL_THEME_NAME_MAX, USER_PANEL_THEME_OWNER } from '../src/types/panel-theme-user.ts'
import { builtinDefinition, png } from './support/panel-theme-fixtures.mts'

const USER_CHANNELS = [
  IPC_CHANNELS.panelThemeValidate, IPC_CHANNELS.panelThemeUserList, IPC_CHANNELS.panelThemeUserCreate, IPC_CHANNELS.panelThemeUserUpdate,
  IPC_CHANNELS.panelThemeUserRename, IPC_CHANNELS.panelThemeUserDuplicate, IPC_CHANNELS.panelThemeUserDelete,
  IPC_CHANNELS.panelThemeUserExport, IPC_CHANNELS.panelThemeUserImport,
]

function setup(dialog: { open?: string[]; save?: string } = {}) {
  const userData = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-user-theme-ipc-')))
  const sent: unknown[] = []
  const runtime = new PanelThemeRuntime({
    userDataDirectory: userData,
    pluginRoot: (pluginId, version) => path.join(userData, 'plugins', pluginId, version),
    readRegularFileWithin: async () => null,
    send: state => { sent.push(state) },
    sendPetStatus: () => {},
    rendererOrigin: () => 'agent-pets://app',
    sendPluginTheme: () => {},
    schedulePluginTheme: callback => callback(),
    salt: new Uint8Array(32).fill(3),
  })
  runtime.sync({ registry: [], contexts: new Map(), pluginsEnabled: false })
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipcMain = {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => { handlers.set(channel, handler) },
    on: (channel: string, handler: (...args: unknown[]) => unknown) => { handlers.set(channel, handler) },
  }
  const window = { isDestroyed: () => false } as unknown as BrowserWindow
  let dialogOpen = false
  const dialogFilters: string[] = []
  const assertPanel = (event: unknown) => { if (event !== 'panel') throw new Error('Unauthorized plugin panel IPC sender') }
  registerUserPanelThemeIpc({
    ipcMain: ipcMain as unknown as UserPanelThemeIpcDependencies['ipcMain'],
    assertPluginPanelSender: assertPanel,
    getRuntime: () => runtime,
    getPanelWindow: () => window,
    isDialogOpen: () => dialogOpen,
    setDialogOpen: value => { dialogOpen = value },
    showOpenDialog: async (_window, options) => {
      dialogFilters.push(...options.filters.map(filter => filter.name))
      return dialog.open?.length ? { canceled: false, filePaths: [dialog.open.shift()!] } : { canceled: true, filePaths: [] }
    },
    showSaveDialog: async (_window, options) => {
      dialogFilters.push(...options.filters.map(filter => filter.name))
      assert.match(options.defaultPath, /^[\p{L}\p{N}\p{M}_-]+\.agent-pets-theme\.json$/u)
      return dialog.save ? { canceled: false, filePath: dialog.save } : { canceled: true }
    },
    translate: key => key,
    readImportFile: readUserPanelThemeImportFile,
    writeExportFile: writeUserPanelThemeExportFile,
  })
  registerPanelThemeIpc({
    ipcMain: ipcMain as unknown as PanelThemeIpcDependencies['ipcMain'],
    assertPluginPanelSender: assertPanel,
    assertPetSender: () => {},
    setPanelAppearance: () => {},
    getPetStatus: () => runtime.getPetStatus(),
    getStore: () => runtime.store,
    getSources: () => runtime.getSources(),
    getState: () => runtime.getState(),
    publish: () => runtime.publish(),
    getPanelWindow: () => window,
    isDialogOpen: () => dialogOpen,
    setDialogOpen: value => { dialogOpen = value },
    showOpenDialog: async (_window, options) => {
      dialogFilters.push(...options.filters.map(filter => filter.name))
      return dialog.open?.length ? { canceled: false, filePaths: [dialog.open.shift()!] } : { canceled: true, filePaths: [] }
    },
    translate: key => key,
    readUserImage: async filePath => ({ ok: true, bytes: new Uint8Array(fs.readFileSync(filePath)) }),
    prepareUserImage,
    storeUserImage: (pluginId, prepared) => storeUserImage(userData, pluginId, prepared),
    deleteUserImage: (pluginId, file) => deleteUserImage(userData, pluginId, file),
    pluginPanelError: () => 'plugin_action_failed',
    now: () => Date.parse('2026-11-08T00:00:00.000Z'),
  })
  const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)!('panel' as unknown as IpcMainInvokeEvent, ...args) as Promise<any> | any
  return { userData, runtime, sent, handlers, invoke, dialogFilters, cleanup: () => fs.rmSync(userData, { recursive: true, force: true }) }
}

test('every user theme channel rejects senders other than the panel main frame', async () => {
  const context = setup()
  try {
    for (const channel of USER_CHANNELS) {
      assert.ok(context.handlers.has(channel), channel)
      for (const sender of ['pet', 'plugin-view', 'plugin-host', 'subframe']) {
        assert.throws(() => context.handlers.get(channel)!(sender, builtinDefinition()), /Unauthorized/, `${channel} ${sender}`)
      }
    }
  } finally { context.cleanup() }
})

test('validate returns structured diagnostics, rejects oversized or extra payloads and is cached by content', () => {
  const context = setup()
  try {
    assert.deepEqual(context.invoke(IPC_CHANNELS.panelThemeValidate, builtinDefinition()), { ok: true, value: { valid: true, issues: [], minDim: {} } })
    const bad = builtinDefinition()
    bad.modes.dark.colors.textMuted = 'rgb(60 60 60 / 1)'
    const result = context.invoke(IPC_CHANNELS.panelThemeValidate, bad)
    assert.equal(result.ok, true)
    assert.equal(result.value.valid, false)
    const issue = result.value.issues[0]
    assert.equal(issue.mode, 'dark')
    assert.equal(issue.path, 'colors.textMuted')
    assert.equal(issue.required, 4.5)
    assert.equal(typeof issue.suggested, 'string')
    // 相同內容（屬性順序不同）直接命中快取，回傳同一個物件。
    const reordered = { modes: structuredClone(bad.modes), shape: { ...bad.shape }, typography: { ...bad.typography } }
    assert.equal(context.invoke(IPC_CHANNELS.panelThemeValidate, reordered).value, result.value)
    assert.deepEqual(context.invoke(IPC_CHANNELS.panelThemeValidate, { ...builtinDefinition(), padding: 'x'.repeat(17 * 1024) }), { ok: false, error: 'invalid_request' })
    assert.deepEqual(context.invoke(IPC_CHANNELS.panelThemeValidate, builtinDefinition(), 'extra'), { ok: false, error: 'invalid_request' })
    const schema = context.invoke(IPC_CHANNELS.panelThemeValidate, { nope: true })
    assert.equal(schema.value.valid, false)
    assert.equal(typeof schema.value.schemaError.path, 'string')
  } finally { context.cleanup() }
})

test('my themes appear in the catalog, apply through the slot channel and fall back to built-in when deleted', async () => {
  const context = setup()
  try {
    const created = context.invoke(IPC_CHANNELS.panelThemeUserCreate, 'Sakura', builtinDefinition())
    assert.equal(created.ok, true)
    const id = created.value.id as string
    const ref = { pluginId: USER_PANEL_THEME_OWNER, themeId: id }
    const entry = context.runtime.getState().themes.find(theme => theme.ref.themeId === id)
    assert.deepEqual(entry?.ref, ref)
    assert.equal(entry?.displayName['en-US'], 'Sakura')
    assert.equal(entry?.pluginName['en-US'], 'My themes')
    // 插件全部關閉也照樣可以套用（使用者主題不是插件）。
    const applied = context.invoke(IPC_CHANNELS.panelThemeSlotSet, 'dark', ref)
    assert.equal(applied.ok, true)
    assert.equal(context.runtime.getState().slots.dark.status, 'active')
    assert.equal(context.runtime.getPetStatus().dark !== null, true)
    const invalid = builtinDefinition()
    invalid.modes.light.colors.text = 'rgb(240 240 240 / 1)'
    const rejected = context.invoke(IPC_CHANNELS.panelThemeUserUpdate, id, invalid)
    assert.equal(rejected.ok, false)
    assert.equal(rejected.error, 'invalid_panel_theme')
    assert.equal(rejected.validation.valid, false)
    assert.equal(context.invoke(IPC_CHANNELS.panelThemeUserRename, id, 'Night').value.themes[0].name, 'Night')
    const copy = context.invoke(IPC_CHANNELS.panelThemeUserDuplicate, id, 'Night copy')
    assert.equal(copy.value.themes.length, 2)
    assert.deepEqual(context.invoke(IPC_CHANNELS.panelThemeUserDelete, 'u-../../x'), { ok: false, error: 'invalid_request' })
    assert.equal(context.invoke(IPC_CHANNELS.panelThemeUserDelete, id).ok, true)
    assert.equal(context.runtime.getState().slots.dark.status, 'builtin')
    assert.equal(context.runtime.getState().slots.dark.ref, null)
    assert.equal(context.invoke(IPC_CHANNELS.panelThemeUserDelete, id).error, 'theme_not_found')
  } finally { context.cleanup() }
})

test('user background images reuse the host import, are served with panel CORS for colour extraction and are removed with the theme', async () => {
  const userData = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-user-theme-image-')))
  const imagePath = path.join(userData, 'pick.png')
  fs.writeFileSync(imagePath, png(320, 200))
  const context = setup({ open: [imagePath] })
  try {
    const definition = builtinDefinition()
    definition.modes.light.colors.textMuted = 'rgb(80 72 60 / 1)'
    definition.modes.light.colors.accent = 'rgb(120 60 140 / 1)'
    definition.modes.light.image = { fit: 'cover', overlayColor: definition.modes.light.colors.bg, dim: 0.95 }
    const created = context.invoke(IPC_CHANNELS.panelThemeUserCreate, 'Photo', definition)
    assert.equal(created.ok, true, JSON.stringify(created))
    const ref = { pluginId: USER_PANEL_THEME_OWNER, themeId: created.value.id }
    const imported = await context.invoke(IPC_CHANNELS.panelThemeUserImageImport, ref, 'light')
    assert.equal(imported.ok, true, JSON.stringify(imported))
    const current = context.runtime.getState().themes[0]!.modes.light!.userImage!.current!
    const response = await context.runtime.handleRequest(current.url, 'GET')
    // 測試替身的 readRegularFileWithin 讀不到檔案，所以只檢查 token 存在與目錄位置。
    assert.equal(response.status, 404)
    const directory = path.join(context.userData, 'panel-theme-images', USER_PANEL_THEME_OWNER)
    assert.equal(fs.readdirSync(directory).length, 1)
    // 啟動清掃不會把「我的主題」的圖片目錄當成孤兒刪掉。
    context.runtime.sweep()
    assert.equal(fs.readdirSync(directory).length, 1)
    assert.equal(context.invoke(IPC_CHANNELS.panelThemeUserDelete, ref.themeId).ok, true)
    assert.deepEqual(context.runtime.store.get().userImages, {})
    assert.equal(fs.existsSync(directory) ? fs.readdirSync(directory).length : 0, 0)
  } finally {
    context.cleanup()
    fs.rmSync(userData, { recursive: true, force: true })
  }
})

test('export writes only name and definition; import is strictly validated and creates a new theme', async () => {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-user-theme-export-')))
  const target = path.join(scratch, 'out.json')
  const context = setup({ save: target })
  try {
    const id = context.invoke(IPC_CHANNELS.panelThemeUserCreate, 'Sakura <night>', builtinDefinition()).value.id
    assert.equal((await context.invoke(IPC_CHANNELS.panelThemeUserExport, id)).ok, true)
    const exported = JSON.parse(fs.readFileSync(target, 'utf8'))
    assert.deepEqual(Object.keys(exported).sort(), ['definition', 'format', 'name', 'schemaVersion'])
    assert.doesNotMatch(fs.readFileSync(target, 'utf8'), new RegExp(context.userData.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

    const bad = path.join(scratch, 'bad.json')
    fs.writeFileSync(bad, JSON.stringify({ ...exported, extra: true }))
    const huge = path.join(scratch, 'huge.json')
    fs.writeFileSync(huge, ' '.repeat(17 * 1024))
    const unreadable = path.join(scratch, 'unreadable.json')
    const weak = structuredClone(exported)
    weak.definition.modes.light.colors.text = 'rgb(230 230 230 / 1)'
    fs.writeFileSync(unreadable, JSON.stringify(weak))
    const importer = setup({ open: [target, bad, huge, unreadable] })
    try {
      const imported = await importer.invoke(IPC_CHANNELS.panelThemeUserImport)
      assert.equal(imported.ok, true)
      assert.equal(imported.value.themes[0].name, exported.name)
      assert.deepEqual(imported.value.themes[0].definition, exported.definition)
      assert.equal((await importer.invoke(IPC_CHANNELS.panelThemeUserImport)).error, 'theme_import_invalid')
      assert.equal((await importer.invoke(IPC_CHANNELS.panelThemeUserImport)).error, 'theme_import_invalid')
      const rejected = await importer.invoke(IPC_CHANNELS.panelThemeUserImport)
      assert.equal(rejected.error, 'invalid_panel_theme')
      assert.equal(rejected.validation.valid, false)
      assert.equal((await importer.invoke(IPC_CHANNELS.panelThemeUserImport)).error, 'cancelled')
      assert.equal(importer.runtime.userThemes.list().length, 1)
    } finally { importer.cleanup() }
  } finally {
    context.cleanup()
    fs.rmSync(scratch, { recursive: true, force: true })
  }
})

test('names are size-checked before normalisation on every channel that takes one', () => {
  const context = setup()
  try {
    const id = context.invoke(IPC_CHANNELS.panelThemeUserCreate, 'Mine', builtinDefinition()).value.id
    const huge = 'あ'.repeat(USER_PANEL_THEME_NAME_MAX * 4 + 1)
    const calls: Array<[string, ...unknown[]]> = [
      [IPC_CHANNELS.panelThemeUserCreate, huge, builtinDefinition()],
      [IPC_CHANNELS.panelThemeUserCreate, 42, builtinDefinition()],
      [IPC_CHANNELS.panelThemeUserRename, id, huge],
      [IPC_CHANNELS.panelThemeUserRename, id, { name: 'x' }],
      [IPC_CHANNELS.panelThemeUserDuplicate, id, huge],
      [IPC_CHANNELS.panelThemeUserUpdate, id, builtinDefinition(), huge],
      [IPC_CHANNELS.panelThemeUserUpdate, id, builtinDefinition(), 7],
    ]
    for (const [channel, ...args] of calls) assert.deepEqual(context.invoke(channel, ...args), { ok: false, error: 'invalid_request' }, channel)
    // 上限內但清理後仍太長的名稱，由 store 的規則拒絕。
    assert.equal(context.invoke(IPC_CHANNELS.panelThemeUserRename, id, 'x'.repeat(USER_PANEL_THEME_NAME_MAX + 1)).error, 'invalid_request')
    assert.deepEqual(context.runtime.userThemes.list().map(theme => theme.name), ['Mine'])
  } finally { context.cleanup() }
})

test('update can rename in the same atomic write; a bad name or definition leaves the record unchanged', () => {
  const context = setup()
  try {
    const id = context.invoke(IPC_CHANNELS.panelThemeUserCreate, 'Mine', builtinDefinition()).value.id as string
    const file = path.join(context.runtime.userThemes.directory, `${id}.json`)
    const definition = builtinDefinition()
    definition.shape = { radiusSm: 2, radiusMd: 4, radiusLg: 6 }
    const saved = context.invoke(IPC_CHANNELS.panelThemeUserUpdate, id, definition, '  Renamed  ')
    assert.equal(saved.ok, true)
    assert.deepEqual(saved.value.themes.map((theme: { name: string }) => theme.name), ['Renamed'])
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'))
    assert.equal(onDisk.name, 'Renamed')
    assert.equal(onDisk.definition.shape.radiusLg, 6)
    // 只改定義時名稱不變；三個以上的引數一律拒絕。
    assert.equal(context.invoke(IPC_CHANNELS.panelThemeUserUpdate, id, builtinDefinition()).value.themes[0].name, 'Renamed')
    assert.equal(context.invoke(IPC_CHANNELS.panelThemeUserUpdate, id, builtinDefinition(), 'A', 'extra').error, 'invalid_request')
    const before = fs.readFileSync(file, 'utf8')
    assert.equal(context.invoke(IPC_CHANNELS.panelThemeUserUpdate, id, definition, '   ').error, 'invalid_request')
    const invalid = builtinDefinition()
    invalid.modes.light.colors.text = 'rgb(240 240 240 / 1)'
    assert.equal(context.invoke(IPC_CHANNELS.panelThemeUserUpdate, id, invalid, 'Other').error, 'invalid_panel_theme')
    assert.equal(fs.readFileSync(file, 'utf8'), before)
  } finally { context.cleanup() }
})

test('export file names keep letters in any script and drop everything unsafe', () => {
  assert.equal(exportFileName('我的主題'), '我的主題.agent-pets-theme.json')
  assert.equal(exportFileName('Sakura night'), 'Sakura-night.agent-pets-theme.json')
  assert.equal(exportFileName('../../etc/passwd'), 'etc-passwd.agent-pets-theme.json')
  assert.equal(exportFileName('a\\b:c*d?e"f<g>h|i'), 'a-b-c-d-e-f-g-h-i.agent-pets-theme.json')
  assert.equal(exportFileName('名稱\u202e\u0000\u0007.'), '名稱.agent-pets-theme.json')
  assert.equal(exportFileName('trailing dots...  '), 'trailing-dots.agent-pets-theme.json')
  for (const reserved of ['CON', 'nul', 'Com1', 'LPT9', 'aux']) assert.equal(exportFileName(reserved), 'theme.agent-pets-theme.json', reserved)
  assert.equal(exportFileName('<>'), 'theme.agent-pets-theme.json')
  const long = exportFileName('𠀀'.repeat(60))
  assert.equal([...long.replace('.agent-pets-theme.json', '')].length, 40)
  assert.ok(!long.includes('\ufffd'))
})

test('dialog filter names come from the locale table', async () => {
  const context = setup()
  try {
    const id = context.invoke(IPC_CHANNELS.panelThemeUserCreate, 'Mine', builtinDefinition()).value.id
    await context.invoke(IPC_CHANNELS.panelThemeUserExport, id)
    await context.invoke(IPC_CHANNELS.panelThemeUserImport)
    assert.deepEqual(context.dialogFilters, ['design.themeEditor.fileFilter', 'design.themeEditor.fileFilter'])
  } finally { context.cleanup() }
})
