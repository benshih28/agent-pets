import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import test from 'node:test'
import { canonicalJson, PANEL_THEME_CACHE_MAX_ENTRIES, panelThemeContentHash, PanelThemeResolveCache } from '../electron/main/panel-theme-cache.ts'
import { PanelThemeRuntime } from '../electron/main/panel-theme-runtime.ts'
import { parsePluginManifest } from '../electron/plugin-manifest.ts'
import { resolvePanelThemes } from '../electron/plugin-panel-themes.ts'
import { DARK_COLORS, LIGHT_COLORS, manifest, theme } from './support/panel-theme-fixtures.mts'

function countingCache(maxEntries?: number) {
  let calls = 0
  const cache = new PanelThemeResolveCache({ maxEntries, resolve: declared => { calls += 1; return resolvePanelThemes(declared) } })
  return { cache, calls: () => calls }
}

test('the content hash is stable across key order and changes with any value', () => {
  assert.equal(canonicalJson({ b: 1, a: [{ d: 2, c: 'x' }] }), '{"a":[{"c":"x","d":2}],"b":1}')
  assert.equal(panelThemeContentHash({ a: 1, b: 2 }), panelThemeContentHash({ b: 2, a: 1 }))
  assert.notEqual(panelThemeContentHash([theme()]), panelThemeContentHash([theme({ id: 'aurora-2' })]))
  assert.match(panelThemeContentHash([theme()]), /^[0-9a-f]{64}$/)
})

test('hits reuse the validated result, misses validate once, and a changed theme with the same version revalidates', () => {
  const { cache, calls } = countingCache()
  const declared = [theme()]
  const first = cache.get(declared)
  const second = cache.get(declared)
  assert.equal(calls(), 1)
  assert.equal(second.themes, first.themes)
  assert.deepEqual(cache.stats, { hits: 1, misses: 1 })
  // 同樣內容的另一份物件（例如重新讀取 manifest）也命中。
  assert.equal(cache.get(structuredClone(declared)).themes, first.themes)
  assert.equal(calls(), 1)
  // 內容改變（開發者資料夾重新載入、版本號沒變）一定重新驗證。
  const edited = [theme({ modes: { light: { colors: { ...LIGHT_COLORS, accent: '#1b6d72' } }, dark: { colors: DARK_COLORS } } })]
  const changed = cache.get(edited)
  assert.equal(calls(), 2)
  assert.notEqual(changed.key, first.key)
  // 無效的宣告也會被快取（結果為 null），不會每次 sync 都重跑驗證。
  assert.equal(cache.get([{ id: 'BAD' }]).themes, null)
  assert.equal(cache.get([{ id: 'BAD' }]).themes, null)
  assert.equal(calls(), 3)
})

test('retain drops entries of removed or replaced plugins and the cache never exceeds its bound (LRU)', () => {
  const { cache, calls } = countingCache(2)
  const a = cache.get([theme({ id: 'a' })])
  const b = cache.get([theme({ id: 'b' })])
  cache.get([theme({ id: 'a' })])
  cache.get([theme({ id: 'c' })])
  assert.equal(cache.size, 2)
  assert.equal(cache.peek(b.key), undefined, 'least recently used entry is evicted')
  assert.notEqual(cache.peek(a.key), undefined)
  cache.retain(new Set([a.key]))
  assert.equal(cache.size, 1)
  assert.equal(calls(), 3)
  assert.equal(PANEL_THEME_CACHE_MAX_ENTRIES, 32)
  const bounded = new PanelThemeResolveCache({ resolve: () => null })
  for (let index = 0; index < 100; index += 1) bounded.get([{ index }])
  assert.equal(bounded.size, PANEL_THEME_CACHE_MAX_ENTRIES)
})

test('the runtime revalidates a same-version update, drops removed plugins and keeps validation off the hot path', () => {
  const userData = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-panel-theme-cache-')))
  try {
    const { cache, calls } = countingCache()
    const runtime = new PanelThemeRuntime({
      userDataDirectory: userData,
      pluginRoot: (pluginId, version) => path.join(userData, 'plugins', pluginId, version),
      readRegularFileWithin: async () => null,
      send: () => {},
      sendPetStatus: () => {},
      rendererOrigin: () => 'agent-pets://app',
      sendPluginTheme: () => {},
      schedulePluginTheme: callback => callback(),
      salt: new Uint8Array(32).fill(3),
      resolveCache: cache,
    })
    const parse = (accent: string) => {
      const parsed = parsePluginManifest(manifest([theme({ modes: { light: { colors: { ...LIGHT_COLORS, accent } }, dark: { colors: DARK_COLORS } } })]))
      if (!parsed.ok) throw new Error(parsed.error)
      return parsed.manifest
    }
    const sync = (pluginManifest: ReturnType<typeof parse> | null) => runtime.sync({
      registry: pluginManifest ? [{ id: 'theme-pack', currentVersion: '1.0.0', status: 'enabled' }] : [],
      contexts: new Map(pluginManifest ? [['theme-pack', { manifest: pluginManifest, enabled: true, pluginsEnabled: true }]] : []),
      pluginsEnabled: true,
    })
    const original = parse('#1f7a80')
    sync(original)
    sync(original)
    sync(original)
    assert.equal(calls(), 1, 'repeated syncs reuse the cached validation')
    sync(parse('#1b6d72'))
    assert.equal(calls(), 2)
    assert.equal(runtime.getState().themes[0]!.modes.light!.properties['--organic-accent'], 'rgb(27 109 114 / 1)')
    assert.equal(cache.size, 1, 'the replaced content is dropped')
    sync(null)
    assert.equal(cache.size, 0, 'a removed plugin leaves nothing behind')
    assert.equal(runtime.getState().themes.length, 0)
  } finally {
    fs.rmSync(userData, { recursive: true, force: true })
  }
})
