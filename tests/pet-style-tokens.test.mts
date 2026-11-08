import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')
const files = [
  '../src/components/DesktopPet.css',
  '../src/components/DesktopPetBubbles.css',
  '../src/components/PetAnimation.css',
]

test('pet stylesheets use design tokens instead of bare hex or rgba', () => {
  for (const file of files) {
    const css = stripComments(read(file))
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, `${file} has a bare hex colour`)
    assert.doesNotMatch(css, /rgba?\(/, `${file} has a bare rgb()/rgba() colour`)
  }
})

test('pet scoped styles and App scrollbars carry no bare colour either', () => {
  const app = read('../src/App.vue')
  const style = stripComments(app.slice(app.indexOf('<style>')))
  assert.doesNotMatch(style, /rgba?\(/)
  const animation = read('../src/components/PetAnimation.vue')
  assert.doesNotMatch(animation, /rgba\(/)
})

test('no pet text is smaller than the 11px token floor', () => {
  for (const file of files) {
    for (const match of stripComments(read(file)).matchAll(/font(?:-size)?:[^;]*?\b(\d+(?:\.\d+)?)px/g)) {
      const size = Number(match[1])
      if (/font:\s*\d{3}\s+\d/.test(match[0]) && size < 11) assert.fail(`${file}: ${match[0]}`)
      if (/font-size/.test(match[0]) && !/max\(|min\(|calc\(/.test(match[0])) {
        assert.ok(size >= 11, `${file}: ${match[0]} is below 11px`)
      }
    }
  }
})

test('the quota tooltip does not nest a backdrop-filter inside the glass status line', () => {
  const css = stripComments(read('../src/components/DesktopPet.css'))
  const tooltip = css.slice(css.indexOf('.quota-tooltip {'), css.indexOf('.quota-tooltip-row {'))
  assert.doesNotMatch(tooltip, /backdrop-filter/)
})
