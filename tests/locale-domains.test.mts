import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', 'src', 'locales')
const read = (p: string): Record<string, string> => JSON.parse(readFileSync(p, 'utf8'))
const domains = readdirSync(root).filter((d) => statSync(join(root, d)).isDirectory())

test('domain locale files have identical key sets, a domain prefix, and no clash with the main catalog', () => {
  const main = new Set(Object.keys(read(join(root, 'zh-TW.json'))))
  const seen = new Set<string>()
  for (const domain of domains) {
    const zh = read(join(root, domain, 'zh-TW.json'))
    const en = read(join(root, domain, 'en-US.json'))
    assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort(), `${domain}: zh-TW/en-US key mismatch`)
    for (const key of Object.keys(zh)) {
      assert.ok(key.startsWith(`${domain}.`), `${domain}: key ${key} must start with "${domain}."`)
      assert.ok(!main.has(key), `${domain}: key ${key} duplicates the main catalog`)
      assert.ok(!seen.has(key), `${domain}: key ${key} duplicated across domains`)
      seen.add(key)
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort()
      assert.deepEqual(ph(en[key]), ph(zh[key]), `${domain}: placeholder mismatch for ${key}`)
    }
  }
})

test('every panel-domain key is referenced by the renderer source', () => {
  const sourceRoot = join(import.meta.dirname, '..', 'src')
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (full.includes(`${join('src', 'locales')}`)) continue
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.(vue|ts)$/.test(name)) files.push(full)
    }
  }
  walk(sourceRoot)
  const text = files.map((file) => readFileSync(file, 'utf8')).join('\n')
  const unused = Object.keys(read(join(root, 'panel', 'zh-TW.json'))).filter((key) => !text.includes(`'${key}'`) && !text.includes(`"${key}"`))
  assert.deepEqual(unused, [])
})

test('every theme-editor key is used: literally, or through the colour, pill, state and font tables', async () => {
  const { USER_PANEL_THEME_COLOR_KEYS, USER_PANEL_THEME_FONT_STACK_IDS, USER_PANEL_THEME_PET_STATUS_KEYS } = await import('../src/types/panel-theme-user.ts')
  const sourceRoot = join(import.meta.dirname, '..', 'src', 'components', 'panel-theme')
  const text = [
    ...readdirSync(sourceRoot).filter(name => name.endsWith('.vue')).map(name => readFileSync(join(sourceRoot, name), 'utf8')),
    readFileSync(join(import.meta.dirname, '..', 'src', 'utils', 'panel-theme-issue-text.ts'), 'utf8'),
  ].join('\n')
  const dynamic = new Set<string>([
    ...USER_PANEL_THEME_COLOR_KEYS.flatMap(key => [`themeEditor.key.${key}`, `themeEditor.usage.${key}`]),
    ...USER_PANEL_THEME_PET_STATUS_KEYS.flatMap(key => [`themeEditor.petKey.${key}`, `themeEditor.petUsage.${key}`]),
    ...['dangerText', 'successText', 'warnText', 'infoText'].map(key => `themeEditor.meaning.${key}`),
    ...['black', 'white'].map(key => `themeEditor.desktop.${key}`),
  ])
  const keys = Object.keys(read(join(root, 'themeEditor', 'zh-TW.json')))
  for (const key of dynamic) assert.ok(keys.includes(key), `missing ${key}`)
  for (const id of USER_PANEL_THEME_FONT_STACK_IDS) assert.ok(text.includes(`'themeEditor.font.${id}'`), `font label ${id}`)
  const unused = keys.filter(key => !dynamic.has(key) && !text.includes(`'${key}'`))
  assert.deepEqual(unused, [])
})
