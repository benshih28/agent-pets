import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { analyze, summarize } from '../scripts/check-design-tokens.mjs'

function fixture(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'design-guard-'))
  for (const [rel, text] of Object.entries(files)) {
    const full = join(root, rel)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, text)
  }
  return root
}

const tokens = ':root {\n  --accent: #8b9cf7;\n  --used: 1px;\n  --dead: 2px;\n}'

test('flags undefined vars, bare colours, tiny fonts, literal blur and glyph icons', () => {
  const root = fixture({
    'src/styles/tokens.css': tokens,
    'src/a.css': '.a { color: var(--accent); background: var(--nope); border-color: #fff; box-shadow: rgba(0,0,0,.2); font-size: 10px; backdrop-filter: blur(6px); margin: var(--used); }',
    'src/B.vue': '<template><button>×</button></template>\n<style scoped>.b { color: var(--accent, red); }</style>',
  })
  const { findings, info } = analyze(root)
  const rules = new Set(findings.map((f) => f.rule))
  for (const rule of ['undefined-var', 'bare-color', 'small-font', 'literal-blur', 'glyph-icon']) assert.ok(rules.has(rule), rule)
  assert.deepEqual(findings.filter((f) => f.rule === 'undefined-var').map((f) => f.text), ['--nope'])
  assert.deepEqual(info.unused, ['--dead'])
  assert.ok(info.rawControls.length >= 1)
})

test('tokens.css itself may contain literals; clean sources produce no findings', () => {
  const root = fixture({
    'src/styles/tokens.css': tokens,
    'src/ok.css': '.ok { color: var(--accent); font-size: 12px; }',
  })
  assert.equal(analyze(root).findings.length, 0)
  assert.deepEqual(summarize(analyze(root)).byRule, {})
})

test('report-only by default, --strict fails on findings', () => {
  const script = join(import.meta.dirname, '..', 'scripts', 'check-design-tokens.mjs')
  const lax = spawnSync(process.execPath, [script], { encoding: 'utf8' })
  assert.equal(lax.status, 0)
  assert.match(lax.stdout, /design-token report:/)
})
