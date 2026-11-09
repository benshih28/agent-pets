import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import test from 'node:test'
import { PanelThemeRuntime, type PanelThemeRuntimeContext } from '../electron/main/panel-theme-runtime.ts'
import { parsePluginManifest } from '../electron/plugin-manifest.ts'
import { prepareUserImage, storeUserImage } from '../electron/panel-theme-images.ts'
import { PET_THEME_COLOR_PROPERTIES, type PanelThemeState, type PetThemeState } from '../src/types/panel-theme.ts'
import { DARK_COLORS, LIGHT_COLORS, manifest, png, theme, woff2 } from './support/panel-theme-fixtures.mts'

// readRegularFileWithin 的替身，具有相同的路徑限制契約。
async function readWithin(root: string, relativePath: string, maxBytes: number): Promise<Uint8Array | null> {
  const target = path.resolve(root, relativePath)
  const relative = path.relative(root, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null
  try {
    const stat = fs.lstatSync(target)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) return null
    return new Uint8Array(fs.readFileSync(target))
  } catch {
    return null
  }
}

function setup() {
  const userData = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-panel-theme-runtime-')))
  const pluginRoot = path.join(userData, 'plugins', 'theme-pack', '1.0.0')
  fs.mkdirSync(path.join(pluginRoot, 'bg'), { recursive: true })
  fs.mkdirSync(path.join(pluginRoot, 'fonts'), { recursive: true })
  fs.writeFileSync(path.join(pluginRoot, 'bg', 'light.png'), png(256, 256))
  fs.writeFileSync(path.join(pluginRoot, 'fonts', 'body.woff2'), woff2())
  const raw = manifest([theme({
    fonts: [{ id: 'body', src: 'fonts/body.woff2' }],
    typography: { body: ['@body', 'sans-serif'] },
    modes: {
      light: { colors: LIGHT_COLORS, background: { type: 'image', src: 'bg/light.png', overlay: { color: '#eef6f6', opacity: 0.9 } }, userImage: { allowed: true, overlay: { color: '#eef6f6', opacity: 0.9 } } },
      dark: { colors: DARK_COLORS },
    },
  })])
  const parsed = parsePluginManifest(raw)
  if (!parsed.ok) throw new Error(parsed.error)
  const sent: PanelThemeState[] = []
  const petSent: PetThemeState[] = []
  const runtime = new PanelThemeRuntime({
    userDataDirectory: userData,
    pluginRoot: (pluginId, version) => path.join(userData, 'plugins', pluginId, version),
    readRegularFileWithin: readWithin,
    send: state => { sent.push(state) },
    sendPetStatus: state => { petSent.push(state) },
    rendererOrigin: () => 'agent-pets://app',
    sendPluginTheme: () => {},
    schedulePluginTheme: callback => callback(),
    salt: new Uint8Array(32).fill(7),
  })
  const context = (enabled = true, pluginsEnabled = true): PanelThemeRuntimeContext => ({ manifest: parsed.manifest, enabled, pluginsEnabled })
  const sync = (enabled = true, pluginsEnabled = true, installed = true) => runtime.sync({
    registry: installed ? [{ id: 'theme-pack', currentVersion: '1.0.0', status: 'enabled' }] : [],
    contexts: new Map(installed ? [['theme-pack', context(enabled, pluginsEnabled)]] : []),
    pluginsEnabled,
  })
  return { userData, pluginRoot, runtime, sent, petSent, sync, cleanup: () => fs.rmSync(userData, { recursive: true, force: true }) }
}

