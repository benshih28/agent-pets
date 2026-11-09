import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  buildPanelThemeState,
  builtinPanelThemeProperties,
  checkPanelThemePackagedImage,
  checkPanelThemeUserImage,
  deriveAccentHover,
  derivePanelThemeColors,
  minimumPanelThemeOverlay,
  PANEL_THEME_COLOR_TOKENS,
  panelThemeSharedProperties,
  parsePanelThemes,
  PanelThemeValidationError,
  resolvePanelThemes,
  type PanelThemeSourcePlugin,
  PANEL_THEME_DEPRECATED_COLOR_KEYS,
  PANEL_THEME_STATE_TINT_ALPHA,
  PANEL_THEME_PRESSED_MIX,
  PET_OVERLAY_SURFACE_ALPHA,
  builtinPanelThemeColors,
  panelThemeInvariantFailure,
  panelThemeInvariantFailures,
} from '../electron/plugin-panel-themes.ts'
import { contrastRatio, parsePanelThemeColor, type PanelThemeRgba } from '../electron/panel-theme-color.ts'
import { PANEL_THEME_COLOR_PROPERTIES } from '../src/types/panel-theme.ts'
import { DARK_COLORS, LIGHT_COLORS, jpeg, lightTheme, png, theme, webp } from './support/panel-theme-fixtures.mts'

function rejects(value: unknown, pattern?: RegExp): string {
  try {
    parsePanelThemes(value)
  } catch (error) {
    assert.ok(error instanceof PanelThemeValidationError, 'throws a validation error')
    assert.ok(error.diagnostic.length <= 200)
    if (pattern) assert.match(error.diagnostic, pattern)
    return error.diagnostic
  }
  assert.fail(`expected rejection: ${JSON.stringify(value).slice(0, 200)}`)
}

function color(value: string): PanelThemeRgba {
  const parsed = parsePanelThemeColor(value)
  if (!parsed.ok) throw new Error(value)
  return parsed.color
}

const builtin = (mode: 'light' | 'dark') => Object.fromEntries(PANEL_THEME_COLOR_TOKENS.map(token => [token.key, mode === 'light' ? token.light : token.dark]))

test('the complete built-in light and dark palettes pass the validator', () => {
  const { themes } = parsePanelThemes([theme({ modes: { light: { colors: builtin('light') }, dark: { colors: builtin('dark') } } })])
  assert.ok(themes[0]!.modes.light && themes[0]!.modes.dark)
})

test('the spec §2.1 example is accepted and its user image minimum is reported', () => {
  const spec = readFileSync('docs/design/Plugin-Panel-Theme-Spec.md', 'utf8')
  const start = spec.indexOf('```json') + 7
  const example = JSON.parse(spec.slice(start, spec.indexOf('```', start))) as { contributes: { panelThemes: unknown } }
  const [resolved] = parsePanelThemes(example.contributes.panelThemes).themes
  assert.equal(resolved!.modes.light!.userImage!.defaultDim, 0.9)
  assert.ok(resolved!.modes.light!.userImage!.minDim <= 0.9)
})

test('derived tokens follow the documented formulas', () => {
  const declared = Object.fromEntries(Object.entries(LIGHT_COLORS).map(([key, value]) => [key, color(value)]))
  const colors = derivePanelThemeColors(declared, 'light')
  const mix = (a: PanelThemeRgba, b: PanelThemeRgba, t: number) => ({
    r: Math.round(a.r * (1 - t) + b.r * t), g: Math.round(a.g * (1 - t) + b.g * t), b: Math.round(a.b * (1 - t) + b.b * t), a: a.a,
  })
  assert.deepEqual(colors.surfaceWarm, mix(colors.surface, colors.accent, 0.18))
  assert.deepEqual(colors.surfaceSage, mix(colors.surface, colors.sage, 0.18))
  assert.deepEqual(colors.surfaceSageSoft, mix(colors.surface, colors.sage, 0.08))
  assert.deepEqual(colors.surfaceOff, mix(colors.surface2, colors.text, 0.12))
  assert.deepEqual(colors.textFaint, colors.textMuted)
  assert.equal(colors.accentGlow.a, 0.22)
  assert.equal(colors.accentTrack.a, 0.08)
  assert.equal(colors.accentOnHover.a, 0.05)
  assert.equal(colors.sageTrack.a, 0.16)
  assert.equal(colors.borderSoft.a, Math.round(0.18 * 0.625 * 1000) / 1000)
  assert.equal('borderOnAccent' in colors, false)
  // "B" token 會退回該模式的內建值。
  assert.deepEqual(colors.dangerText, color('#a62f1e'))
  assert.deepEqual(derivePanelThemeColors(declared, 'dark').dangerText, color('#ff9a8a'))
})

