import assert from 'node:assert/strict'
import test from 'node:test'
import {
  contrastRatio,
  formatPanelThemeColor,
  isCanonicalPanelThemeColor,
  mixColor,
  parsePanelThemeColor,
  relativeLuminance,
  withAlpha,
} from '../electron/panel-theme-color.ts'
import { PANEL_THEME_RGB_PATTERN } from '../src/types/panel-theme.ts'

function canonical(value: string): string {
  const parsed = parsePanelThemeColor(value)
  assert.equal(parsed.ok, true, `${value} parses`)
  if (!parsed.ok) throw new Error(parsed.error)
  return formatPanelThemeColor(parsed.color)
}

test('every accepted colour form converts to the canonical rgb() string', () => {
  const cases: Array<[string, string]> = [
    ['#fff', 'rgb(255 255 255 / 1)'],
    ['#FFF8', 'rgb(255 255 255 / 0.533)'],
    ['#fbf1f3', 'rgb(251 241 243 / 1)'],
    ['#00000080', 'rgb(0 0 0 / 0.502)'],
    ['rgb(42, 29, 34)', 'rgb(42 29 34 / 1)'],
    ['rgba(42,29,34,.16)', 'rgb(42 29 34 / 0.16)'],
    ['rgb(42 29 34 / 0.16)', 'rgb(42 29 34 / 0.16)'],
    ['rgb(100% 0% 50%)', 'rgb(255 0 128 / 1)'],
    ['rgb(10 20 30 / 50%)', 'rgb(10 20 30 / 0.5)'],
    ['rgba(1.4, 2.6, 3.5)', 'rgb(1 3 4 / 1)'],
    ['hsl(0, 100%, 50%)', 'rgb(255 0 0 / 1)'],
    ['hsla(120deg, 100%, 25%, 0.5)', 'rgb(0 128 0 / 0.5)'],
    ['hsl(240 100% 50% / 25%)', 'rgb(0 0 255 / 0.25)'],
    ['hsl(360 0% 100%)', 'rgb(255 255 255 / 1)'],
    ['oklch(0 0 0)', 'rgb(0 0 0 / 1)'],
    ['oklch(100% 0 0)', 'rgb(255 255 255 / 1)'],
    ['oklch(0.6 0.1 30deg / 0.5)', canonical('oklch(60% 0.1 30 / 50%)')],
  ]
  for (const [input, expected] of cases) assert.equal(canonical(input), expected, input)
})

test('every emitted colour matches the renderer pattern and re-parses to itself', () => {
  for (const input of ['#123', '#abcdef80', 'rgb(0 0 0 / 0)', 'hsl(200 50% 50% / 0.333)', 'oklch(0.7 0.05 120)']) {
    const value = canonical(input)
    assert.match(value, PANEL_THEME_RGB_PATTERN)
    assert.equal(isCanonicalPanelThemeColor(value), true)
    assert.equal(canonical(value), value)
  }
  assert.equal(isCanonicalPanelThemeColor('rgb(1 2 3 / 0.50)'), false)
  assert.equal(isCanonicalPanelThemeColor('rgb(01 2 3 / 1)'), false)
  assert.equal(isCanonicalPanelThemeColor('rgb(256 2 3 / 1)'), false)
})

test('injection strings, functions, keywords and malformed numbers are rejected', () => {
  const rejected = [
    'red', 'transparent', 'currentcolor', 'inherit', 'none',
    'red;}body{background:red', '#fff;}body{', '#fff}', '#fff;', 'rgb(1,2,3);color:red',
    'url(https://example.com/x.png)', 'url(x)', 'var(--x)', 'rgb(var(--x) 0 0)', 'calc(1)', 'rgb(calc(1) 2 3)',
    'expression(alert(1))', 'rgb(1 2 3) url(x)', 'rgb(from red r g b)',
    '\\66 ff', '#\\66ff', 'rgb(1\\,2,3)', '"#fff"', "'#fff'", 'rgb(1,2,3))', 'rgb((1,2,3)',
    '#ｆｆｆ', 'rgb(１,２,３)', 'rgb(1e2, 0, 0)', 'rgb(-1, 0, 0)', 'rgb(+1, 0, 0)', 'rgb(none 0 0)',
    'RGB(1,2,3)', 'Rgb(1,2,3)', 'HSL(0,0%,0%)', ' #fff', '#fff ', '#fff\n', '\u0000#fff',
    `rgb(${'1'.repeat(70)})`, '#ff', '#fffff', '#fffffff', '#gggggg',
    'rgb(256, 0, 0)', 'rgb(101% 0% 0%)', 'rgb(10% 0 0)', 'rgb(0 0 0 / 1.5)', 'rgb(0 0 0 / 101%)',
    'hsl(361, 50%, 50%)', 'hsl(0, 101%, 50%)', 'hsl(0, 50, 50)', 'oklch(1.1 0 0)', 'oklch(0.5 0.5 0)', 'oklch(0.5 0.1 400)',
    'rgb(1 2 3 / .12345)', 'lab(50 0 0)', 'color(srgb 1 0 0)', 'hwb(0 0% 0%)',
    42, null, undefined, {}, ['#fff'],
  ]
  for (const value of rejected) assert.equal(parsePanelThemeColor(value).ok, false, `${JSON.stringify(value)} is rejected`)
})

test('oklch outside the sRGB gamut is rejected rather than clipped', () => {
  const result = parsePanelThemeColor('oklch(0.7 0.35 145)')
  assert.deepEqual(result, { ok: false, error: 'out_of_gamut' })
  assert.equal(parsePanelThemeColor('oklch(0.7 0.05 145)').ok, true)
})

test('mix, alpha and WCAG contrast follow the spec formulas', () => {
  const black = { r: 0, g: 0, b: 0, a: 1 }
  const white = { r: 255, g: 255, b: 255, a: 1 }
  assert.deepEqual(mixColor(black, white, 0.5), { r: 128, g: 128, b: 128, a: 1 })
  assert.deepEqual(withAlpha(white, 0.1234), { r: 255, g: 255, b: 255, a: 0.123 })
  assert.equal(relativeLuminance(white), 1)
  assert.equal(contrastRatio(black, white), 21)
  // 半透明前景會先合成到背景上。
  assert.equal(contrastRatio({ ...black, a: 0 }, white), 1)
  assert.ok(Math.abs(contrastRatio({ ...black, a: 0.5 }, white) - contrastRatio({ r: 127.5, g: 127.5, b: 127.5, a: 1 }, white)) < 1e-9)
})
