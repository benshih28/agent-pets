import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { derivePetStatusColors, parsePanelThemes, PanelThemeValidationError, PET_BUBBLE_SURFACE_ALPHA, PET_PILL_SURFACE_ALPHA, PET_PILL_TRACK_ALPHA, PET_STATUS_TOKENS, petStatusProperties } from '../electron/plugin-panel-themes.ts'
import { contrastRatio, compositeColor, parsePanelThemeColor, type PanelThemeRgba } from '../electron/panel-theme-color.ts'
import { petThemeTargetProperties } from '../src/utils/panel-theme-css.ts'
import { CONTEXTS, tokenMap } from '../scripts/check-contrast.mjs'
import { PANEL_THEME_COLOR_PROPERTIES, PET_STATUS_PROPERTIES, PET_THEME_COLOR_PROPERTIES } from '../src/types/panel-theme.ts'
import { DARK_COLORS, LIGHT_COLORS, theme } from './support/panel-theme-fixtures.mts'

const color = (value: string): PanelThemeRgba => {
  const parsed = parsePanelThemeColor(value)
  if (!parsed.ok) throw new Error(value)
  return parsed.color
}

const withPill = (petStatus: unknown, mode: 'light' | 'dark' = 'dark') => [theme({
  modes: { [mode]: { colors: mode === 'dark' ? DARK_COLORS : LIGHT_COLORS, petStatus } },
})]

function rejects(value: unknown, pattern: RegExp): void {
  assert.throws(() => parsePanelThemes(value), (error: unknown) => error instanceof PanelThemeValidationError && pattern.test(error.diagnostic))
}

test('petStatus: background and text are required, the rest is derived deterministically', () => {
  const [resolved] = parsePanelThemes(withPill({ background: 'rgb(13 27 34 / 0.9)', text: '#e6f4f5' })).themes
  const pill = resolved!.modes.dark!.petStatus!
  assert.deepEqual(pill.border, { ...color('#e6f4f5'), a: 0.18 })
  assert.deepEqual(pill.quotaTrack, { ...color('#e6f4f5'), a: 0.18 })
  assert.deepEqual(pill.quotaFill, color(DARK_COLORS.accent))
  // 推導是輸入的純函式。
  assert.deepEqual(derivePetStatusColors({ background: color('rgb(13 27 34 / 0.9)'), text: color('#e6f4f5') }, { accent: color(DARK_COLORS.accent) }), pill)
  rejects(withPill({ text: '#e6f4f5' }), /petStatus\.background: is required/)
  rejects(withPill({ background: 'rgb(13 27 34 / 0.9)' }), /petStatus\.text: is required/)
  rejects(withPill({ background: '#0d1b22', text: '#e6f4f5', dot: '#fff' }), /petStatus: unknown key/)
})

test('petStatus: closed grammar, opacity floors and canonical re-emission', () => {
  rejects(withPill({ background: 'rgb(13 27 34 / 0.8)', text: '#e6f4f5' }), /background: alpha must be 0\.85-1/)
  rejects(withPill({ background: '#0d1b22', text: '#e6f4f580' }), /text: must be opaque/)
  rejects(withPill({ background: 'var(--x)', text: '#e6f4f5' }), /background: not an allowed colour/)
  rejects(withPill({ background: '#0d1b22', text: 'red;}body{' }), /text: not an allowed colour/)
  rejects(withPill({ background: '#0d1b22', text: '#e6f4f5', quotaTrack: 'rgb(0 0 0 / 0.05)' }), /quotaTrack: alpha must be 0\.1-1/)
  const properties = petStatusProperties(parsePanelThemes(withPill({ background: 'rgba(13,27,34,.9)', text: 'hsl(184 41% 93%)' })).themes[0]!.modes.dark!.petStatus!)
  assert.deepEqual(Object.keys(properties), [...PET_STATUS_PROPERTIES])
  assert.equal(properties['--pet-status-background'], 'rgb(13 27 34 / 0.9)')
  assert.equal(properties['--pet-status-background-opaque'], 'rgb(13 27 34 / 1)')
})

