import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  AGENT_FAMILY_KEYS,
  AGENT_STATES,
  AGENT_FAMILY_REGISTRY,
  AGENT_SOURCE_REGISTRY,
  ALL_SOURCES,
  FAMILY_ADAPTER_IDS,
  FAMILY_SOURCES,
  familyOfSource,
  familySourceSet,
  isAgentFamilyKey,
  isAgentSource,
  isDesktopSource,
  isQuotaCapableSource,
  isQuotaFamilyKey,
  LOCAL_USAGE_ADAPTER_IDS,
  LOCAL_USAGE_SOURCE_BY_ADAPTER,
  LOCAL_USAGE_SOURCES,
  QUOTA_FAMILY_KEYS,
  SOURCE_FAMILIES,
  SOURCE_LABELS,
} from '../src/types/agent.ts'
import { AGENT_ADAPTER_REGISTRY } from '../src/types/agent-adapter.ts'
import { classifyNotification } from '../electron/notification-policy.ts'
import { localUsageKeySource } from '../electron/history-sessions.ts'
import { PLUGIN_EVENT_SOURCE_RESERVED_FAMILIES } from '../electron/plugin-event-source.ts'
import { PERMISSION_ADAPTER_SOURCES } from '../electron/permission-adapter-server.ts'
import { normalizeAgentStatusEvent } from '../electron/event-normalizer.ts'
import { isIntegrationTarget } from '../electron/ipc/integrations.ts'

// 特性測試：數值是重構成來源 registry 前各處散落常數的實際內容。這些字串存在歷史資料庫、
// localStorage 與插件契約裡，任何一格變了都算外部契約改變，要先確認遷移方式。

const SOURCES = ['opencode-cli', 'opencode-desktop', 'codex', 'codex-desktop', 'claude', 'claude-desktop'] as const
const PROTOTYPE_NAMES = ['constructor', '__proto__', 'toString', 'hasOwnProperty']

test('every source and family has a row, in the established order', () => {
  assert.deepEqual(ALL_SOURCES, SOURCES)
  assert.deepEqual(Object.keys(AGENT_SOURCE_REGISTRY), SOURCES)
  // 狀態列與設定頁的家族順序。
  assert.deepEqual(AGENT_FAMILY_KEYS, ['codex', 'claude', 'opencode'])
  for (const source of SOURCES) {
    assert.ok(isAgentFamilyKey(AGENT_SOURCE_REGISTRY[source].family), source)
  }
  // 每個家族至少一個來源，且每個家族 adapter 都在 adapter registry 裡。
  const adapterIds = new Set(AGENT_ADAPTER_REGISTRY.map(definition => definition.id))
  for (const family of AGENT_FAMILY_KEYS) {
    assert.ok(FAMILY_SOURCES[family].length > 0, family)
    assert.ok(adapterIds.has(AGENT_FAMILY_REGISTRY[family].adapterId), family)
  }
})

test('labels, families and variants stay exactly as before', () => {
  assert.deepEqual(SOURCE_LABELS, {
    'opencode-cli': 'OpenCode CLI',
    'opencode-desktop': 'OpenCode Desktop',
    codex: 'Codex CLI',
    'codex-desktop': 'Codex Desktop',
    claude: 'Claude CLI',
    'claude-desktop': 'Claude Desktop',
  })
  assert.deepEqual(SOURCE_FAMILIES.map(family => ({ ...family, sources: [...family.sources] })), [
    { key: 'codex', label: 'Codex', sources: ['codex', 'codex-desktop'] },
    { key: 'claude', label: 'Claude', sources: ['claude', 'claude-desktop'] },
    { key: 'opencode', label: 'OpenCode', sources: ['opencode-cli', 'opencode-desktop'] },
  ])
  assert.deepEqual(SOURCES.filter(isDesktopSource), ['opencode-desktop', 'codex-desktop', 'claude-desktop'])
  assert.deepEqual(Object.fromEntries(AGENT_FAMILY_KEYS.map(family => [family, AGENT_FAMILY_REGISTRY[family].adapterId])), {
    codex: 'codex', claude: 'claude-code', opencode: 'opencode',
  })
  assert.deepEqual(FAMILY_ADAPTER_IDS, ['codex', 'claude-code', 'opencode'])
})

