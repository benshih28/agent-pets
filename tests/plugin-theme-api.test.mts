import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import test from 'node:test'
import { PanelThemeRuntime } from '../electron/main/panel-theme-runtime.ts'
import { PluginBroker } from '../electron/plugin-broker.ts'
import { PluginFeedController } from '../electron/plugin-feed.ts'
import { parsePluginManifest } from '../electron/plugin-manifest.ts'
import { createPluginPanelPublicApi } from '../electron/plugin-panel-view-bridge.ts'
import { pluginHostAssets } from '../electron/plugin-host-assets.ts'
import { builtinPanelThemeProperties, resolvePanelThemes } from '../electron/plugin-panel-themes.ts'
import { buildPluginThemeSnapshot } from '../electron/plugin-theme-tokens.ts'
import { IPC_CHANNELS } from '../electron/ipc/channels.ts'
import type { PluginManifest } from '../src/types/plugin.ts'
import {
  isPluginThemeSnapshot,
  PLUGIN_THEME_API_VERSION,
  PLUGIN_THEME_TOKENS,
  type PluginThemeSnapshot,
} from '../src/types/plugin-theme.ts'
import { DARK_COLORS, LIGHT_COLORS, manifest, theme, woff2 } from './support/panel-theme-fixtures.mts'

const THEMED = theme({
  fonts: [{ id: 'body', src: 'fonts/body.woff2' }],
  typography: { body: ['@body', 'PingFang TC', 'sans-serif'], heading: ['@body', 'serif'], scale: 1.05 },
  shape: { radiusSm: 6, radiusMd: 12, radiusLg: 20 },
  modes: { light: { colors: LIGHT_COLORS }, dark: { colors: DARK_COLORS } },
})

test('the built-in snapshot covers exactly the public token list for both modes', () => {
  for (const mode of ['light', 'dark'] as const) {
    const snapshot = buildPluginThemeSnapshot(null, mode)
    assert.equal(snapshot.apiVersion, PLUGIN_THEME_API_VERSION)
    assert.equal(snapshot.mode, mode)
    assert.deepEqual(Object.keys(snapshot.tokens).sort(), [...PLUGIN_THEME_TOKENS].sort())
    assert.ok(isPluginThemeSnapshot(snapshot))
    assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.tokens))
    assert.equal(snapshot.tokens['--ap-focus'], snapshot.tokens['--ap-accent-text'])
    assert.equal(snapshot.tokens['--ap-font-scale'], '1')
    assert.equal(snapshot.tokens['--ap-radius-md'], '16px')
  }
  assert.equal(buildPluginThemeSnapshot(null, 'light').tokens['--ap-bg'], 'rgb(245 234 216 / 1)')
  assert.equal(buildPluginThemeSnapshot(null, 'dark').tokens['--ap-bg'], 'rgb(31 27 22 / 1)')
})

test('a theme snapshot maps the validated palette and never exposes host font aliases or ids', () => {
  const [resolved] = resolvePanelThemes([THEMED])!
  const snapshot = buildPluginThemeSnapshot(resolved!, 'light')
  assert.ok(isPluginThemeSnapshot(snapshot))
  assert.equal(snapshot.tokens['--ap-bg'], 'rgb(238 246 246 / 1)')
  assert.equal(snapshot.tokens['--ap-on-accent'], 'rgb(255 255 255 / 1)')
  // 主題沒有宣告 infoText／shadow／highlight 時取該模式的內建值（tokens.css 的 --builtin-organic-*）。
  assert.equal(snapshot.tokens['--ap-info'], 'rgb(46 91 140 / 1)')
  assert.equal(snapshot.tokens['--ap-shadow'], 'rgb(46 43 37 / 1)')
  assert.equal(snapshot.tokens['--ap-highlight'], 'rgb(255 255 255 / 1)')
  const [declared] = resolvePanelThemes([theme({ modes: { light: { colors: { ...LIGHT_COLORS, infoText: '#1f5f99', shadow: '#10202a' } } } })])!
  assert.equal(buildPluginThemeSnapshot(declared!, 'light').tokens['--ap-info'], 'rgb(31 95 153 / 1)')
  assert.equal(buildPluginThemeSnapshot(declared!, 'light').tokens['--ap-shadow'], 'rgb(16 32 42 / 1)')
  assert.equal(snapshot.tokens['--ap-font-body'], '"PingFang TC", sans-serif')
  assert.equal(snapshot.tokens['--ap-font-heading'], 'serif')
  assert.equal(snapshot.tokens['--ap-font-scale'], '1.05')
  assert.deepEqual([snapshot.tokens['--ap-radius-sm'], snapshot.tokens['--ap-radius-md'], snapshot.tokens['--ap-radius-lg']], ['6px', '12px', '20px'])
  const serialized = JSON.stringify(snapshot)
  for (const secret of ['apt-', 'aurora', 'theme-pack', 'agent-pets://', 'body.woff2']) assert.ok(!serialized.includes(secret), secret)
  // 主題未宣告的模式會退回內建色盤。
  const [lightOnly] = resolvePanelThemes([theme({ modes: { light: { colors: LIGHT_COLORS } } })])!
  assert.deepEqual(buildPluginThemeSnapshot(lightOnly!, 'dark'), buildPluginThemeSnapshot(null, 'dark'))
})

