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
