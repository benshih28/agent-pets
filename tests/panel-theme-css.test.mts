import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  activePanelTheme,
  activePanelThemeModes,
  buildPanelThemeGradient,
  diffPanelThemeProperties,
  isPanelThemePropertyValue,
  panelThemeSettingsTarget,
  panelThemeTargetProperties,
} from '../src/utils/panel-theme-css.ts'
import { buildPanelThemeState, PANEL_THEME_COLOR_TOKENS, resolvePanelThemes } from '../electron/plugin-panel-themes.ts'
import { PANEL_THEME_COLOR_PROPERTIES, PANEL_THEME_CSS_PROPERTIES, type PanelThemeState } from '../src/types/panel-theme.ts'
import { DARK_COLORS, LIGHT_COLORS, theme } from './support/panel-theme-fixtures.mts'

function state(slots: PanelThemeState['slots'] = { light: { ref: { pluginId: 'theme-pack', themeId: 'aurora' }, status: 'active' }, dark: { ref: null, status: 'builtin' } }): PanelThemeState {
  const themes = resolvePanelThemes([theme({
    modes: {
      light: { colors: LIGHT_COLORS, background: { type: 'gradient', kind: 'radial', position: 'top-left', stops: [{ color: '#eef6f6', at: 0 }, { color: '#f8fcfc', at: 100 }] } },
      dark: { colors: DARK_COLORS },
    },
  })])!
  const built = buildPanelThemeState(
    [{ pluginId: 'theme-pack', version: '1.0.0', pluginName: { 'zh-TW': '主題包', 'en-US': 'Theme Pack' }, available: true, themes }],
    { version: 1, slots: { light: slots.light.ref, dark: slots.dark.ref }, userImages: {} },
    { packagedUrl: () => `agent-pets://panel-theme/${'a'.repeat(32)}`, fontAlias: () => 'apt-0123456789abcdef', userImageUrl: () => null },
  )
  return { ...built, slots }
}

test('the allowlist matches the main token table and has no duplicates', () => {
  assert.deepEqual(PANEL_THEME_COLOR_TOKENS.map(token => token.property), [...PANEL_THEME_COLOR_PROPERTIES])
  assert.equal(new Set(PANEL_THEME_CSS_PROPERTIES).size, PANEL_THEME_CSS_PROPERTIES.length)
  assert.equal(PANEL_THEME_CSS_PROPERTIES.length, 31 + 2 + 9 + 3 + 1)
})

test('target properties: shared + mode colours + gradient, suspended under forced colours', () => {
  const current = state()
  const entry = activePanelTheme(current, 'light')
  const plan = panelThemeTargetProperties(entry, 'light', { forcedColors: false, highContrast: false })
  assert.deepEqual(plan.rejected, [])
  assert.equal(plan.properties.size, 31 + 14 + 1)
  assert.equal(plan.properties.get('--panel-theme-background'), 'radial-gradient(ellipse at left top, rgb(238 246 246 / 1) 0%, rgb(248 252 252 / 1) 100%)')
  assert.equal(panelThemeTargetProperties(entry, 'light', { forcedColors: true, highContrast: false }).properties.size, 0)
  assert.equal(activePanelTheme(current, 'dark'), null)
  const contrast = panelThemeTargetProperties(entry, 'light', { forcedColors: false, highContrast: true }).properties
  assert.equal(contrast.get('--organic-border'), 'rgb(16 40 44 / 0.6)')
  assert.equal(contrast.get('--organic-border-soft'), 'rgb(16 40 44 / 0.4)')
  assert.equal(activePanelTheme({ ...current, slots: { ...current.slots, light: { ...current.slots.light, status: 'unavailable', reason: 'plugin_disabled' } } }, 'light'), null)
})

test('non-allowlisted names and malformed values are dropped and reported', () => {
  const entry = activePanelTheme(state(), 'light')!
  const tampered = {
    ...entry,
    shared: { ...entry.shared, properties: { ...entry.shared.properties, '--organic-font-body': 'x;}body{color:red', '--organic-radius-sm': '8px;', color: 'red' } as never },
    modes: { light: { ...entry.modes.light!, properties: { ...entry.modes.light!.properties, '--organic-text': 'url(https://example.com)', '--organic-bg': 'var(--x)' } } },
  }
  const plan = panelThemeTargetProperties(tampered, 'light', { forcedColors: false, highContrast: false })
  assert.deepEqual(plan.rejected.sort(), ['--organic-bg', '--organic-font-body', '--organic-radius-sm', '--organic-text', 'color'])
  for (const name of plan.properties.keys()) assert.ok(PANEL_THEME_CSS_PROPERTIES.includes(name))
  for (const [name, value] of [
    ['--organic-font-heading', '"apt-0123456789abcdef", sans-serif'],
    ['--organic-font-body', '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'],
    ['--organic-font-label', '14px'],
    ['--organic-text', 'rgb(0 0 0 / 1)'],
  ] as const) assert.equal(isPanelThemePropertyValue(name, value), true, value)
  for (const [name, value] of [
    ['--organic-font-heading', '"a"; color: red'], ['--organic-font-heading', "'Arial', serif"], ['--organic-font-label', '14em'],
    ['--organic-font-label', '100px'], ['--organic-text', 'red'], ['--panel-theme-background', 'url(x)'],
    ['--panel-theme-background', 'linear-gradient(90deg, red 0%, blue 100%)'], ['--organic-space-1', '4px'], ['--z-system', '1'],
  ] as const) assert.equal(isPanelThemePropertyValue(name, value), false, `${name}: ${value}`)
})

