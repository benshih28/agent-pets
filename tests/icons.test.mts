import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { FILLED_ICONS, ICON_PATHS } from '../src/components/ui/icons.ts'

test('icon set contains the glyph replacements and every path is well-formed', () => {
  for (const name of ['close', 'sparkle', 'wrench', 'alert', 'plugin', 'external-link', 'check', 'info', 'search']) {
    assert.ok(ICON_PATHS[name], `missing icon ${name}`)
  }
  for (const [name, d] of Object.entries(ICON_PATHS)) {
    assert.match(d, /^[MmLlHhVvCcSsQqTtAaZz0-9\s.,-]+$/, `${name}: invalid path data`)
    assert.match(d, /^[Mm]/, `${name}: must start with a moveto`)
  }
})

test('ui primitives contain no text-glyph icons', () => {
  const dir = join(import.meta.dirname, '..', 'src', 'components', 'ui')
  const glyph = /[×←-➿⬀-⯿]|\p{Extended_Pictographic}/u
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.vue') && f !== 'Icon.vue')) {
    const tpl = readFileSync(join(dir, name), 'utf8').split('<style')[0].replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '')
    assert.doesNotMatch(tpl, glyph, `${name} uses a glyph as an icon`)
  }
})

test('the overflow icon is three filled, vertically centred more_vert dots', () => {
  assert.ok(FILLED_ICONS.has('more'))
  for (const name of FILLED_ICONS) assert.ok(ICON_PATHS[name], `filled icon ${name} has no path`)
  // Only the overflow icon is filled; every other icon keeps the outline style.
  assert.deepEqual([...FILLED_ICONS], ['more'])
  const dots = [...ICON_PATHS.more.matchAll(/M([\d.]+) ([\d.]+)a([\d.]+) [\d.]+ 0 1 1 0 ([\d.]+) [\d.]+ [\d.]+ 0 0 1 0-([\d.]+)Z/g)]
  assert.equal(dots.length, 3)
  const centres = dots.map(([, x, y, r, down, up]) => {
    assert.equal(x, '8')
    assert.equal(Number(down), Number(up))
    assert.ok(Math.abs(Number(down) - 2 * Number(r)) < 1e-9)
    assert.ok(Number(r) >= 1.3 && Number(r) <= 1.5)
    return Number(y) + Number(r)
  })
  for (const [index, expected] of [4, 8, 12].entries()) assert.ok(Math.abs(centres[index] - expected) < 0.01)
})

test('Icon fills a filled icon and leaves every other icon stroked', () => {
  const source = readFileSync(join(import.meta.dirname, '..', 'src', 'components', 'ui', 'Icon.vue'), 'utf8')
  assert.match(source, /FILLED_ICONS\.has\(props\.name\)/)
  assert.match(source, /:fill="filled \? 'currentColor' : undefined"/)
  assert.match(source, /:stroke="filled \? 'none' : undefined"/)
  assert.match(source, /stroke="currentColor"/)
})