test('the panel-theme route serves mapped tokens only, with nosniff, immutable caching and font CORS for the panel origin', async () => {
  const context = setup()
  try {
    context.sync()
    const entry = context.runtime.getState().themes[0]!
    const background = entry.modes.light!.background
    assert.equal(background.type, 'image')
    const imageUrl = background.type === 'image' ? background.url : ''
    assert.match(imageUrl, /^agent-pets:\/\/panel-theme\/[0-9a-f]{32}$/)
    const image = await context.runtime.handleRequest(imageUrl, 'GET')
    assert.equal(image.status, 200)
    assert.equal(image.headers.get('content-type'), 'image/png')
    assert.equal(image.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(image.headers.get('cache-control'), 'private, max-age=31536000, immutable')
    assert.equal(image.headers.get('access-control-allow-origin'), null)
    const font = await context.runtime.handleRequest(entry.shared.fonts[0]!.url, 'GET')
    assert.equal(font.status, 200)
    assert.equal(font.headers.get('content-type'), 'font/woff2')
    assert.equal(font.headers.get('access-control-allow-origin'), 'agent-pets://app')
    assert.match(entry.shared.fonts[0]!.alias, /^apt-[0-9a-f]{16}$/)
    assert.equal(entry.shared.properties['--organic-font-body'], `"${entry.shared.fonts[0]!.alias}", sans-serif`)

    for (const url of [
      'agent-pets://panel-theme/00000000000000000000000000000000',
      `${imageUrl}?x=1`, `${imageUrl}#x`, `${imageUrl}/`, imageUrl.toUpperCase(),
      'agent-pets://panel-theme/../plugins/theme-pack/1.0.0/bg/light.png',
      'agent-pets://panel-theme/bg/light.png',
      imageUrl.replace('panel-theme', 'panel-theme:8080'),
      imageUrl.replace('agent-pets://', 'agent-pets://user@'),
      'not a url',
    ]) assert.equal((await context.runtime.handleRequest(url, 'GET')).status, 404, url)
    assert.equal((await context.runtime.handleRequest(imageUrl, 'POST')).status, 405)
  } finally { context.cleanup() }
})

test('served bytes are re-checked: a swapped file that fails the header rules is not served', async () => {
  const context = setup()
  try {
    context.sync()
    const background = context.runtime.getState().themes[0]!.modes.light!.background
    const url = background.type === 'image' ? background.url : ''
    fs.writeFileSync(path.join(context.pluginRoot, 'bg', 'light.png'), png(256, 256, { animated: true }))
    assert.equal((await context.runtime.handleRequest(url, 'GET')).status, 404)
    fs.writeFileSync(path.join(context.pluginRoot, 'bg', 'light.png'), '<svg/>')
    assert.equal((await context.runtime.handleRequest(url, 'GET')).status, 404)
    const font = context.runtime.getState().themes[0]!.shared.fonts[0]!.url
    fs.writeFileSync(path.join(context.pluginRoot, 'fonts', 'body.woff2'), 'OTTO not woff2')
    assert.equal((await context.runtime.handleRequest(font, 'GET')).status, 404)
  } finally { context.cleanup() }
})

test('disabling, switching plugins off or removing makes every token 404 and keeps or clears slots', async () => {
  const context = setup()
  try {
    context.sync()
    context.runtime.store.setSlot('light', { pluginId: 'theme-pack', themeId: 'aurora' })
    context.runtime.publish()
    // 寵物視窗只收到它用得到的色盤子集，其值與面板相同。
    const pet = context.petSent.at(-1)!
    assert.equal(pet.dark, null)
    assert.deepEqual(Object.keys(pet.light!.colors), [...PET_THEME_COLOR_PROPERTIES])
    assert.equal(pet.light!.colors['--organic-text'], context.runtime.getState().themes[0]!.modes.light!.properties['--organic-text'])
    const background = context.runtime.getState().themes[0]!.modes.light!.background
    const url = background.type === 'image' ? background.url : ''
    assert.equal(context.runtime.getState().slots.light.status, 'active')

    context.sync(false)
    assert.equal((await context.runtime.handleRequest(url, 'GET')).status, 404)
    assert.deepEqual(context.runtime.getState().slots.light.reason, 'plugin_disabled')
    assert.equal(context.runtime.getState().themes.length, 0)
    context.sync(true, false)
    assert.deepEqual(context.runtime.getState().slots.light.reason, 'plugins_off')
    context.sync()
    assert.equal(context.runtime.getState().slots.light.status, 'active')
    assert.equal((await context.runtime.handleRequest(url, 'GET')).status, 200)

    context.sync(true, true, false)
    assert.equal((await context.runtime.handleRequest(url, 'GET')).status, 404)
    assert.equal(context.runtime.store.get().slots.light, null)
  } finally { context.cleanup() }
})

test('user images get a session token, and broadcasts happen only when the state changes', async () => {
  const context = setup()
  try {
    context.sync()
    const before = context.sent.length
    context.sync()
    assert.equal(context.sent.length, before)
    const prepared = prepareUserImage(png(300, 200))
    assert.ok(prepared.ok)
    if (!prepared.ok) return
    storeUserImage(context.userData, 'theme-pack', prepared)
    context.runtime.store.setUserImage({ pluginId: 'theme-pack', themeId: 'aurora' }, 'light', {
      file: prepared.file, type: prepared.type, width: 300, height: 200, bytes: prepared.bytes.byteLength,
      fit: 'cover', position: 'center', dim: 0.9, blur: 0, importedAt: '2026-11-08T00:00:00.000Z',
    })
    context.runtime.publish()
    assert.equal(context.sent.length, before + 1)
    const current = context.runtime.getState().themes[0]!.modes.light!.userImage!.current!
    const response = await context.runtime.handleRequest(current.url, 'GET')
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'image/png')
    // 主題編輯器以 crossOrigin 載入使用者圖片取色：只回給受信任的面板來源。
    assert.equal(response.headers.get('access-control-allow-origin'), 'agent-pets://app')
    assert.equal(response.headers.get('vary'), 'Origin')
    // 移除時會刪除圖片目錄與 store 項目。
    context.runtime.removePlugin('theme-pack')
    assert.equal(fs.existsSync(path.join(context.userData, 'panel-theme-images', 'theme-pack')), false)
    assert.deepEqual(context.runtime.store.get().userImages, {})
  } finally { context.cleanup() }
})

