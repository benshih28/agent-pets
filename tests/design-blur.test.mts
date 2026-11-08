import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', 'src')
const tokens = readFileSync(join(root, 'styles', 'tokens.css'), 'utf8')
const base = readFileSync(join(root, 'styles', 'base.css'), 'utf8')

test('three blur tokens exist and all go to none under reduced transparency', () => {
  for (const name of ['--blur-chip', '--blur-bubble', '--blur-scrim']) {
    assert.match(tokens, new RegExp(`${name}:\\s*blur\\(`))
    assert.match(tokens, new RegExp(`prefers-reduced-transparency[\\s\\S]*${name}:\\s*none`))
  }
})

test('gpu-safe mode disables backdrop blur globally', () => {
  assert.match(base, /html\[data-gpu-safe\][\s\S]*backdrop-filter:\s*none\s*!important/)
})

test('ui primitives use blur tokens, never literals, and always pair -webkit- prefix', () => {
  const dir = join(root, 'components', 'ui')
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.vue'))) {
    const src = readFileSync(join(dir, name), 'utf8')
    assert.doesNotMatch(src, /backdrop-filter:\s*blur\(/, `${name} uses a literal blur`)
    const plain = (src.match(/(?<!-webkit-)backdrop-filter:\s*var/g) ?? []).length
    const prefixed = (src.match(/-webkit-backdrop-filter:\s*var/g) ?? []).length
    assert.equal(prefixed, plain, `${name}: missing -webkit-backdrop-filter twin`)
  }
})
