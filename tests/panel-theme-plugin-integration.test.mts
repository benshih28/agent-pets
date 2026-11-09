import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import test from 'node:test'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { parsePluginManifest } from '../electron/plugin-manifest.ts'
import { PluginRegistry } from '../electron/plugin-registry.ts'
import { isCatalogVersionAppCompatible, parsePluginCatalog, selectLatestCompatiblePluginVersion } from '../electron/plugin-catalog.ts'
import { buildPluginCatalogPanelItems } from '../electron/plugin-catalog-updates.ts'
import { parsePermissionUnit, permissionUnitsOfPlan } from '../src/utils/plugin-permissions.ts'
import { pluginCapabilities } from '../src/utils/plugin-capabilities.ts'
import { SETTINGS_ENTRIES, searchSettings } from '../src/utils/settingsRegistry.ts'
import { DARK_COLORS, LIGHT_COLORS, manifest, png, theme, webp, woff2 } from './support/panel-theme-fixtures.mts'

function withUserData(run: (directory: string, registry: PluginRegistry) => void | Promise<void>): Promise<void> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-panel-theme-registry-'))
  return Promise.resolve(run(directory, new PluginRegistry(directory))).finally(() => fs.rmSync(directory, { recursive: true, force: true }))
}

function archive(rawManifest: unknown, files: Record<string, Uint8Array> = {}): Uint8Array {
  return zipSync({ 'plugin.json': strToU8(JSON.stringify(rawManifest)), ...files }, { level: 0 })
}

const imageTheme = (extra: Record<string, unknown> = {}) => theme({
  fonts: [{ id: 'body', src: 'fonts/body.woff2' }],
  modes: {
    light: { colors: LIGHT_COLORS, background: { type: 'image', src: 'bg/light.webp', overlay: { color: '#eef6f6', opacity: 0.9 } } },
    dark: { colors: DARK_COLORS },
  },
  ...extra,
})

test('manifest: workerless panel themes, themes + skins, themes + worker; permissions or empty contributions reject', () => {
  assert.equal(parsePluginManifest(manifest([theme()])).ok, true)
  const skins = [{ id: 'fox', displayName: { 'zh-TW': '狐', 'en-US': 'Fox' }, spritesheet: 'skins/fox.webp', kind: 'animal' }]
  assert.equal(parsePluginManifest({ ...manifest([theme()]), contributes: { panelThemes: [theme()], skins } }).ok, true)
  assert.equal(parsePluginManifest({ ...manifest([theme()]), entry: 'dist/main.js', contributes: { panelThemes: [theme()], feed: true }, permissions: { storage: true } }).ok, true)
  assert.deepEqual(parsePluginManifest({ ...manifest([theme()]), permissions: { storage: true } }), { ok: false, error: 'invalid_contributions' })
  assert.deepEqual(parsePluginManifest({ ...manifest([theme()]), contributes: { panelThemes: [theme()], feed: true } }), { ok: false, error: 'invalid_contributions' })
  assert.deepEqual(parsePluginManifest({ ...manifest([theme()]), contributes: {} }), { ok: false, error: 'invalid_contributions' })
  const bad = parsePluginManifest(manifest([theme({ modes: { light: { colors: { ...LIGHT_COLORS, text: 'red;}body{' } } } })]))
  assert.equal(bad.ok, false)
  if (!bad.ok) {
    assert.equal(bad.error, 'invalid_panel_theme')
    assert.equal(bad.diagnostic, 'aurora.light.colors.text: not an allowed colour')
  }
  assert.deepEqual(parsePluginManifest({ ...manifest([theme()]), contributes: { panelThemes: [theme()], panelThemez: [] } }), { ok: false, error: 'invalid_contributions' })
})