test('accentHover picks the first mix step that keeps onAccent readable, deterministically', () => {
  const accent = color('#c67139')
  const text = color('#201e1d')
  const onAccent = color('#fff2eb')
  const hover = deriveAccentHover(accent, text, onAccent)
  assert.ok(contrastRatio(onAccent, hover) >= 4.5)
  // 只有必填的內建淺色顏色時，固定 0.2 的混色會失敗（4.43:1）；推導則會通過。
  const required = Object.fromEntries(PANEL_THEME_COLOR_TOKENS.filter(token => token.kind === 'required').map(token => [token.key, token.light]))
  assert.doesNotThrow(() => parsePanelThemes([theme({ modes: { light: { colors: required } } })]))
  assert.deepEqual(deriveAccentHover(accent, text, onAccent), hover)
})

test('each contrast pair fails on its own with an actionable diagnostic', () => {
  const failing: Array<[string, string, RegExp]> = [
    ['textMuted', '#9aa9ab', /light\.colors\.textMuted: \d+\.\d\d:1 < 4\.5:1 on surface/],
    ['textSecondary', '#a0b0b2', /colors\.textSecondary/],
    ['accentText', '#5fb0b5', /colors\.accentText/],
    ['dangerText', '#ff8a80', /colors\.dangerText/],
    ['warnText', '#f0c866', /colors\.warnText/],
    ['successText', '#b6d48a', /colors\.successText/],
    ['textFaint', '#e0eaea', /colors\.textFaint: .* < 3:1 on surface/],
    ['accent', '#bfe3e5', /colors\.accent/],
    ['onAccent', '#2a8086', /colors\.onAccent/],
  ]
  for (const [key, value, pattern] of failing) {
    rejects([lightTheme({ colors: { ...LIGHT_COLORS, [key]: value } })], pattern)
  }
  rejects([lightTheme({ colors: { ...LIGHT_COLORS, surfaceWarm: '#3d585c' } })], /colors\.(accentText|text)/)
  rejects([lightTheme({ colors: { ...LIGHT_COLORS, surfaceSage: '#10282c' } })], /colors\.text: .* on surfaceSage/)
})

test('mode direction: light needs a light bg and darker text, dark the opposite', () => {
  rejects([theme({ modes: { light: { colors: DARK_COLORS } } })], /light\.colors\.bg: light mode needs/)
  rejects([theme({ modes: { dark: { colors: LIGHT_COLORS } } })], /dark\.colors\.bg: dark mode needs/)
  // 中灰色 bg 與黑色文字的對比通過，但對淺色模式而言太暗（L < 0.45）。
  rejects([lightTheme({ colors: { ...LIGHT_COLORS, bg: '#9a9a9a', surface: '#ffffff', surface2: '#f4f4f4', text: '#000000', textSecondary: '#111111', textMuted: '#151515', accentText: '#0a2a2c', accent: '#0d3436' } })], /luminance >= 0\.45/)
})

test('gradient backdrops sample stops and midpoints, and stops must be opaque and ordered', () => {
  const gradient = (stops: unknown) => lightTheme({ background: { type: 'gradient', kind: 'linear', angle: 90, stops } })
  assert.doesNotThrow(() => parsePanelThemes([gradient([{ color: '#eef6f6', at: 0 }, { color: '#f8fcfc', at: 100 }])]))
  rejects([gradient([{ color: '#eef6f6', at: 0 }, { color: '#2f4a4f', at: 100 }])], /gradient/)
  rejects([gradient([{ color: '#eef6f680', at: 0 }, { color: '#f8fcfc', at: 100 }])], /stops\[0\]\.color: must be opaque/)
  rejects([gradient([{ color: '#eef6f6', at: 60 }, { color: '#f8fcfc', at: 40 }])], /must not decrease/)
  rejects([gradient([{ color: '#eef6f6', at: 0 }])], /needs 2-5 stops/)
  rejects([gradient(Array.from({ length: 6 }, (_, index) => ({ color: '#eef6f6', at: index * 10 })))], /needs 2-5 stops/)
  rejects([lightTheme({ background: { type: 'gradient', kind: 'conic', stops: [] } })], /kind/)
  rejects([lightTheme({ background: { type: 'gradient', kind: 'radial', position: 'middle', stops: [{ color: '#eef6f6', at: 0 }, { color: '#f8fcfc', at: 100 }] } })], /position/)
})