test('gradient builder only emits host-shaped strings', () => {
  assert.equal(buildPanelThemeGradient({ type: 'gradient', kind: 'linear', angle: 160, stops: [{ color: 'rgb(1 2 3 / 1)', at: 0 }, { color: 'rgb(4 5 6 / 1)', at: 100 }] }),
    'linear-gradient(160deg, rgb(1 2 3 / 1) 0%, rgb(4 5 6 / 1) 100%)')
  assert.equal(buildPanelThemeGradient({ type: 'gradient', kind: 'linear', angle: 400, stops: [{ color: 'rgb(1 2 3 / 1)', at: 0 }, { color: 'rgb(4 5 6 / 1)', at: 100 }] }), null)
  assert.equal(buildPanelThemeGradient({ type: 'gradient', kind: 'linear', angle: 1, stops: [{ color: 'red', at: 0 }, { color: 'rgb(4 5 6 / 1)', at: 100 }] }), null)
  assert.equal(buildPanelThemeGradient({ type: 'solid' }), null)
})

test('diff writes only changed values and removes stale names', () => {
  const current = new Map([['--organic-bg', 'a'], ['--organic-text', 'b'], ['--organic-accent', 'c']])
  const next = new Map([['--organic-bg', 'a'], ['--organic-text', 'B'], ['--organic-font-label', '12px']])
  assert.deepEqual(diffPanelThemeProperties(current, next), { remove: ['--organic-accent'], set: [['--organic-text', 'B'], ['--organic-font-label', '12px']] })
})

test('one active theme per mode and settings navigation targets the owning plugin', () => {
  const ref = { pluginId: 'theme-pack', themeId: 'aurora' }
  const current = state({ light: { ref, status: 'active' }, dark: { ref, status: 'active' } })
  assert.deepEqual(activePanelThemeModes(current, ref), ['light', 'dark'])
  assert.deepEqual(activePanelThemeModes(current, { pluginId: 'theme-pack', themeId: 'other' }), [])
  assert.equal(panelThemeSettingsTarget(current), 'theme-pack')
  assert.equal(panelThemeSettingsTarget(state({ light: { ref: null, status: 'builtin' }, dark: { ref: null, status: 'builtin' } })), 'theme-pack')
  assert.equal(panelThemeSettingsTarget({ ...current, themes: [] }), null)
  assert.equal(panelThemeSettingsTarget(null), null)
  // 我的主題不是插件：使用中也不會被當成「開啟插件設定」的目的地。
  const mine = { ...current.themes[0]!, ref: { pluginId: '_user', themeId: 'u-0123456789ab' } }
  const userSlots = { light: { ref: mine.ref, status: 'active' as const }, dark: { ref: null, status: 'builtin' as const } }
  assert.equal(panelThemeSettingsTarget({ ...current, slots: userSlots, themes: [mine, ...current.themes] }), 'theme-pack')
  assert.equal(panelThemeSettingsTarget({ ...current, slots: userSlots, themes: [mine] }), null)
})

test('the renderer applies themes with setProperty in one frame, never cssText or <style>', () => {
  const composable = readFileSync('src/composables/usePanelTheme.ts', 'utf8')
  assert.match(composable, /requestAnimationFrame/)
  assert.match(composable, /style\.setProperty\(name, value\)/)
  for (const file of ['src/composables/usePanelTheme.ts', 'src/components/PanelThemeBackdrop.vue', 'src/components/panel-theme/PanelThemePreview.vue', 'src/utils/panel-theme-css.ts']) {
    const source = readFileSync(file, 'utf8')
    assert.doesNotMatch(source, /cssText|innerHTML|v-html|createElement\('style'\)|insertRule/, file)
  }
})

