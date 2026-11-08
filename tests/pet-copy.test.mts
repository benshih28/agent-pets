import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const surfaces = ['../src/components/DesktopPet.vue', '../src/components/PetAnimation.vue']

test('pet surfaces carry no emoji or glyph icons', () => {
  for (const path of surfaces) {
    const source = read(path)
    assert.doesNotMatch(source, /[\u{1F300}-\u{1FAFF}\u2726\u2713\u2715]/u, `${path} contains a glyph icon`)
  }
})

test('the status line localizes states instead of printing the English labels', () => {
  const source = read('../src/components/DesktopPet.vue')
  assert.doesNotMatch(source, /STATE_LABELS_SHORT/)
  assert.match(source, /stateAriaLabel\(line\.state\)/)
})

test('main-process import dialogs use localized titles', () => {
  const source = read('../electron/ipc/pet-assets.ts')
  assert.doesNotMatch(source, /title: '[^']*[\u4e00-\u9fff]/)
})