test('image overlays: minimum computed per mode, 0.50 floor, declared below minimum rejected with the minimum', () => {
  const image = (opacity: number, extra: Record<string, unknown> = {}) => lightTheme({
    background: { type: 'image', src: 'bg/a.webp', overlay: { color: '#eef6f6', opacity }, ...extra },
  })
  assert.doesNotThrow(() => parsePanelThemes([image(0.9)]))
  const diagnostic = rejects([image(0.6)], /overlay\.opacity: 0\.6 < minimum 0\.\d\d; text/)
  assert.match(diagnostic, /image pixel/)
  rejects([image(0.4)], /must be a number 0\.5-0\.95/)
  rejects([image(0.96)], /must be a number 0\.5-0\.95/)
  rejects([image(0.9, { opacity: 0.1 })], /opacity: must be a number 0\.2-1/)
  rejects([image(0.9, { blur: 25 })], /blur: must be an integer 0-24/)
  rejects([image(0.9, { blur: 2.5 })], /blur/)
  // 重用內建的淺色文字顏色：textMuted 在 bg 上為 4.96:1，因此任何覆蓋層疊在黑色上都無法通過。
  const builtinLight = theme({ modes: { light: { colors: builtin('light'), background: { type: 'image', src: 'a.png', overlay: { color: '#f5ead8', opacity: 0.95 } } } } })
  rejects([builtinLight], /no overlay up to 0\.95 passes \(textMuted [\d.]+:1 < 4\.5:1 on black image pixel at 0\.95\)/)
  // 即使對比允許更低，0.50 的下限仍然成立。
  const colors = derivePanelThemeColors(Object.fromEntries(Object.entries(LIGHT_COLORS).map(([key, value]) => [key, color(value)])), 'light')
  const minimum = minimumPanelThemeOverlay(colors, colors.bg, 0.2)
  assert.ok(minimum !== null && minimum >= 0.5)
  rejects([lightTheme({ background: { type: 'image', src: 'a.webp', overlay: { color: '#eef6f6cc', opacity: 0.9 } } })], /overlay\.color: must be opaque/)
})

test('user images: allowed must be true, overlay at or above the minimum, per mode', () => {
  const user = (userImage: unknown) => lightTheme({ userImage })
  const [resolved] = parsePanelThemes([user({ allowed: true, overlay: { color: '#eef6f6', opacity: 0.9 } })]).themes
  assert.equal(resolved!.modes.light!.userImage!.fit, 'cover')
  assert.ok(resolved!.modes.light!.userImage!.minDim >= 0.5)
  rejects([user({ allowed: false, overlay: { color: '#eef6f6', opacity: 0.9 } })], /allowed: must be true/)
  rejects([user({ allowed: true, overlay: { color: '#eef6f6', opacity: 0.55 } })], /userImage\.overlay\.opacity: 0\.55 < minimum/)
  rejects([user({ allowed: true, fit: 'stretch', overlay: { color: '#eef6f6', opacity: 0.9 } })], /fit/)
  rejects([user({ allowed: true, overlay: { color: '#eef6f6', opacity: 0.9 }, extra: 1 })], /unknown key/)
})

test('single-mode themes resolve only that mode', () => {
  const [light] = parsePanelThemes([lightTheme({})]).themes
  assert.deepEqual(Object.keys(light!.modes), ['light'])
  const [dark] = parsePanelThemes([theme({ modes: { dark: { colors: DARK_COLORS } } })]).themes
  assert.deepEqual(Object.keys(dark!.modes), ['dark'])
  rejects([theme({ modes: {} })], /needs light and\/or dark/)
  rejects([theme({ modes: { sepia: { colors: LIGHT_COLORS } } })], /modes: unknown key/)
})

test('family lists: grammar, last entry generic, @id must name a face', () => {
  const typed = (typography: unknown, fonts: unknown = [{ id: 'nunito', src: 'fonts/n.woff2' }]) => theme({ fonts, typography })
  const [resolved] = parsePanelThemes([typed({ body: ['@nunito', 'PingFang TC', 'system-ui', 'sans-serif'], heading: ['ui-serif', 'Georgia', 'serif'] })]).themes
  const shared = panelThemeSharedProperties(resolved!, id => `apt-${id === 'nunito' ? '0123456789abcdef' : 'x'}`)
  assert.equal(shared['--organic-font-body'], '"apt-0123456789abcdef", "PingFang TC", system-ui, sans-serif')
  assert.equal(shared['--organic-font-heading'], 'ui-serif, "Georgia", serif')
  rejects([typed({ body: ['PingFang TC'] })], /last entry must be a generic family/)
  rejects([typed({ body: ['@missing', 'sans-serif'] })], /names no face/)
  for (const bad of ['Segoe UI;', 'A"B', "A'B", 'A,B', 'A\\B', '-apple-system', ' Arial', 'Arial ', 'x'.repeat(49), 'url(x)', 'var(--x)', 'Ａrial']) {
    rejects([typed({ body: [bad, 'sans-serif'] })], /is not an allowed family name|must be a string/)
  }
  rejects([typed({ body: [] })], /1-5 families/)
  rejects([typed({ body: ['a', 'b', 'c', 'd', 'e', 'serif'] })], /1-5 families/)
})