test('registry: .woff2 allowed, fonts must be referenced and magic-checked, images header-checked', async () => {
  await withUserData((_directory, registry) => {
    const good = { 'fonts/body.woff2': woff2(), 'bg/light.webp': webp(512, 256) }
    const planned = registry.planInstall(archive(manifest([imageTheme()]), good))
    assert.equal(planned.ok, true)
    if (planned.ok) assert.deepEqual(planned.value.addedPermissions, ['contributes:panelThemeFonts', 'contributes:panelThemes:1'])
    const fail = (files: Record<string, Uint8Array>, rawManifest: unknown = manifest([imageTheme()])) => registry.planInstall(archive(rawManifest, files))
    assert.deepEqual(fail({ ...good, 'fonts/extra.woff2': woff2() }), { ok: false, error: 'invalid_panel_theme' })
    assert.deepEqual(fail({ ...good, 'fonts/body.woff2': strToU8('OTTO....') }), { ok: false, error: 'invalid_panel_theme' })
    assert.deepEqual(fail({ 'bg/light.webp': webp(512, 256) }), { ok: false, error: 'invalid_panel_theme' })
    assert.deepEqual(fail({ ...good, 'bg/light.webp': webp(512, 512, { animated: true }) }), { ok: false, error: 'invalid_panel_theme' })
    assert.deepEqual(fail({ ...good, 'bg/light.webp': webp(5000, 64) }), { ok: false, error: 'invalid_panel_theme' })
    assert.deepEqual(fail({ ...good, 'bg/light.webp': png(512, 512, { exifOrientation: 6 }) }), { ok: false, error: 'invalid_panel_theme' })
    assert.deepEqual(fail({ ...good, 'fonts/body.woff2': woff2(1024 * 1024 + 1) }), { ok: false, error: 'archive_too_large' })
    assert.deepEqual(fail({ ...good, 'a.ttf': new Uint8Array(8) }), { ok: false, error: 'invalid_archive' })
    assert.deepEqual(fail({ ...good, 'a.jpg': new Uint8Array(8) }), { ok: false, error: 'invalid_archive' })
    // 一般的 Worker 插件不能夾帶字型。
    const plain = { ...manifest([theme()]), entry: 'dist/main.js', contributes: { feed: true } }
    assert.deepEqual(registry.planInstall(archive(plain, { 'dist/main.js': strToU8('1'), 'x.woff2': woff2() })), { ok: false, error: 'invalid_panel_theme' })
    // 非開發者模式下絕不回傳診斷訊息。
    const invalid = registry.planInstall(archive(manifest([theme({ shape: { radiusSm: 40 } })])))
    assert.deepEqual(invalid, { ok: false, error: 'invalid_panel_theme' })
  })
})

test('registry: asset packages get the 25 MiB total limit, others stay at 5 MiB', async () => {
  await withUserData((_directory, registry) => {
    const big = new Uint8Array(6 * 1024 * 1024)
    big.set(webp(512, 256))
    const files = { 'fonts/body.woff2': woff2(), 'bg/light.webp': big }
    const result = registry.planInstall(archive(manifest([imageTheme()]), files))
    assert.equal(result.ok, true)
    const worker = { ...manifest([theme()]), entry: 'dist/main.js', contributes: { feed: true } }
    assert.deepEqual(registry.planInstall(archive(worker, { 'dist/main.js': new Uint8Array(6 * 1024 * 1024) })), { ok: false, error: 'archive_too_large' })
  })
})

test('developer folder installs return a sanitised diagnostic for invalid themes', async () => {
  await withUserData(async directory => {
    const source = path.join(directory, 'source')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'plugin.json'), JSON.stringify(manifest([theme({ modes: { light: { colors: { ...LIGHT_COLORS, textMuted: '#9aa9ab' } } } })])))
    const result = await new PluginRegistry(directory).planInstallDirectory(source)
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.error, 'invalid_panel_theme')
      assert.match(result.diagnostic ?? '', /^aurora\.light\.colors\.textMuted: \d\.\d\d:1 < 4\.5:1 on (surface|surface2|bg)$/)
    }
  })
})

test('consent units: count-based panelThemes plus a medium-risk fonts line; adding themes or fonts needs re-consent', async () => {
  const plan = { contributes: parsePluginManifest(manifest([imageTheme(), theme({ id: 'two' })])) }
  assert.equal(plan.contributes.ok, true)
  if (!plan.contributes.ok) return
  const units = permissionUnitsOfPlan({ permissions: {}, contributes: plan.contributes.manifest.contributes })
  assert.deepEqual(units, ['contributes:panelThemes:2', 'contributes:panelThemeFonts'])
  assert.deepEqual(parsePermissionUnit('contributes:panelThemes:2'), { unit: 'contributes:panelThemes:2', kind: 'contributes', detail: 'panelThemes:2', group: 'display', risk: 'low', known: true })
  assert.equal(parsePermissionUnit('contributes:panelThemeFonts').risk, 'medium')
  assert.equal(parsePermissionUnit('contributes:panelThemes:x').known, false)
  assert.deepEqual(pluginCapabilities(plan.contributes.manifest), ['panelThemes'])

  await withUserData((_directory, registry) => {
    const first = registry.planInstall(archive(manifest([theme()])))
    assert.ok(first.ok)
    if (!first.ok) return
    assert.equal(registry.install(first.value.token).ok, true)
    const more = registry.planInstall(archive({ ...manifest([theme(), theme({ id: 'two' })]), version: '1.1.0' }))
    assert.ok(more.ok)
    if (more.ok) {
      assert.equal(more.value.requiresReconsent, true)
      assert.deepEqual(more.value.addedPermissions, ['contributes:panelThemes:2'])
    }
    const fonts = registry.planInstall(archive({ ...manifest([imageTheme()]), version: '1.2.0' }, { 'fonts/body.woff2': woff2(), 'bg/light.webp': webp(512, 256) }))
    assert.ok(fonts.ok)
    if (fonts.ok) assert.ok(fonts.value.addedPermissions.includes('contributes:panelThemeFonts'))
  })
})

