import test from 'node:test'
import assert from 'node:assert/strict'
import { CONTEXTS, PAIRS, PET_PAIRS, contrast, evaluate, pairsFor, resolveColor, tokenMap, worstContrast } from '../scripts/check-contrast.mjs'

test('contrast maths matches known WCAG values', () => {
  assert.equal(Math.round(contrast('#000000', '#ffffff')), 21)
  assert.ok(Math.abs(contrast('#858b9b', '#12121a') - 5.47) < 0.02)
})

for (const context of Object.keys(CONTEXTS)) {
  test(`every documented token pair resolves and meets its minimum ratio (${context})`, () => {
    for (const r of evaluate(tokenMap(context), pairsFor(context))) {
      assert.ok(r.ratio !== null, `${r.fg} on ${r.bg} could not be resolved`)
      assert.ok(r.ok, `${r.fg} on ${r.bg} is ${r.ratio?.toFixed(2)}, needs ${r.min} (${r.note})`)
    }
    assert.ok(PAIRS.length > 10 && PET_PAIRS.length > 10)
  })
}

test('the dark context re-points the palette and the semantic layer follows it', () => {
  const light = tokenMap('light')
  const dark = tokenMap('dark')
  assert.notDeepEqual(resolveColor(light, '--organic-bg'), resolveColor(dark, '--organic-bg'))
  assert.deepEqual(resolveColor(dark, '--surface-panel'), resolveColor(dark, '--organic-bg'))
  assert.deepEqual(resolveColor(light, '--color-text'), resolveColor(light, '--organic-text'))
})

test('the resolver follows the cascade, var() fallbacks, initial and color-mix', () => {
  const css = ':root {\n  --a: #ff0000;\n  --b: initial;\n  --c: var(--b, var(--a));\n  --d: color-mix(in srgb, var(--a) 50%, transparent);\n  --e: color-mix(in srgb, #000000 25%, #ffffff);\n}\n:root[data-theme=\'dark\'] {\n  --a: #00ff00;\n}\n@media (prefers-contrast: more) {\n  :root {\n    --a: #0000ff;\n  }\n}'
  const light = tokenMap('light', css)
  assert.deepEqual(resolveColor(light, '--c'), { r: 255, g: 0, b: 0, a: 1 })
  assert.deepEqual(resolveColor(light, '--d'), { r: 255, g: 0, b: 0, a: 0.5 })
  assert.deepEqual(resolveColor(light, '--e'), { r: 191.25, g: 191.25, b: 191.25, a: 1 })
  assert.deepEqual(resolveColor(tokenMap('dark', css), '--a'), { r: 0, g: 255, b: 0, a: 1 })
})

test('a translucent surface is judged over the worse of a black and a white desktop', () => {
  const text = { r: 0, g: 0, b: 0, a: 1 }
  const glass = { r: 255, g: 255, b: 255, a: 0.5 }
  assert.ok(Math.abs(worstContrast(text, glass) - contrast(text, { r: 127.5, g: 127.5, b: 127.5, a: 1 })) < 1e-9)
})
