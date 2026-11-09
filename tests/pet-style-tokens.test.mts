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

test('the pet permission bubble never grows past the reserved headroom, so the source and risk badge stay on screen', async () => {
  const { QUOTA_TOOLTIP_HEADROOM_H } = await import('../src/utils/pet-window-height.ts')
  const runtime = readFileSync('electron/main/runtime.ts', 'utf8')
  assert.match(runtime, new RegExp(`PET_WINDOW_TOP_HEADROOM = ${QUOTA_TOOLTIP_HEADROOM_H}\\b`))
  assert.match(readFileSync('src/styles/tokens.css', 'utf8'), new RegExp(`--pet-bubble-headroom: ${QUOTA_TOOLTIP_HEADROOM_H}px;`))
  const bubble = readFileSync('src/components/permission/PermissionBubble.vue', 'utf8')
  assert.match(bubble, /\.permission-request \{[^}]*max-height: calc\(var\(--pet-bubble-headroom\) - 4px\);[^}]*flex-direction: column;/)
  // 只有指令細節區會縮短或捲動；標題、風險徽章、倒數與按鈕不縮。
  assert.match(bubble, /\.permission-request > \* \{\n {2}flex: none;\n\}/)
  assert.match(bubble, /\.permission-request > \.permission-details \{[^}]*min-height: 0;[^}]*overflow-y: auto;/)
})

test('state dots stay visible under forced colors (the shape still carries the state)', () => {
  assert.match(readFileSync('src/components/DesktopPet.css', 'utf8'), /@media \(forced-colors: active\) \{\n {2}\.line-dot \{\n {4}background: CanvasText !important;/)
  assert.match(readFileSync('src/components/StatusPanel.css', 'utf8'), /@media \(forced-colors: active\) \{\n {2}\.status-panel :deep\(\.session-status-dot\) \{\n {4}background: CanvasText;/)
})