test('an update that drops userImage prunes the stored entry and file', () => {
  const context = setup()
  try {
    context.sync()
    const prepared = prepareUserImage(png(300, 200))
    if (!prepared.ok) throw new Error('fixture')
    storeUserImage(context.userData, 'theme-pack', prepared)
    context.runtime.store.setUserImage({ pluginId: 'theme-pack', themeId: 'aurora' }, 'light', {
      file: prepared.file, type: prepared.type, width: 300, height: 200, bytes: 1, fit: 'cover', position: 'center', dim: 0.9, blur: 0, importedAt: '2026-11-08T00:00:00.000Z',
    })
    const updated = parsePluginManifest(manifest([theme()], { version: '1.1.0' }))
    if (!updated.ok) throw new Error(updated.error)
    context.runtime.sync({
      registry: [{ id: 'theme-pack', currentVersion: '1.1.0', status: 'enabled' }],
      contexts: new Map([['theme-pack', { manifest: updated.manifest, enabled: true, pluginsEnabled: true }]]),
      pluginsEnabled: true,
    })
    assert.deepEqual(context.runtime.store.get().userImages, {})
    assert.equal(fs.existsSync(path.join(context.userData, 'panel-theme-images', 'theme-pack', prepared.file)), false)
  } finally { context.cleanup() }
})

test('plugin partitions never get the panel-theme host', () => {
  const protocol = fs.readFileSync('electron/plugin-protocol.ts', 'utf8')
  assert.doesNotMatch(protocol, /panel-theme/)
  const runtime = fs.readFileSync('electron/main/runtime.ts', 'utf8')
  assert.match(runtime, /url\.hostname === 'panel-theme'/)
  assert.match(fs.readFileSync('index.html', 'utf8'), /font-src 'self' data: agent-pets:\/\/panel-theme;/)
})