test('fonts: woff2 paths only, bounded faces, no duplicates, at most 8 files per plugin', () => {
  rejects([theme({ fonts: [{ id: 'a', src: 'fonts/a.ttf' }] })], /\.woff2 path/)
  rejects([theme({ fonts: [{ id: 'a', src: '../a.woff2' }] })], /\.woff2 path/)
  rejects([theme({ fonts: [{ id: 'a', src: 'a.woff2', weight: 500 }] })], /weight/)
  rejects([theme({ fonts: [{ id: 'a', src: 'a.woff2' }, { id: 'a', src: 'b.woff2', weight: 400 }] })], /duplicate/)
  rejects([theme({ fonts: Array.from({ length: 5 }, (_, index) => ({ id: `f${index}`, src: `f${index}.woff2` })) })], /at most 4 faces/)
  const many = [0, 1, 2].map(index => theme({ id: `t${index}`, fonts: [0, 1, 2].map(face => ({ id: `f${face}`, src: `t${index}-${face}.woff2`, weight: [400, 600, 700][face] })) }))
  rejects(many, /at most 8 distinct font files/)
})

test('typography scale and shape radii reject, never clamp, out-of-range numbers', () => {
  const [scaled] = parsePanelThemes([theme({ typography: { scale: 1.15 } })]).themes
  const shared = panelThemeSharedProperties(scaled!, id => id)
  assert.equal(shared['--organic-font-label'], '14px')
  assert.equal(shared['--organic-font-display-md'], '25px')
  const [small] = parsePanelThemes([theme({ typography: { scale: 0.92 } })]).themes
  assert.equal(panelThemeSharedProperties(small!, id => id)['--organic-font-label'], '11px')
  for (const scale of [0.91, 1.16, 1.005, Number.NaN, '1']) rejects([theme({ typography: { scale } })], /scale/)
  rejects([theme({ shape: { radiusSm: 17 } })], /radiusSm/)
  rejects([theme({ shape: { radiusSm: 1.5 } })], /radiusSm/)
  rejects([theme({ shape: { radiusSm: 12, radiusMd: 8 } })], /radiusSm <= radiusMd <= radiusLg/)
  rejects([theme({ shape: { radiusLg: 33 } })], /radiusLg/)
})

test('structure: ids, counts, bilingual text, unknown keys and duplicates', () => {
  rejects([], /1-8 themes/)
  rejects(Array.from({ length: 9 }, (_, index) => theme({ id: `t${index}` })), /1-8 themes/)
  rejects([theme(), theme()], /duplicate theme id/)
  rejects([theme({ id: 'Bad_Id' })], /panelThemes\[0\]\.id/)
  rejects([theme({ displayName: { 'en-US': 'Only English' } })], /displayName/)
  rejects([theme({ description: { 'zh-TW': 'x'.repeat(121), 'en-US': 'ok' } })], /description/)
  rejects([theme({ css: 'body{}' })], /unknown key/)
  rejects([lightTheme({ colors: { ...LIGHT_COLORS, primary: '#000' } })], /colors: unknown key/)
  rejects([lightTheme({ colors: { ...LIGHT_COLORS, text: undefined } })], /colors\.text/)
  rejects([lightTheme({ colors: { ...LIGHT_COLORS, text: 'red;}body{' } })], /colors\.text: not an allowed colour/)
  rejects([lightTheme({ colors: { ...LIGHT_COLORS, text: '#10282c80' } })], /colors\.text: must be opaque/)
  rejects([lightTheme({ colors: { ...LIGHT_COLORS, border: 'rgb(16 40 44 / 0.05)' } })], /colors\.border: alpha must be 0\.08-1/)
  rejects([lightTheme({ colors: { ...LIGHT_COLORS, scrim: 'rgb(0 0 0 / 0.95)' } })], /colors\.scrim: alpha must be 0\.3-0\.9/)
  rejects([lightTheme({ colors: { ...LIGHT_COLORS, accentGlow: '#1f7a80' } })], /colors\.accentGlow: alpha must be 0\.02-0\.95/)
  rejects([lightTheme({ background: { type: 'image', src: 'https://example.com/a.png', overlay: { color: '#eef6f6', opacity: 0.9 } } })], /src/)
  rejects([lightTheme({ background: { type: 'image', src: 'a.jpg', overlay: { color: '#eef6f6', opacity: 0.9 } } })], /src/)
  rejects([lightTheme({ background: { type: 'solid', color: '#fff' } })], /unknown key/)
  rejects([lightTheme({ background: { type: 'video' } })], /type/)
  // 診斷訊息絕不回顯插件控制的字串。
  const diagnostic = rejects([lightTheme({ colors: { ...LIGHT_COLORS, text: '<img src=x onerror=alert(1)>' } })])
  assert.doesNotMatch(diagnostic, /onerror|</)
})

