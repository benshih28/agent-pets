import test from 'node:test'
import assert from 'node:assert/strict'
import { PAIRS, PET_BUBBLE_PAIRS, contrast, evaluate, parseTokens, resolveHex } from '../scripts/check-contrast.mjs'

test('contrast maths matches known WCAG values', () => {
  assert.equal(Math.round(contrast('#000000', '#ffffff')), 21)
  assert.ok(Math.abs(contrast('#858b9b', '#12121a') - 5.47) < 0.02)
})

for (const theme of ['light', 'dark']) {
  test(`every documented token pair resolves and meets its minimum ratio (${theme})`, () => {
    const map = parseTokens(undefined, theme)
    for (const r of evaluate(map)) {
      assert.ok(r.ratio !== null, `${r.fg} on ${r.bg} could not be resolved to hex`)
      assert.ok(r.ok, `${r.fg} on ${r.bg} is ${r.ratio?.toFixed(2)}, needs ${r.min} (${r.note})`)
    }
    assert.ok(PAIRS.length > 10)
  })
}

test('the dark theme actually overrides the panel palette', () => {
  const light = parseTokens(undefined, 'light')
  const dark = parseTokens(undefined, 'dark')
  assert.notEqual(resolveHex(light, '--organic-bg'), resolveHex(dark, '--organic-bg'))
})

test('alias tokens resolve through var()', () => {
  const map = parseTokens()
  assert.equal(resolveHex(map, '--color-text'), resolveHex(map, '--organic-text'))
})

test('light pet appearance meets AA on the opaque bubble surface', () => {
  const map = parseTokens(undefined, 'pet-light')
  assert.notEqual(resolveHex(map, '--pet-bubble-surface-opaque'), resolveHex(parseTokens(), '--pet-bubble-surface-opaque'))
  for (const r of evaluate(map, PET_BUBBLE_PAIRS)) {
    assert.ok(r.ok, `${r.fg} on ${r.bg} is ${r.ratio?.toFixed(2)}, needs ${r.min} (${r.note})`)
  }
})
