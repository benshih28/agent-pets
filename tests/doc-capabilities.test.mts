import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { AGENT_ADAPTER_REGISTRY } from '../src/types/agent-adapter.ts'

// README capability tables must not drift from the adapter registry (single source of truth).
const NAMES: Record<string, string> = { OpenCode: 'opencode', Codex: 'codex', 'Claude Code': 'claude-code' }

for (const file of ['README.md', 'README.zh-TW.md']) {
  test(`${file} supported-agents table matches adapter capabilities`, () => {
    const lines = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').split('\n')
    let checked = 0
    for (const line of lines) {
      const cells = line.split('|').map(cell => cell.trim()).filter(Boolean)
      const id = NAMES[cells[0] ?? '']
      if (!id || cells.length < 6) continue
      const definition = AGENT_ADAPTER_REGISTRY.find(entry => entry.id === id)!
      const { permissions, quota, tokenUsage } = definition.capabilities
      assert.ok(cells[3]!.startsWith(permissions), `${file} ${id}: permission cell "${cells[3]}" vs ${permissions}`)
      assert.equal(cells[4] === '—' ? 'none' : cells[4], quota, `${file} ${id}: quota`)
      assert.equal(cells[5] === '—' ? 'none' : cells[5], tokenUsage, `${file} ${id}: token usage`)
      checked += 1
    }
    assert.equal(checked, 3)
  })
}