test('resolved themes always carry all 31 colour properties and the built-in palette is canonical', () => {
  const themes = resolvePanelThemes([theme()])!
  const state = buildPanelThemeState([source(themes)], emptyStore(), resolver())
  assert.deepEqual(Object.keys(state.themes[0]!.modes.light!.properties), [...PANEL_THEME_COLOR_PROPERTIES])
  assert.deepEqual(Object.keys(state.builtin.light), [...PANEL_THEME_COLOR_PROPERTIES])
  assert.equal(builtinPanelThemeProperties('dark')['--organic-bg'], 'rgb(31 27 22 / 1)')
  assert.equal(Object.keys(state.themes[0]!.shared.properties).length, 2 + 9 + 3)
})

function emptyStore() {
  return { version: 1 as const, slots: { light: null, dark: null }, userImages: {} }
}

function resolver() {
  return {
    packagedUrl: (kind: string, pluginId: string, version: string, path: string) => `agent-pets://panel-theme/${'a'.repeat(32)}#${kind}:${pluginId}@${version}/${path}`,
    fontAlias: () => 'apt-0123456789abcdef',
    userImageUrl: (_pluginId: string, file: string) => `agent-pets://panel-theme/${file.slice(0, 32)}`,
  }
}

function source(themes: PanelThemeSourcePlugin['themes'], available = true): PanelThemeSourcePlugin {
  return { pluginId: 'theme-pack', version: '1.0.0', pluginName: { 'zh-TW': '主題包', 'en-US': 'Theme Pack' }, available, themes, ...(available ? {} : { unavailableReason: 'plugin_disabled' as const }) }
}

test('catalog builder: slot status, unavailable reasons and user image dims', () => {
  const themes = resolvePanelThemes([theme({ modes: { light: { colors: LIGHT_COLORS, userImage: { allowed: true, overlay: { color: '#eef6f6', opacity: 0.9 } } }, dark: { colors: DARK_COLORS } } })])!
  const ref = { pluginId: 'theme-pack', themeId: 'aurora' }
  const store = {
    version: 1 as const,
    slots: { light: ref, dark: { pluginId: 'theme-pack', themeId: 'gone' } },
    userImages: { 'theme-pack': { aurora: { light: { file: `${'b'.repeat(64)}.png`, type: 'image/png' as const, width: 100, height: 100, bytes: 10, fit: 'tile' as const, position: 'top' as const, dim: 0.5, blur: 8 as const, importedAt: '2026-11-08T00:00:00.000Z' } } } },
  }
  const state = buildPanelThemeState([source(themes)], store, resolver())
  assert.deepEqual(state.slots.light, { ref, status: 'active' })
  assert.deepEqual(state.slots.dark, { ref: { pluginId: 'theme-pack', themeId: 'gone' }, status: 'unavailable', reason: 'theme_removed' })
  const user = state.themes[0]!.modes.light!.userImage!
  // 儲存的 dim 低於目前最小值時，會退回預設 dim。
  assert.equal(user.current!.dim, user.minDim > 0.5 ? user.defaultDim : 0.5)
  const disabled = buildPanelThemeState([source(themes, false)], store, resolver())
  assert.equal(disabled.themes.length, 0)
  assert.deepEqual(disabled.slots.light, { ref, status: 'unavailable', reason: 'plugin_disabled' })
  const off = buildPanelThemeState([{ ...source(themes, false), unavailableReason: 'plugins_off' }], store, resolver())
  assert.equal(off.slots.light.reason, 'plugins_off')
})

