import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'

const root = new URL('../src/', import.meta.url)
const tokens = readFileSync(new URL('styles/tokens.css', root), 'utf8')
const defined = new Set([...tokens.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(match => match[1]))

const files = [
  ...readdirSync(new URL('components/plugin-panel/', root)).map(name => `components/plugin-panel/${name}`),
  'components/PluginPanel.vue',
  'components/PluginPanel.css',
  ...['SegmentedTabs', 'ActionMenu', 'Chip', 'NumberField', 'Spinner'].map(name => `components/ui/${name}.vue`),
].filter(name => /\.(vue|css)$/.test(name))

test('plugin area styles only use design tokens that exist', () => {
  for (const file of files) {
    const source = readFileSync(new URL(file, root), 'utf8')
    for (const match of source.matchAll(/var\((--[a-z0-9-]+)(?:\s*,[^)]*)?\)/g)) {
      const token = match[1]
      // A token with an explicit fallback in the same var() is allowed to be theme-provided.
      if (match[0].includes(',')) continue
      assert.ok(defined.has(token), `${file} uses undefined token ${token}`)
    }
  }
})

test('plugin area templates use shared primitives instead of raw form controls', () => {
  for (const file of files.filter(name => name.endsWith('.vue') && name.includes('plugin-panel/'))) {
    const source = readFileSync(new URL(file, root), 'utf8')
    const template = source.split('<script')[0] + (source.match(/<template>[\s\S]*<\/template>/)?.[0] ?? '')
    assert.doesNotMatch(template, /<select[\s>]/, `${file} uses a raw <select>`)
    assert.doesNotMatch(template, /<input[\s>]/, `${file} uses a raw <input>`)
    assert.doesNotMatch(template, /window\.(confirm|alert)\(/, `${file} calls a native dialog`)
  }
})