test('catalog: minAppVersion parses, filters by the running app, and yields a "requires" item', () => {
  const version = (value: string, extra: Record<string, unknown> = {}) => ({
    version: value, apiVersion: '1', url: `https://raw.githubusercontent.com/x/y/main/p-${value}.agentpet-plugin`,
    sha256: 'a'.repeat(64), size: 10, publishedAt: '2026-11-08T00:00:00.000Z', ...extra,
  })
  const document = parsePluginCatalog({
    schemaVersion: 1,
    plugins: [
      { id: 'theme-pack', name: { 'zh-TW': '主題', 'en-US': 'Themes' }, description: { 'zh-TW': '說明', 'en-US': 'About' }, author: 'A', versions: [version('1.0.0', { minAppVersion: '1.12.0' })] },
      { id: 'mixed-pack', name: { 'zh-TW': '混合', 'en-US': 'Mixed' }, description: { 'zh-TW': '說明', 'en-US': 'About' }, author: 'A', versions: [version('1.0.0'), version('2.0.0', { minAppVersion: '1.12.0' })] },
      { id: 'bad-pack', name: { 'zh-TW': '壞', 'en-US': 'Bad' }, description: { 'zh-TW': '說明', 'en-US': 'About' }, author: 'A', versions: [version('1.0.0', { minAppVersion: 'v1.12' })] },
    ],
  })
  assert.ok(document.ok)
  if (!document.ok) return
  assert.deepEqual(document.value.plugins.map(plugin => plugin.id), ['theme-pack', 'mixed-pack'])
  const [themePack, mixed] = document.value.plugins
  assert.equal(selectLatestCompatiblePluginVersion(themePack!, '1', '1.11.4'), null)
  assert.equal(selectLatestCompatiblePluginVersion(themePack!, '1', '1.12.0')?.version, '1.0.0')
  assert.equal(selectLatestCompatiblePluginVersion(mixed!, '1', '1.11.4')?.version, '1.0.0')
  assert.equal(selectLatestCompatiblePluginVersion(mixed!, '1', '1.12.1')?.version, '2.0.0')
  assert.equal(isCatalogVersionAppCompatible({ minAppVersion: '1.12.0' }, '1.12.0'), true)
  assert.equal(isCatalogVersionAppCompatible({}, '0.0.1'), true)
  const items = buildPluginCatalogPanelItems(document.value, [], '1.11.4')
  assert.equal(items.find(item => item.plugin.id === 'theme-pack')?.requiresAppVersion, '1.12.0')
  assert.equal(items.find(item => item.plugin.id === 'theme-pack')?.updateAvailable, false)
  assert.equal(items.find(item => item.plugin.id === 'mixed-pack')?.requiresAppVersion, undefined)
  assert.equal(buildPluginCatalogPanelItems(document.value, [], '1.12.0').every(item => !item.requiresAppVersion), true)
})

test('settings search finds the panel theme entry in both languages', () => {
  const entry = SETTINGS_ENTRIES.find(item => item.id === 'panelThemeStyle')
  assert.ok(entry)
  assert.equal(entry.section, 'appearance')
  const identity = (key: string) => key
  for (const query of ['wallpaper', '桌布', '字型', 'font', 'background', '背景']) {
    assert.ok(searchSettings(query, identity as never).some(hit => hit.entry.id === 'panelThemeStyle'), query)
  }
})

test('every new locale key exists in both languages', () => {
  for (const domain of ['design', 'plugins']) {
    const zh = JSON.parse(fs.readFileSync(`src/locales/${domain}/zh-TW.json`, 'utf8')) as Record<string, string>
    const en = JSON.parse(fs.readFileSync(`src/locales/${domain}/en-US.json`, 'utf8')) as Record<string, string>
    const keys = (catalog: Record<string, string>) => Object.keys(catalog).filter(key => key.includes('anelTheme')).sort()
    assert.deepEqual(keys(zh), keys(en), domain)
    assert.ok(keys(zh).length > 0)
  }
  for (const key of ['pluginPermissionPanelThemes', 'pluginPermissionPanelThemeFonts']) {
    for (const file of ['src/locales/zh-TW.json', 'src/locales/en-US.json']) {
      assert.ok((JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>)[key], `${key} in ${file}`)
    }
  }
})

test('the workerless fixture validates and packs without dist/main.js', () => {
  const fixture = JSON.parse(fs.readFileSync('tests/fixtures/plugins/ok-panel-theme/plugin.json', 'utf8')) as unknown
  const parsed = parsePluginManifest(fixture)
  assert.equal(parsed.ok, true)
  const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-pack-')), 'theme.agentpet-plugin')
  try {
    execFileSync(process.execPath, ['scripts/pack-test-plugin.mjs', 'ok-panel-theme', output])
    const files = Object.keys(unzipSync(fs.readFileSync(output))).sort()
    assert.deepEqual(files, ['backgrounds/aurora-light.webp', 'fonts/fixture-stub.woff2', 'plugin.json'])
    return withUserData((_directory, registry) => {
      assert.equal(registry.planInstall(fs.readFileSync(output)).ok, true)
    })
  } finally {
    fs.rmSync(path.dirname(output), { recursive: true, force: true })
  }
})
