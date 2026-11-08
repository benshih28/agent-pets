import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', 'src')

test('i18n keeps <html lang> in sync with the locale', () => {
  const src = readFileSync(join(root, 'i18n.ts'), 'utf8')
  assert.match(src, /'zh-TW':\s*'zh-TW'/)
  assert.match(src, /'en-US':\s*'en'/)
  assert.match(src, /syncDocumentLang\(next\)/)
})

test('every agent state has a localized aria label in both locales', () => {
  const states = ['offline', 'idle', 'thinking', 'tool-running', 'waiting-permission', 'waiting-input', 'success', 'error']
  for (const lang of ['zh-TW', 'en-US']) {
    const d = JSON.parse(readFileSync(join(root, 'locales', 'design', `${lang}.json`), 'utf8'))
    for (const s of states) assert.ok(d[`design.state.${s}`], `${lang} missing state ${s}`)
  }
})