test('adapter registry sources and quota capability are derived from the family table', () => {
  const byId = new Map(AGENT_ADAPTER_REGISTRY.map(definition => [definition.id, definition]))
  assert.deepEqual([...byId.get('opencode')!.sources], ['opencode-cli', 'opencode-desktop'])
  assert.deepEqual([...byId.get('codex')!.sources], ['codex', 'codex-desktop'])
  assert.deepEqual([...byId.get('claude-code')!.sources], ['claude', 'claude-desktop'])
  assert.deepEqual([...byId.get('generic-http')!.sources], [])
  assert.deepEqual([...byId.get('claude-code')!.sourceLabels], ['Claude CLI', 'Claude Desktop'])
  for (const definition of AGENT_ADAPTER_REGISTRY) {
    if (definition.family === null) {
      assert.equal(definition.capabilities.quota, 'none', definition.id)
      continue
    }
    const family = AGENT_FAMILY_REGISTRY[definition.family]
    assert.equal(family.adapterId, definition.id)
    assert.equal(definition.capabilities.quota, family.quotaProvider ? 'provider' : 'none', definition.id)
    // 有本機紀錄的家族，token 才是 exact。
    assert.equal(definition.capabilities.tokenUsage === 'exact', family.localUsageSource !== null, definition.id)
  }
})

test('quota and local-usage facts match the previous hand-written tables', () => {
  assert.deepEqual(QUOTA_FAMILY_KEYS, ['codex', 'claude'])
  assert.deepEqual(SOURCES.filter(isQuotaCapableSource), ['codex', 'codex-desktop', 'claude', 'claude-desktop'])
  assert.deepEqual(LOCAL_USAGE_SOURCE_BY_ADAPTER, { codex: 'codex', 'claude-code': 'claude' })
  assert.deepEqual([...LOCAL_USAGE_ADAPTER_IDS], ['codex', 'claude-code'])
  assert.deepEqual([...LOCAL_USAGE_SOURCES], ['codex', 'codex-desktop', 'claude', 'claude-desktop'])
  // 歷史資料庫的 session 摘要用這個字串組 key；值一變，已存的 token 就對不上。
  assert.equal(localUsageKeySource('claude-code', 'raw'), 'claude-code:claude:raw')
  assert.equal(localUsageKeySource('codex', 'raw'), 'codex:codex:raw')
  assert.equal(localUsageKeySource('opencode', 'raw'), null)
  assert.equal(localUsageKeySource('generic-http', 'raw'), null)
})

test('main-process allowlists keep their previous members', () => {
  assert.deepEqual(PERMISSION_ADAPTER_SOURCES, ['opencode-cli', 'opencode-desktop', 'claude', 'claude-desktop'])
  assert.deepEqual([...familySourceSet('claude')], ['claude', 'claude-desktop'])
  assert.deepEqual([...PLUGIN_EVENT_SOURCE_RESERVED_FAMILIES].sort(), [
    'agent-pets', 'claude', 'claude-code', 'claude-desktop', 'codex', 'codex-desktop',
    'generic-http', 'opencode', 'opencode-cli', 'opencode-desktop', 'plugin', 'system',
  ])
  for (const target of ['opencode', 'codex', 'claude', 'claudeCode']) assert.equal(isIntegrationTarget(target), true, target)
  for (const target of ['claude-code', 'all', '', ...PROTOTYPE_NAMES, 1, null]) assert.equal(isIntegrationTarget(target), false, String(target))
})

test('notification titles use the family name for every source', () => {
  const names = SOURCES.map((source) => {
    const candidate = classifyNotification({ source, sessionId: 's', state: 'error', timestamp: 1 })
    assert.ok(candidate, source)
    return candidate.title
  })
  for (const [index, source] of SOURCES.entries()) {
    assert.ok(names[index].includes(AGENT_FAMILY_REGISTRY[AGENT_SOURCE_REGISTRY[source].family].label), source)
  }
})