test('packaged and user image header checks reject bombs, animation, wrong magic and rotation', () => {
  assert.deepEqual(checkPanelThemePackagedImage(png(512, 256)), { ok: true, type: 'image/png', width: 512, height: 256 })
  assert.equal(checkPanelThemePackagedImage(webp(512, 256)).ok, true)
  assert.deepEqual(checkPanelThemePackagedImage(png(4097, 64)), { ok: false, error: 'image_too_large' })
  assert.deepEqual(checkPanelThemePackagedImage(png(4096, 4096)), { ok: false, error: 'image_too_large' })
  assert.deepEqual(checkPanelThemePackagedImage(png(63, 512)), { ok: false, error: 'image_invalid' })
  assert.deepEqual(checkPanelThemePackagedImage(png(512, 512, { animated: true })), { ok: false, error: 'image_animated' })
  assert.deepEqual(checkPanelThemePackagedImage(webp(512, 512, { animated: true })), { ok: false, error: 'image_animated' })
  assert.deepEqual(checkPanelThemePackagedImage(png(512, 512, { exifOrientation: 6 })), { ok: false, error: 'image_invalid' })
  assert.deepEqual(checkPanelThemePackagedImage(jpeg(512, 512)), { ok: false, error: 'image_invalid' })
  assert.deepEqual(checkPanelThemePackagedImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')), { ok: false, error: 'image_invalid' })
  assert.deepEqual(checkPanelThemePackagedImage(new Uint8Array(8 * 1024 * 1024 + 1)), { ok: false, error: 'image_too_large' })

  assert.deepEqual(checkPanelThemeUserImage(jpeg(4032, 3024, { orientation: 6 })), { ok: true, type: 'image/jpeg', width: 4032, height: 3024 })
  assert.deepEqual(checkPanelThemeUserImage(jpeg(8193, 64)), { ok: false, error: 'image_too_large' })
  assert.deepEqual(checkPanelThemeUserImage(jpeg(8192, 4097)), { ok: false, error: 'image_too_large' })
  assert.deepEqual(checkPanelThemeUserImage(jpeg(512, 512, { secondSof: true })), { ok: false, error: 'image_invalid' })
  assert.deepEqual(checkPanelThemeUserImage(png(60000, 60000)), { ok: false, error: 'image_too_large' })
  assert.deepEqual(checkPanelThemeUserImage(png(256, 256, { animated: true })), { ok: false, error: 'image_animated' })
  assert.equal(checkPanelThemeUserImage(png(256, 256, { exifOrientation: 6 })).ok, true)
  assert.deepEqual(checkPanelThemeUserImage(new Uint8Array(20 * 1024 * 1024 + 1)), { ok: false, error: 'image_too_large' })
})

test('the module stays free of Electron and Node imports so the catalog validator can vendor it', () => {
  for (const file of ['electron/plugin-panel-themes.ts', 'electron/panel-theme-color.ts', 'electron/pet-sprite-validation.ts']) {
    const source = readFileSync(file, 'utf8')
    assert.doesNotMatch(source, /from 'electron'|require\('electron'\)|from 'node:/, file)
    for (const match of source.matchAll(/^import (?!type).* from '([^']+)'/gm)) assert.match(match[1]!, /^\.\//, `${file} imports only sibling pure modules`)
  }
})

test('state colours keep their meaning: OKLCH hue bands, minimum chroma and OKLab distance', () => {
  const withState = (overrides: Record<string, string>) => [lightTheme({ colors: { ...LIGHT_COLORS, ...overrides } })]
  // 綠色的「危險」、紅色的「成功」、灰色的「警告」都必須被拒絕。
  rejects(withState({ dangerText: '#2f6b2f' }), /colors\.dangerText: OKLCH hue \d+° is outside 0–50° or 340–360°/)
  rejects(withState({ successText: '#a62f1e' }), /colors\.successText: OKLCH hue/)
  rejects(withState({ warnText: '#5a5a5a' }), /colors\.warnText: chroma 0\.000 < 0\.05/)
  rejects(withState({ dangerText: '#8a2a2a', warnText: '#8a3a1a' }), /colors\.warnText: OKLCH hue|ΔE/)
  // 危險色若與強調按鈕色幾乎相同（例如紅色強調）也會被拒絕。
  rejects(withState({ accent: '#a62f1e', accentText: '#8a2618', dangerText: '#a62f1e', onAccent: '#ffffff' }), /dangerText: OKLab ΔE 0\.000 to accent\b/)
  assert.doesNotThrow(() => parsePanelThemes(withState({ dangerText: '#a62f1e', successText: '#3f5a1c', warnText: '#7a5200' })))
})

test('host invariants: every text token on every surface it appears on, bubbles and the pill over black and white desktops', () => {
  for (const mode of ['light', 'dark'] as const) assert.equal(panelThemeInvariantFailure(builtinPanelThemeColors(mode)), null, mode)
  // 泡泡與膠囊是 surface 疊在桌面上；太透明的組合會在其中一種桌面上失敗。
  const light = builtinPanelThemeColors('light')
  const failure = panelThemeInvariantFailure({ ...light, surface: { r: 120, g: 120, b: 120, a: 1 } })
  assert.ok(failure && failure.minimum >= 3, JSON.stringify(failure))
  // 資訊色和其他文字色一樣要在主題表面上可讀；失敗時指向 infoText（省略時是內建值，作者可以自行宣告）。
  const black = { r: 0, g: 0, b: 0, a: 1 }
  const inked = { ...light, text: black, textSecondary: black, textMuted: black, accentText: black, dangerText: black, successText: black, warnText: black }
  const infoFailure = panelThemeInvariantFailure({ ...inked, surface: { r: 150, g: 170, b: 200, a: 1 } })
  assert.equal(infoFailure?.foreground, 'infoText')
  // 懸停底（accentOnHover）疊在表面上後，文字仍要 >= 4.5:1；失敗時指向 accentOnHover。
  const washed = panelThemeInvariantFailure({ ...light, accentOnHover: { ...light.text, a: 0.6 } })
  assert.equal(washed?.blame, 'accentOnHover')
  assert.match(washed!.background, /^accentOnHover over surface/)
  // 主要按鈕懸停（往 text 混 12%）的標籤也要 >= 4.5:1。
  assert.equal(PANEL_THEME_PRESSED_MIX, 0.12)
  for (const file of ['src/components/ui/Button.vue', 'src/components/ui/InlinePermissionCard.vue']) {
    assert.match(readFileSync(file, 'utf8'), new RegExp(`var\\(--accent-hover(?:, var\\(--accent\\))?\\) ${100 - PANEL_THEME_PRESSED_MIX * 100}%, var\\(--text-primary\\)`), file)
  }
})

test('the built-in token table matches the --builtin-organic-* values in tokens.css for both modes', () => {
  const css = readFileSync('src/styles/tokens.css', 'utf8')
  const block = (selector: string) => {
    const start = css.indexOf(`${selector} {`)
    return css.slice(start, css.indexOf('\n}', start))
  }
  const light = block(':root')
  const dark = block(":root[data-theme='dark']")
  const value = (source: string, name: string) => new RegExp(`\\n  ${name}: ([^;]+);`).exec(source)?.[1]
  for (const token of PANEL_THEME_COLOR_TOKENS) {
    const name = token.property.replace('--organic-', '--builtin-organic-')
    const lightCss = value(light, name)
    const darkCss = value(dark, name) ?? lightCss
    assert.ok(lightCss, name)
    assert.deepEqual(color(lightCss!), color(token.light), `${name} light`)
    assert.deepEqual(color(darkCss!), color(token.dark), `${name} dark`)
  }
})

test('extended keys: infoText keeps its hue and distance, shadow stays dark and highlight light', () => {
  const withColors = (overrides: Record<string, string>) => [lightTheme({ colors: { ...LIGHT_COLORS, ...overrides } })]
  const [declared] = parsePanelThemes(withColors({ infoText: '#1f5f99', shadow: '#10202a', highlight: '#f4fbff' })).themes
  assert.deepEqual(declared!.modes.light!.colors.infoText, color('#1f5f99'))
  assert.deepEqual(declared!.modes.light!.colors.shadow, color('#10202a'))
  assert.deepEqual(declared!.modes.light!.colors.highlight, color('#f4fbff'))
  // 省略時取該模式的內建值。
  const [omitted] = parsePanelThemes([theme()]).themes
  assert.deepEqual(omitted!.modes.dark!.colors.infoText, color('#9cc3f0'))
  assert.deepEqual(omitted!.modes.dark!.colors.shadow, color('#000000'))
  rejects(withColors({ infoText: '#a62f1e' }), /colors\.infoText: OKLCH hue \d+° is outside 200–290°/)
  rejects(withColors({ infoText: '#555b66' }), /colors\.infoText: chroma/)
  rejects(withColors({ infoText: '#7fa6cc' }), /colors\.infoText: \d\.\d\d:1 < 4\.5:1 on surface/)
  rejects(withColors({ infoText: 'rgb(31 95 153 / 0.5)' }), /colors\.infoText: must be opaque/)
  rejects(withColors({ shadow: '#8a8070' }), /colors\.shadow: luminance 0\.\d+ > 0\.05/)
  rejects(withColors({ highlight: '#8a8070' }), /colors\.highlight: luminance 0\.\d+ < 0\.7/)
  rejects(withColors({ shadow: 'rgb(0 0 0 / 0.4)' }), /colors\.shadow: must be opaque/)
})

test('deprecated borderOnAccent is accepted, checked like before and never emitted', () => {
  assert.deepEqual(Object.keys(PANEL_THEME_DEPRECATED_COLOR_KEYS), ['borderOnAccent'])
  const { contributions, themes } = parsePanelThemes([lightTheme({ colors: { ...LIGHT_COLORS, borderOnAccent: 'rgb(255 255 255 / 0.55)' } })])
  assert.equal('borderOnAccent' in contributions[0]!.modes.light!.colors, false)
  assert.equal('borderOnAccent' in themes[0]!.modes.light!.colors, false)
  rejects([lightTheme({ colors: { ...LIGHT_COLORS, borderOnAccent: 'red' } })], /colors\.borderOnAccent: not an allowed colour/)
  rejects([lightTheme({ colors: { ...LIGHT_COLORS, borderOnAccent: '#ffffff' } })], /colors\.borderOnAccent: alpha must be 0\.02-0\.95/)
  // 它的屬性已從允許清單移除。
  assert.equal(PANEL_THEME_COLOR_PROPERTIES.includes('--organic-border-on-accent' as never), false)
})

test('the schema fragment and the public d.ts list exactly the runtime colour keys plus the deprecated ones', () => {
  const runtime = [...PANEL_THEME_COLOR_TOKENS.map(token => token.key), ...Object.keys(PANEL_THEME_DEPRECATED_COLOR_KEYS)].sort()
  const schema = JSON.parse(readFileSync('docs/plugins/plugin.schema.json', 'utf8')) as { $defs: { panelThemeColors: { properties: Record<string, { deprecated?: boolean }>; required: string[] } } }
  const colors = schema.$defs.panelThemeColors
  assert.deepEqual(Object.keys(colors.properties).sort(), runtime)
  assert.deepEqual([...colors.required].sort(), PANEL_THEME_COLOR_TOKENS.filter(token => token.kind === 'required').map(token => token.key).sort())
  for (const key of Object.keys(PANEL_THEME_DEPRECATED_COLOR_KEYS)) assert.equal(colors.properties[key]!.deprecated, true, key)
  const declaration = readFileSync('docs/plugins/agent-pets-plugin.d.ts', 'utf8')
  const block = declaration.slice(declaration.indexOf('export interface PluginPanelThemeColors {'), declaration.indexOf('export interface PluginPanelThemeOverlay'))
  assert.deepEqual([...block.matchAll(/^ {2}([a-zA-Z0-9]+)\??: PluginPanelThemeColor$/gm)].map(match => match[1]).sort(), runtime)
})

test('state chips tint at the validated alpha and the components that host sage text use validated pairs', () => {
  for (const file of ['src/components/ui/Chip.vue', 'src/components/ui/Badge.vue']) {
    for (const match of readFileSync(file, 'utf8').matchAll(/color-mix\(in srgb, var\(--state-[a-z-]+\) (\d+)%, transparent\)/g)) {
      assert.equal(Number(match[1]) / 100, PANEL_THEME_STATE_TINT_ALPHA, file)
    }
  }
  // 狀態晶片的底愈濃對比愈低：在 12% 的同色底上不足 4.5:1 的狀態色會被拒絕。
  const light = builtinPanelThemeColors('light')
  const failure = panelThemeInvariantFailure({ ...light, warnText: color('#8a6100') })
  assert.match(failure?.background ?? '', /^warnText at 0\.12 over surface \(state chip\)$/)
})

test('danger buttons: danger text on the pet overlay and on its 12% danger hover mix are checked', () => {
  assert.equal(PET_OVERLAY_SURFACE_ALPHA, 0.98)
  assert.equal(PANEL_THEME_STATE_TINT_ALPHA, 0.12)
  for (const mode of ['light', 'dark'] as const) assert.equal(panelThemeInvariantFailure(builtinPanelThemeColors(mode)), null, mode)
  const light = builtinPanelThemeColors('light')
  // 夠在不透明表面上通過、但在 12% 危險色底上不夠的危險色。
  const failures = [...panelThemeInvariantFailures({ ...light, dangerText: { r: 205, g: 80, b: 70, a: 1 } })]
  const backgrounds = failures.filter(failure => failure.foreground === 'dangerText').map(failure => failure.background)
  assert.ok(backgrounds.some(background => /^dangerText at 0\.12 over the pet overlay over a (black|white) desktop \(danger button hover\)$/.test(background)), backgrounds.join('\n'))
  assert.ok(backgrounds.some(background => /^pet overlay over a (black|white) desktop$/.test(background)), backgrounds.join('\n'))
})