test('petStatus contrast is checked over worst-case black and white desktops', () => {
  rejects(withPill({ background: 'rgb(13 27 34 / 0.9)', text: '#5a6a70' }), /petStatus\.text: [\d.]+:1 < 4\.5:1 on pill over a (black|white) desktop/)
  rejects(withPill({ background: 'rgb(13 27 34 / 0.9)', text: '#e6f4f5', textMuted: '#4a5a60' }), /petStatus\.textMuted/)
  rejects(withPill({ background: 'rgb(13 27 34 / 0.9)', text: '#e6f4f5', quotaFill: '#1d3a40' }), /petStatus\.quotaFill: .* < 3:1/)
  rejects(withPill({ background: 'rgb(248 252 252 / 0.92)', text: '#10282c', quotaFill: '#1f7a80' }, 'light'), /quotaFill: 2\.\d\d:1 < 3:1 on quotaTrack/)
  const [resolved] = parsePanelThemes(withPill({ background: 'rgb(248 252 252 / 0.92)', text: '#10282c', quotaFill: '#0e4f54' }, 'light')).themes
  const pill = resolved!.modes.light!.petStatus!
  // 推導出的低額度顏色會朝文字色移動，直到在所有情況下都達到 3:1。
  for (const desktop of [color('#000000'), color('#ffffff')]) {
    const surface = compositeColor(pill.background, desktop)
    assert.ok(contrastRatio(pill.quotaWarn, surface) >= 3)
    assert.ok(contrastRatio(pill.quotaWarn, compositeColor(pill.quotaTrack, surface)) >= 3)
    assert.ok(contrastRatio(pill.text, surface) >= 4.5)
  }
  assert.equal(PET_STATUS_TOKENS.filter(token => token.required).map(token => token.key).join(), 'background,text')
})

test('pet renderer accepts each canonical set whole, and suspends under forced colours', () => {
  const rgb = 'rgb(1 2 3 / 1)'
  const colors = Object.fromEntries(PET_THEME_COLOR_PROPERTIES.map(name => [name, rgb])) as never
  const status = Object.fromEntries(PET_STATUS_PROPERTIES.map(name => [name, rgb])) as never
  const plain = { forcedColors: false, highContrast: false }
  const both = PET_THEME_COLOR_PROPERTIES.length + PET_STATUS_PROPERTIES.length
  assert.equal(petThemeTargetProperties({ light: { colors, status }, dark: null }, 'light', plain).size, both)
  assert.equal(petThemeTargetProperties({ light: { colors, status: null }, dark: null }, 'light', plain).size, PET_THEME_COLOR_PROPERTIES.length)
  assert.equal(petThemeTargetProperties({ light: { colors, status }, dark: null }, 'dark', plain).size, 0)
  assert.equal(petThemeTargetProperties({ light: { colors, status }, dark: null }, 'light', { ...plain, forcedColors: true }).size, 0)
  // 任一值不是主機標準 rgb()、缺一個或多一個名稱：整組拒絕。
  assert.equal(petThemeTargetProperties({ light: { colors: { ...colors, '--organic-text': 'red' }, status }, dark: null }, 'light', plain).size, 0)
  assert.equal(petThemeTargetProperties({ light: { colors: { ...colors, '--organic-font-body': rgb }, status }, dark: null }, 'light', plain).size, 0)
  assert.equal(petThemeTargetProperties({ light: { colors, status: { ...status, '--pet-status-text': 'red' } }, dark: null }, 'light', plain).size, PET_THEME_COLOR_PROPERTIES.length)
  const contrast = petThemeTargetProperties({ light: { colors, status: null }, dark: null }, 'light', { ...plain, highContrast: true })
  assert.equal(contrast.get('--organic-border'), 'rgb(1 2 3 / 0.6)')
})

