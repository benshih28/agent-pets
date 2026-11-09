import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { analyze, shouldFail, summarize } from '../scripts/check-design-tokens.mjs'

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

test('raw-color inventories literal colours by surface outside the theme palette source', () => {
  const root = fixture({
    'src/styles/tokens.css': ':root {\n  --builtin-organic-bg: #f5ead8;\n  --pet-bubble-text: #fff;\n  --surface-panel: rgba(0, 0, 0, 0.5);\n  --gap: 4px;\n}',
    'src/components/ui/Button.vue': '<template><b /></template>\n<style scoped>\n.b:hover { background: color-mix(in srgb, var(--accent) 88%, black); white-space: nowrap; }\n</style>',
    'src/components/DesktopPet.css': '.badge { color: white; border: 1px solid transparent; }',
    'src/types/agent.ts': "// '#123456' in a comment is ignored\nexport const C = { idle: '#8a8a8a', glow: 'rgb(1, 2, 3)', pattern: 'rgb(${r} ${g} ${b})' }",
  })
  const result = analyze(root)
  const rows = result.info.rawColors.map((entry: { group: string; file: string; value: string }) => `${entry.group}|${entry.file}|${entry.value}`)
  assert.deepEqual(rows.sort(), [
    'agent-state-colours|src/types/agent.ts|#8a8a8a',
    'agent-state-colours|src/types/agent.ts|rgb(1, 2, 3)',
    'pet-bubbles|src/styles/tokens.css|#fff',
    'pet-window-chrome|src/components/DesktopPet.css|white',
    'shared-controls|src/components/ui/Button.vue|color-mix(in srgb, var(--accent) 88%, black)',
    'shared-glass-layer|src/styles/tokens.css|rgba(0, 0, 0, 0.5)',
  ])
  assert.equal(summarize(result).rawColors, 6)
  // 基準模式：--strict 不因 raw-color 失敗，--raw-colors=fail 才會。
  assert.equal(shouldFail(result, { strict: true }), result.findings.length > 0)
  assert.equal(shouldFail(result, { rawColorsFail: true }), true)
  const clean = analyze(fixture({ 'src/styles/tokens.css': ':root {\n  --builtin-organic-bg: #f5ead8;\n}', 'src/a.css': '.a { color: var(--builtin-organic-bg); }' }))
  assert.equal(shouldFail(clean, { strict: true, rawColorsFail: true }), false)
})

test('raw-color reads whole declarations, so multi-line values and their start line are reported', () => {
  const root = fixture({
    'src/styles/tokens.css': ':root {\n  --shadow-panel:\n    0 18px 40px rgba(0, 0, 0, 0.4),\n    inset 0 1px 0 var(--x);\n  --icon: url("data:image/svg+xml;utf8,<svg/>");\n}',
  })
  const rows = analyze(root).info.rawColors.map((entry: { token: string; line: number; value: string }) => `${entry.token}|${entry.line}|${entry.value}`)
  assert.deepEqual(rows, ['--shadow-panel|2|0 18px 40px rgba(0, 0, 0, 0.4), inset 0 1px 0 var(--x)'])
})
