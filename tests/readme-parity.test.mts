import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')
const en = read('README.md')
const zh = read('README.zh-TW.md')

const headings = (text: string, level: string) => text.split('\n').filter(line => line.startsWith(`${level} `)).length

test('README and README.zh-TW keep the same top-level structure', () => {
  assert.equal(headings(en, '##'), headings(zh, '##'))
  for (const marker of ['Troubleshooting', '疑難排解']) {
    assert.ok(en.includes(marker) || zh.includes(marker))
  }
})

test('READMEs no longer reference removed UI paths or the wrong OpenCode MCP shape', () => {
  for (const text of [en, zh]) {
    assert.doesNotMatch(text, /Settings → Attention/)
    assert.doesNotMatch(text, /⚙ → Setup Wizard/)
    assert.match(text, /Gatekeeper/)
    assert.match(text, /SmartScreen/)
    for (const line of text.split('\n')) {
      if (line.includes('mcp.servers')) assert.match(line, /migrat|遷移/, `unexpected legacy format mention: ${line.slice(0, 80)}`)
    }
  }
})

test('READMEs keep parallel sub-headings and name the real release artifacts', () => {
  assert.equal(headings(en, '###'), headings(zh, '###'))
  for (const text of [en, zh]) {
    assert.match(text, /AgentPets-<version>\.exe/)
    assert.doesNotMatch(text, /Agent Pets\.exe/)
    assert.doesNotMatch(text, /pnpm 11/)
  }
})
