import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const tokens = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const reduced = tokens.slice(tokens.indexOf('@media (prefers-reduced-motion: reduce)'))
const rootBlock = tokens.slice(0, tokens.indexOf('}'))

test('every motion duration token is zeroed under prefers-reduced-motion', () => {
  const motion = [...rootBlock.matchAll(/^\s*(--(?:transition|duration)-[a-z0-9-]+)\s*:/gm)].map(m => m[1])
  assert.ok(motion.includes('--duration-spin') && motion.includes('--transition-fast'))
  for (const token of motion) assert.match(reduced, new RegExp(`${token}:\\s*0s;`), `${token} keeps moving under reduced motion`)
})

test('reduced motion also stops one-off keyframe animations and transitions', () => {
  assert.match(reduced, /animation-duration:\s*0\.001ms !important/)
  assert.match(reduced, /animation-iteration-count:\s*1 !important/)
  assert.match(reduced, /transition-duration:\s*0\.001ms !important/)
})

test('easing tokens stay easings (not zeroed) and each is a single timing function', () => {
  for (const m of rootBlock.matchAll(/^\s*(--ease-[a-z0-9-]+)\s*:\s*([^;]+);/gm)) {
    assert.match(m[2].trim(), /^cubic-bezier\([^()]*\)$/, m[1])
    assert.doesNotMatch(reduced, new RegExp(`${m[1]}:`), `${m[1]} should not be redefined for reduced motion`)
  }
})