test('the snapshot validator rejects extra, missing and unsafe values', () => {
  const base = buildPluginThemeSnapshot(null, 'dark')
  const variant = (tokens: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ ...base, tokens: { ...base.tokens, ...tokens }, ...extra })
  assert.equal(isPluginThemeSnapshot(variant({}, { apiVersion: 2 })), false)
  assert.equal(isPluginThemeSnapshot(variant({}, { mode: 'sepia' })), false)
  assert.equal(isPluginThemeSnapshot(variant({}, { pluginId: 'theme-pack' })), false)
  assert.equal(isPluginThemeSnapshot(variant({ '--ap-extra': 'rgb(0 0 0 / 1)' })), false)
  const { ['--ap-bg']: _removed, ...missing } = base.tokens
  assert.equal(isPluginThemeSnapshot({ ...base, tokens: missing }), false)
  for (const [name, value] of [
    ['--ap-bg', 'red'], ['--ap-bg', 'var(--x)'], ['--ap-bg', 'rgb(0 0 0 / 1); background: url(x)'],
    ['--ap-radius-sm', 'calc(1px)'], ['--ap-font-body', 'url(x), sans-serif'], ['--ap-font-body', '"a";}'],
    ['--ap-font-scale', '2'], ['--ap-font-scale', '0.5'], ['--ap-bg', 7],
  ] as const) {
    assert.equal(isPluginThemeSnapshot(variant({ [name]: value })), false, `${name}=${String(value)}`)
  }
})

function runtimeFixture() {
  const userData = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-plugin-theme-')))
  const pluginRoot = path.join(userData, 'plugins', 'theme-pack', '1.0.0')
  fs.mkdirSync(path.join(pluginRoot, 'fonts'), { recursive: true })
  fs.writeFileSync(path.join(pluginRoot, 'fonts', 'body.woff2'), woff2())
  const parsed = parsePluginManifest(manifest([THEMED]))
  if (!parsed.ok) throw new Error(parsed.error)
  const sent: PluginThemeSnapshot[] = []
  const queue: Array<() => void> = []
  const runtime = new PanelThemeRuntime({
    userDataDirectory: userData,
    pluginRoot: (pluginId, version) => path.join(userData, 'plugins', pluginId, version),
    readRegularFileWithin: async () => null,
    send: () => {},
    sendPetStatus: () => {},
    rendererOrigin: () => null,
    sendPluginTheme: snapshot => { sent.push(snapshot) },
    schedulePluginTheme: callback => { queue.push(callback) },
    initialMode: 'light',
    salt: new Uint8Array(32).fill(3),
  })
  const flush = () => { while (queue.length) queue.shift()!() }
  const sync = (enabled = true) => runtime.sync({
    registry: [{ id: 'theme-pack', currentVersion: '1.0.0', status: 'enabled' }],
    contexts: new Map([['theme-pack', { manifest: parsed.manifest, enabled, pluginsEnabled: true }]]),
    pluginsEnabled: true,
  })
  return { runtime, sent, queue, flush, sync, cleanup: () => fs.rmSync(userData, { recursive: true, force: true }) }
}

