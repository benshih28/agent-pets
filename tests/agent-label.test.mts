import test from 'node:test'
import assert from 'node:assert/strict'
import { agentDisplayName } from '../src/utils/agent-label.ts'
import { getLocale, setLocale, t } from '../src/i18n.ts'
import { AGENT_ADAPTER_REGISTRY } from '../src/types/agent-adapter.ts'

// History 會出現的 adapter id：registry 的四個，加上 history.ts 對空值的 'unknown'。
const HISTORY_IDS = {
  codex: 'Codex',
  'claude-code': 'Claude Code',
  opencode: 'OpenCode',
  'generic-http': 'generic-http',
  unknown: 'unknown',
} as const

test('History adapter ids keep their display names in every locale', () => {
  assert.deepEqual(AGENT_ADAPTER_REGISTRY.map(adapter => adapter.id).sort(), Object.keys(HISTORY_IDS).filter(id => id !== 'unknown').sort())
  const previous = getLocale()
  try {
    for (const locale of ['zh-TW', 'en-US'] as const) {
      setLocale(locale)
      for (const [id, expected] of Object.entries(HISTORY_IDS)) assert.equal(agentDisplayName(id), expected, `${locale} ${id}`)
      assert.equal(agentDisplayName('codex'), t('clientCodex'))
      assert.equal(agentDisplayName('claude-code'), t('clientClaudeCode'))
      assert.equal(agentDisplayName('opencode'), t('clientOpenCode'))
    }
  } finally {
    setLocale(previous)
  }
})

test('unknown ids are shown as-is, even when they contain a family name', () => {
  for (const id of ['my-codex-fork', 'claude', 'Codex', 'opencode-cli', 'constructor', '__proto__', '']) {
    assert.equal(agentDisplayName(id), id)
  }
})
