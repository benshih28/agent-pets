import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', 'src')
const base = readFileSync(join(root, 'styles', 'base.css'), 'utf8')
const tokens = readFileSync(join(root, 'styles', 'tokens.css'), 'utf8')
const ui = join(root, 'components', 'ui')

test('base.css ships a global zero-specificity :focus-visible ring built from tokens', () => {
  assert.match(base, /:where\([\s\S]*?button[\s\S]*?\):focus-visible/)
  assert.match(base, /outline:\s*var\(--focus-ring-width\)\s+solid\s+var\(--focus-ring-color\)/)
})

test('the focus ring follows the palette accent text (>= 3:1 on every surface) and Highlight in forced-colors mode', () => {
  assert.match(tokens, /--color-focus:\s*var\(--organic-accent-text\);/)
  assert.match(tokens, /--focus-ring-color:\s*var\(--color-focus\);/)
  assert.doesNotMatch(tokens, /focus-ring-color-on-light/)
  assert.match(tokens, /forced-colors:\s*active[\s\S]*--focus-ring-color:\s*Highlight/)
})

test('ui primitives never remove the outline without drawing a replacement ring', () => {
  for (const name of readdirSync(ui).filter((f) => f.endsWith('.vue'))) {
    const src = readFileSync(join(ui, name), 'utf8')
    const style = src.split('<style')[1] ?? ''
    for (const m of style.matchAll(/([^{}]+)\{[^}]*outline:\s*none[^}]*\}/g)) {
      if (m[1].includes(':not(:focus-visible)')) continue
      // A hidden native input may drop its own outline only when the visible
      // sibling draws the ring.
      assert.match(style, /focus-visible\s*\+\s*\.[a-z-]+\s*\{[^}]*outline:\s*var\(--focus-ring-width\)/, `${name}: ${m[1].trim()} removes outline without a sibling ring`)
    }
  }
})