test('the runtime follows the active slot and the panel mode, coalescing and de-duplicating change events', () => {
  const context = runtimeFixture()
  try {
    context.sync()
    context.flush()
    assert.equal(context.sent.length, 0, 'no slot set: still the built-in snapshot that was never sent')
    context.runtime.store.setSlot('dark', { pluginId: 'theme-pack', themeId: 'aurora' })
    context.runtime.publish()
    context.flush()
    assert.equal(context.sent.length, 0, 'the dark slot does not affect a light panel')

    context.runtime.setPanelAppearance({ mode: 'dark', forcedColors: false })
    context.runtime.setPanelAppearance({ mode: 'dark', forcedColors: false })
    assert.equal(context.queue.length, 1, 'one scheduled flush for a burst')
    context.flush()
    assert.equal(context.sent.length, 1)
    assert.equal(context.sent[0]!.mode, 'dark')
    assert.equal(context.sent[0]!.tokens['--ap-bg'], 'rgb(13 27 34 / 1)')
    assert.deepEqual(context.runtime.getPluginTheme(), context.sent[0])

    // 在同一個時間窗內 dark → light → dark 不會送出任何新事件。
    context.runtime.setPanelAppearance({ mode: 'light', forcedColors: false })
    context.runtime.setPanelAppearance({ mode: 'dark', forcedColors: false })
    context.flush()
    assert.equal(context.sent.length, 1)

    // forced-colors 會讓面板暫停插件主題，所以插件拿到的也是內建值。
    context.runtime.setPanelAppearance({ mode: 'dark', forcedColors: true })
    context.flush()
    assert.deepEqual(context.sent.at(-1), buildPluginThemeSnapshot(null, 'dark'))

    // 停用主題插件後會退回內建。
    context.runtime.setPanelAppearance({ mode: 'dark', forcedColors: false })
    context.flush()
    assert.equal(context.sent.at(-1)!.tokens['--ap-bg'], 'rgb(13 27 34 / 1)')
    context.sync(false)
    context.flush()
    assert.deepEqual(context.sent.at(-1), buildPluginThemeSnapshot(null, 'dark'))
    for (const snapshot of context.sent) assert.ok(isPluginThemeSnapshot(snapshot))
  } finally { context.cleanup() }
})

function brokerFixture(pluginManifest: PluginManifest, snapshot: PluginThemeSnapshot | null, enabled = true) {
  const userDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-theme-broker-'))
  fs.mkdirSync(path.join(userDataDirectory, 'plugins', pluginManifest.id), { recursive: true })
  const name = { 'zh-TW': '插件', 'en-US': 'Plugin' }
  const feed = new PluginFeedController({
    emit: () => {},
    isPetVisible: () => true,
    getGlobalState: () => ({ pluginsEnabled: true, dndEnabled: false, rateLimitPer10Min: 60 }),
    getPluginState: () => ({ enabled: true, muted: false, rateLimitPer10Min: 5, name }),
    isLinkHostAllowed: () => false,
    resolveIconUrl: () => null,
  })
  const broker = new PluginBroker({
    userDataDirectory,
    getContext: () => ({ manifest: pluginManifest, enabled, pluginsEnabled: true, dndEnabled: false, storageBytesPerPlugin: 1024 * 1024 }),
    feed,
    onReaction: () => ({ ok: true }),
    onThemeGet: () => snapshot,
  })
  return { broker, cleanup: () => fs.rmSync(userDataDirectory, { recursive: true, force: true }) }
}

const NO_PERMISSIONS: PluginManifest = {
  id: 'reader', name: { 'zh-TW': '讀者', 'en-US': 'Reader' }, version: '1.0.0', apiVersion: '1', author: 'Test',
  entry: 'dist/main.js', permissions: {}, contributes: {},
}

test('theme.get needs no permission, takes no arguments and returns an independent frozen copy', async () => {
  const snapshot = buildPluginThemeSnapshot(null, 'light')
  const context = brokerFixture(NO_PERMISSIONS, snapshot)
  try {
    const result = await context.broker.handle('reader', { id: '1', method: 'theme.get', args: [] }) as { ok: true; value: PluginThemeSnapshot }
    assert.equal(result.ok, true)
    assert.deepEqual(result.value, snapshot)
    assert.notEqual(result.value, snapshot)
    assert.ok(Object.isFrozen(result.value.tokens))
    assert.deepEqual(await context.broker.handle('reader', { id: '2', method: 'theme.get', args: ['other-plugin'] }), { id: '2', ok: false, error: 'invalid_request' })
  } finally { context.cleanup() }
  const unavailable = brokerFixture(NO_PERMISSIONS, null)
  try {
    assert.deepEqual(await unavailable.broker.handle('reader', { id: '3', method: 'theme.get', args: [] }), { id: '3', ok: false, error: 'disabled' })
  } finally { unavailable.cleanup() }
  const disabled = brokerFixture(NO_PERMISSIONS, snapshot, false)
  try {
    assert.deepEqual(await disabled.broker.handle('reader', { id: '4', method: 'theme.get', args: [] }), { id: '4', ok: false, error: 'disabled' })
  } finally { disabled.cleanup() }
})

