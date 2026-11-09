import assert from 'node:assert/strict'
import test from 'node:test'
import { createPluginThemeApplier, type PluginThemeDocument } from '../electron/plugin-theme-apply.ts'
import { buildPluginThemeSnapshot } from '../electron/plugin-theme-tokens.ts'
import { PLUGIN_THEME_TOKENS } from '../src/types/plugin-theme.ts'

// M5：插件頁面的 `--ap-*` 在頁面的第一個 script 前就生效（preload 執行時 <html> 還不存在）。

function styleTarget() {
  const values = new Map<string, string>()
  return { values, setProperty: (name: string, value: string) => { values.set(name, value) } }
}

function fakeDocument() {
  let ready: (() => void) | null = null
  const inline = styleTarget()
  const document = {
    documentElement: null as { style: ReturnType<typeof styleTarget> } | null,
    adoptedStyleSheets: ['page-sheet'] as unknown[],
    addEventListener: (_type: string, listener: () => void) => { ready = listener },
  }
  return {
    document,
    inline,
    createHtml: () => { document.documentElement = { style: inline } },
    fireReady: () => ready?.(),
  }
}

test('tokens land in an adopted :root rule before <html> exists, then inline on <html>', () => {
  const page = fakeDocument()
  const rule = styleTarget()
  const apply = createPluginThemeApplier(page.document as unknown as PluginThemeDocument, () => ({ sheet: 'theme-sheet', rule }))
  assert.deepEqual(page.document.adoptedStyleSheets, ['page-sheet', 'theme-sheet'], "the page's own adopted sheets are kept")
  const dark = buildPluginThemeSnapshot(null, 'dark')
  apply(dark)
  assert.deepEqual([...rule.values.keys()].sort(), [...PLUGIN_THEME_TOKENS].sort())
  assert.equal(rule.values.get('--ap-bg'), dark.tokens['--ap-bg'])
  assert.equal(page.inline.values.size, 0)
  page.createHtml()
  page.fireReady()
  assert.equal(page.inline.values.get('--ap-surface'), dark.tokens['--ap-surface'])

  const light = buildPluginThemeSnapshot(null, 'light')
  apply(light)
  assert.equal(rule.values.get('--ap-bg'), light.tokens['--ap-bg'])
  assert.equal(page.inline.values.get('--ap-bg'), light.tokens['--ap-bg'])
})

test('anything that is not a whitelisted snapshot is ignored', () => {
  const page = fakeDocument()
  const rule = styleTarget()
  const apply = createPluginThemeApplier(page.document as unknown as PluginThemeDocument, () => ({ sheet: 'theme-sheet', rule }))
  const snapshot = buildPluginThemeSnapshot(null, 'dark')
  for (const value of [
    null,
    { ok: true },
    { ...snapshot, tokens: { ...snapshot.tokens, '--ap-bg': 'red; background: url(https://example.com)' } },
    { ...snapshot, tokens: { ...snapshot.tokens, '--evil': '1' } },
    { ...snapshot, apiVersion: 2 },
  ]) apply(value)
  assert.equal(rule.values.size, 0)
})

test('without constructable stylesheets the inline style still works', () => {
  const page = fakeDocument()
  page.createHtml()
  const apply = createPluginThemeApplier(page.document as unknown as PluginThemeDocument, () => { throw new Error('unsupported') })
  assert.deepEqual(page.document.adoptedStyleSheets, ['page-sheet'])
  const snapshot = buildPluginThemeSnapshot(null, 'light')
  apply(snapshot)
  assert.equal(page.inline.values.get('--ap-text'), snapshot.tokens['--ap-text'])
})