test('the pet window receives exactly the palette properties its CSS reaches', () => {
  // 從寵物視窗用到的 token 出發，沿著 tokens.css 的 var() 找出最終依賴的可套主題屬性。
  const files = ['src/components/DesktopPet.vue', 'src/components/DesktopPet.css', 'src/components/DesktopPetBubbles.css', 'src/components/PetAnimation.vue',
    'src/components/PetAnimation.css', 'src/components/permission/PermissionBubble.vue', 'src/components/permission/PermissionCountdown.vue',
    'src/components/permission/PermissionDetails.vue', 'src/components/permission/PermissionNoticeBubble.vue', 'src/components/permission/PermissionRiskBadge.vue',
    'src/components/ui/Button.vue', 'src/components/ui/Icon.vue', 'src/utils/agent-state-presentation.ts', 'src/styles/base.css']
  const used = new Set(files.flatMap(file => [...readFileSync(file, 'utf8').matchAll(/var\((--[a-z0-9-]+)/g)].map(m => m[1]!)))
  const themable = new Set<string>(PANEL_THEME_COLOR_PROPERTIES)
  const reached = new Set<string>()
  for (const context of ['pet-dark', 'pet-light'] as const) {
    const map = tokenMap(context)
    const seen = new Set<string>()
    const walk = (name: string) => {
      if (seen.has(name)) return
      seen.add(name)
      if (themable.has(name)) reached.add(name)
      for (const m of (map.get(name) ?? '').matchAll(/var\((--[a-z0-9-]+)/g)) walk(m[1]!)
    }
    for (const name of used) walk(name)
    assert.ok(CONTEXTS[context].includes('.desktop-pet'))
  }
  assert.deepEqual([...reached].sort(), [...PET_THEME_COLOR_PROPERTIES].sort())
  // 泡泡、膠囊與軌道的比例與驗證器相同。
  const tokens = readFileSync('src/styles/tokens.css', 'utf8')
  assert.match(tokens, new RegExp(`--pet-bubble-surface: color-mix\\(in srgb, var\\(--color-surface\\) ${Math.round(PET_BUBBLE_SURFACE_ALPHA * 100)}%, transparent\\);`))
  assert.match(tokens, new RegExp(`--organic-status-surface: color-mix\\(in srgb, var\\(--color-surface\\) ${Math.round(PET_PILL_SURFACE_ALPHA * 100)}%, transparent\\);`))
  assert.match(tokens, new RegExp(`--organic-status-track: color-mix\\(in srgb, var\\(--color-text\\) ${Math.round(PET_PILL_TRACK_ALPHA * 100)}%, transparent\\);`))
})

test('only the status pill reads --pet-status-*; bubbles, permission UI, dots and badges follow the palette', () => {
  const css = readFileSync('src/components/DesktopPet.css', 'utf8')
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*--pet-status-[^{}]*)\}/g)]
  assert.ok(rules.length > 0)
  for (const [, selector] of rules) {
    assert.match(selector!.trim(), /status-line|quota-meter|^:root\[data-pet-status-theme\] \.desktop-pet/, selector)
    assert.doesNotMatch(selector!, /bubble|permission|badge|tooltip|line-dot|marker|edge|context/, selector)
  }
  for (const file of ['src/components/DesktopPetBubbles.css', 'src/components/permission/PermissionBubble.vue', 'src/components/permission/PermissionNoticeBubble.vue', 'src/components/PetAnimation.css']) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /--pet-status-|--organic-bg|panel-theme/, file)
  }
  const pet = readFileSync('src/components/DesktopPet.vue', 'utf8')
  assert.match(pet, /usePetTheme\(\)/)
  assert.doesNotMatch(pet, /usePanelTheme\b/)
  assert.match(readFileSync('src/components/DesktopPet.css', 'utf8'), /\.status-line\[data-quota-tier='low'\] \{\n  --quota-color: var\(--organic-quota-error\);/)
})