test('the panel bridge validates theme.get and pushed changes before reaching plugin code', async () => {
  const snapshot = buildPluginThemeSnapshot(null, 'dark')
  let themeListener: ((value: unknown) => void) | null = null
  let response: unknown = { ok: true, value: snapshot }
  const api = createPluginPanelPublicApi({
    invoke: async method => method === 'theme.get' ? response : { ok: false, error: 'not_permitted' },
    onMessage: () => () => {},
    onThemeChange: listener => {
      themeListener = listener
      return () => { themeListener = null }
    },
  })
  const value = await api.theme.get()
  assert.deepEqual(value, snapshot)
  assert.ok(Object.isFrozen(value))
  response = { ok: true, value: { ...snapshot, tokens: { ...snapshot.tokens, '--ap-bg': 'red' } } }
  await assert.rejects(api.theme.get(), { code: 'invalid_request' })

  assert.throws(() => api.theme.onDidChange('nope' as unknown as () => void), { code: 'invalid_request' })
  const received: PluginThemeSnapshot[] = []
  const off = api.theme.onDidChange(next => {
    received.push(next)
    throw new Error('plugin callback errors stay inside the plugin')
  })
  themeListener!({ ...snapshot, extra: true })
  themeListener!(buildPluginThemeSnapshot(null, 'light'))
  assert.equal(received.length, 1)
  assert.equal(received[0]!.mode, 'light')
  off()
  assert.equal(themeListener, null)
})

test('panel views receive pushes on their own channel and the worker runtime forwards changes to every worker', () => {
  assert.equal(IPC_CHANNELS.pluginPanelThemeChanged, 'plugin-panel-theme-changed')
  const host = pluginHostAssets['host.js']!
  const bootstrap = pluginHostAssets['worker-bootstrap.js']!
  assert.match(host, /data\.type === 'theme-changed'[\s\S]*for \(const worker of workers\.values\(\)\) worker\.postMessage\(\{ type: 'theme-changed'/)
  assert.match(bootstrap, /theme: Object\.freeze\(\{\s*get: \(\) => rpc\('theme\.get', \[\]\)/)
  assert.match(bootstrap, /themeListeners\.clear\(\)/)
})

test('the public d.ts and docs list exactly the runtime token set', () => {
  const declaration = fs.readFileSync(new URL('../docs/plugins/agent-pets-plugin.d.ts', import.meta.url), 'utf8')
  const union = declaration.slice(declaration.indexOf('export type PluginThemeToken ='), declaration.indexOf('export interface PluginThemeSnapshot'))
  assert.deepEqual([...union.matchAll(/'(--ap-[a-z0-9-]+)'/g)].map(match => match[1]).sort(), [...PLUGIN_THEME_TOKENS].sort())
  for (const doc of ['panel-themes.md', 'panel-themes.zh-TW.md', 'whats-new-1.12.md', 'whats-new-1.12.zh-TW.md']) {
    const text = fs.readFileSync(new URL(`../docs/plugins/${doc}`, import.meta.url), 'utf8')
    for (const token of PLUGIN_THEME_TOKENS) assert.ok(text.includes(`\`${token}\``), `${doc} documents ${token}`)
  }
})

test('the theme reader fixture is a valid permission-free panel plugin that styles only with --ap-* tokens', () => {
  const root = new URL('./fixtures/plugins/ok-theme-reader/', import.meta.url)
  const parsed = parsePluginManifest(JSON.parse(fs.readFileSync(new URL('plugin.json', root), 'utf8')))
  assert.ok(parsed.ok)
  assert.deepEqual(parsed.manifest.permissions, {})
  const css = fs.readFileSync(new URL('ui/panel.css', root), 'utf8')
  for (const match of css.matchAll(/var\((--[a-z0-9-]+)/g)) assert.ok((PLUGIN_THEME_TOKENS as readonly string[]).includes(match[1]!), match[1])
})

test('tokens.css legacy colours follow --ap-* in plugin pages: each alias names the matching palette colour', () => {
  const tokens = fs.readFileSync('src/styles/tokens.css', 'utf8')
  const aliases = [...tokens.matchAll(/^ {2}(--organic-[a-z0-9-]+): var\((--ap-[a-z0-9-]+), var\(--builtin-organic-[a-z0-9-]+\)\);$/gm)]
  assert.equal(aliases.length, 19)
  for (const mode of ['light', 'dark'] as const) {
    const snapshot = buildPluginThemeSnapshot(null, mode)
    const builtin: Record<string, string> = builtinPanelThemeProperties(mode)
    for (const [, organic, ap] of aliases) {
      assert.equal(snapshot.tokens[ap as keyof typeof snapshot.tokens], builtin[organic!], `${mode} ${organic} ↔ ${ap}`)
    }
  }
})