test('the event normalizer accepts registry sources plus the legacy opencode alias only', () => {
  for (const source of SOURCES) {
    const result = normalizeAgentStatusEvent({ source, sessionId: 's', state: 'idle', timestamp: 1 })
    assert.equal(result.ok && result.event.source, source)
  }
  const legacy = normalizeAgentStatusEvent({ source: 'opencode', sessionId: 's', state: 'idle', timestamp: 1 })
  assert.equal(legacy.ok && legacy.event.source, 'opencode-cli')
  for (const source of ['claude-code', 'generic-http', ...PROTOTYPE_NAMES]) {
    assert.deepEqual(normalizeAgentStatusEvent({ source, sessionId: 's', state: 'idle', timestamp: 1 }), { ok: false, error: 'invalid source' })
  }
})

test('guards reject prototype names and non-strings', () => {
  for (const value of [...PROTOTYPE_NAMES, '', 'Claude', 1, null, undefined, {}]) {
    assert.equal(isAgentSource(value), false, String(value))
    assert.equal(isAgentFamilyKey(value), false, String(value))
    assert.equal(isQuotaFamilyKey(value), false, String(value))
  }
  for (const value of PROTOTYPE_NAMES) {
    assert.equal(familyOfSource(value), null)
    assert.equal(isDesktopSource(value), false)
    assert.equal(isQuotaCapableSource(value), false)
    assert.equal(localUsageKeySource(value, 'raw'), null)
  }
  assert.equal(isQuotaFamilyKey('opencode'), false)
})

test('the registries and every derived table are frozen', () => {
  const tables: unknown[] = [
    AGENT_SOURCE_REGISTRY, AGENT_FAMILY_REGISTRY, ALL_SOURCES, AGENT_FAMILY_KEYS, SOURCE_LABELS,
    FAMILY_SOURCES, SOURCE_FAMILIES, QUOTA_FAMILY_KEYS, FAMILY_ADAPTER_IDS, LOCAL_USAGE_SOURCE_BY_ADAPTER,
    PERMISSION_ADAPTER_SOURCES,
    ...Object.values(AGENT_SOURCE_REGISTRY), ...Object.values(AGENT_FAMILY_REGISTRY),
    ...Object.values(FAMILY_SOURCES), ...SOURCE_FAMILIES,
  ]
  for (const table of tables) assert.ok(Object.isFrozen(table))
  assert.throws(() => { (AGENT_SOURCE_REGISTRY.claude as { family: string }).family = 'codex' }, TypeError)
  assert.throws(() => { (AGENT_FAMILY_REGISTRY.claude as { quotaProvider: boolean }).quotaProvider = false }, TypeError)
  assert.throws(() => { (FAMILY_SOURCES.claude as string[]).push('codex') }, TypeError)
})

// hook 是獨立部署的腳本，不能 import registry，所以只能從原始碼讀出它手寫的來源清單比對。
test('the hook script only sends sources the registry knows', () => {
  const hook = readFileSync(new URL('../integrations/agent-hook.mjs', import.meta.url), 'utf8')
  const match = hook.match(/^const validSources = \[([^\]]*)\]/m)
  assert.ok(match, 'validSources literal not found in agent-hook.mjs')
  const sources = [...match[1].matchAll(/'([^']+)'/g)].map(m => m[1])
  assert.ok(sources.length > 0)
  for (const source of sources) assert.ok(isAgentSource(source), source)
})

test('the event normalizer accepts every registry state plus the legacy waiting state', () => {
  const base = { source: 'claude', sessionId: 's1', timestamp: 1 }
  for (const state of AGENT_STATES) {
    const result = normalizeAgentStatusEvent({ ...base, state }, 2)
    assert.equal(result.ok, true, state)
  }
  const legacy = normalizeAgentStatusEvent({ ...base, state: 'waiting' }, 2)
  assert.ok(legacy.ok && legacy.event.state === 'waiting-permission')
  assert.deepEqual(normalizeAgentStatusEvent({ ...base, state: 'constructor' }, 2), { ok: false, error: 'invalid state' })
})