test('no protected regions: every surface reads the semantic layer derived from the palette', () => {
  for (const file of [
    'src/components/ui/InlinePermissionCard.vue', 'src/components/permission/PermissionOutcomeNotice.vue',
    'src/components/plugin-panel/PluginInstallSheet.vue', 'src/components/plugin-panel/PluginPanelFrame.vue',
    'src/components/ui/ConfirmDialog.vue', 'src/components/status-panel/ServerHealthBanner.vue',
    'src/components/status-panel/SettingsPanelTheme.vue', 'src/components/plugin-panel/PluginPanelThemes.vue',
  ]) assert.doesNotMatch(readFileSync(file, 'utf8'), /host-protected/, file)
  const tokens = readFileSync('src/styles/tokens.css', 'utf8')
  assert.doesNotMatch(tokens, /host-protected/)
  for (const property of PANEL_THEME_CSS_PROPERTIES.filter(name => name !== '--panel-theme-background')) {
    // 插件頁面上先讀對應的 --ap-*（App 視窗沒有 --ap-*，一律退回內建值）。
    assert.match(tokens, new RegExp(`^  ${property}: (?:var\\(--ap-[a-z0-9-]+, )?var\\(--builtin${property.slice(1)}\\)\\)?;`, 'm'), `${property} aliases the frozen copy`)
  }
  // 語意層在 :root 衍生，並在預覽上重新解析（預覽帶入另一組色盤）。
  assert.match(tokens, /^:root,\n\.panel-theme-preview \{\n  --color-bg: var\(--organic-bg\);/m)
  assert.doesNotMatch(readFileSync('src/components/StatusPanel.css', 'utf8'), /--surface-panel:/)
  // 面板主題套在面板視窗的 <html>；寵物視窗不使用這個 composable。
  assert.match(readFileSync('src/composables/usePanelTheme.ts', 'utf8'), /const element = document\.documentElement/)
  assert.doesNotMatch(readFileSync('src/components/DesktopPet.vue', 'utf8'), /usePanelTheme/)
})

test('the permission card keeps its text on the overlay surface, never on the accent fill', () => {
  const card = readFileSync('src/components/ui/InlinePermissionCard.vue', 'utf8')
  const rule = card.slice(card.indexOf('.inline-permission-card {'), card.indexOf('}', card.indexOf('.inline-permission-card {')))
  assert.match(rule, /background: var\(--surface-overlay\);/)
  assert.match(rule, /color: var\(--text-primary\);/)
  assert.doesNotMatch(card, /opacity: 0\.\d/)
})

test('previews resolve shadow and sheen strengths from the previewed mode, and the strengths match the 1.11.5 look', () => {
  const css = readFileSync('src/styles/tokens.css', 'utf8')
  const block = (selector: string) => {
    const start = css.indexOf(`${selector} {`)
    assert.ok(start >= 0, selector)
    return css.slice(start, css.indexOf('\n}', start))
  }
  const strengths = (source: string) => Object.fromEntries([...source.matchAll(/^ {2}(--(?:elevation|pet)-[a-z-]+): (\d+%);$/gm)].map(match => [match[1], match[2]]))
  const light = strengths(block(":root,\n.panel-theme-preview[data-mode='light']"))
  const dark = strengths(block(":root[data-theme='dark'],\n.panel-theme-preview[data-mode='dark']"))
  assert.deepEqual(Object.keys(light).sort(), Object.keys(dark).sort())
  assert.equal(Object.keys(light).length, 14)
  // 1.11.5：深色泡泡高光 10%、膠囊陰影 25%；淺色泡泡高光 70%、膠囊陰影 16%。
  assert.deepEqual([light['--pet-sheen-strength'], dark['--pet-sheen-strength']], ['70%', '10%'])
  assert.deepEqual([light['--pet-status-shadow-strength'], dark['--pet-status-shadow-strength']], ['16%', '25%'])
  assert.match(block(":root[data-theme='dark'],\n.panel-theme-preview[data-mode='dark']"), /--text-shadow-panel: 0 1px 2px color-mix\(in srgb, var\(--color-shadow\) 55%, transparent\);/)
  // 組合 token 宣告在預覽元素上（否則會繼承面板模式已代換好的值）。
  const semantic = block(':root,\n.panel-theme-preview')
  for (const name of ['--organic-card-shadow', '--organic-panel-shadow', '--shadow-raised']) assert.match(semantic, new RegExp(`^ {2}${name}:`, 'm'), name)
  assert.doesNotMatch(block(':root'), /--organic-card-shadow:/)
  assert.match(readFileSync('src/components/panel-theme/PanelThemePreview.vue', 'utf8'), /class="panel-theme-preview"[^>]*:data-mode="mode"/)
})
