import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import test from 'node:test'

test('only useReducedMotion queries prefers-reduced-motion from script', () => {
  const files = (function walk(dir: string): string[] {
    return readdirSync(new URL(`../${dir}/`, import.meta.url)).flatMap(name => {
      const path = `${dir}/${name}`
      if (statSync(new URL(`../${path}`, import.meta.url)).isDirectory()) return walk(path)
      return /\.(ts|vue)$/.test(name) ? [path] : []
    })
  })('src')
  const offenders = files.filter(path => path !== 'src/composables/useReducedMotion.ts'
    && /matchMedia\??\.?\(\s*['"`]\(prefers-reduced-motion/.test(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')))
  assert.deepEqual(offenders, [])
})

test('useReducedMotion shares one MediaQueryList and follows system changes', async () => {
  const listeners: Array<(event: { matches: boolean }) => void> = []
  let created = 0
  const fakeWindow = {
    matchMedia(query: string) {
      created += 1
      assert.equal(query, '(prefers-reduced-motion: reduce)')
      return { matches: true, addEventListener: (_: string, listener: (event: { matches: boolean }) => void) => listeners.push(listener) }
    },
  }
  ;(globalThis as { window?: unknown }).window = fakeWindow
  try {
    const { useReducedMotion } = await import('../src/composables/useReducedMotion.ts')
    const first = useReducedMotion()
    const second = useReducedMotion()
    assert.equal(first, second)
    assert.equal(first.value, true)
    for (let i = 0; i < 100; i += 1) void useReducedMotion().value
    assert.equal(created, 1)
    assert.equal(listeners.length, 1)
    listeners[0]({ matches: false })
    assert.equal(first.value, false)
  } finally {
    delete (globalThis as { window?: unknown }).window
  }
})
