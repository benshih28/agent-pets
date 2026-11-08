import assert from 'node:assert/strict'
import test from 'node:test'
import { createAgentAdapterRegistry, projectAdapterCapabilities } from '../electron/agent-adapter.ts'
import { assertAgentAdapterContract } from './fixtures/agent-adapter-contract.mts'
import type { AgentAdapter } from '../src/types/agent-adapter.ts'
import type { AgentStatusEvent } from '../src/types/agent.ts'
import { GENERIC_HTTP_CAPABILITIES } from '../src/types/capabilities.ts'

test('built-in adapters expose a stable contract and diagnostics', async () => {
  const registry = createAgentAdapterRegistry()
  const statuses = await registry.listStatuses()
  assert.deepEqual(
    statuses.map(status => status.id),
    ['opencode', 'codex', 'claude-code', 'generic-http'],
  )

  for (const adapter of registry.adapters) {
    const source = adapter.sources[0] ?? 'codex'
    await assertAgentAdapterContract(adapter, source)
  }
})

test('adapter ingress selects the source adapter and blocks mismatched claims', async () => {
  const registry = createAgentAdapterRegistry()
  const base = {
    source: 'codex',
    sessionId: 'fixture-session',
    state: 'thinking',
    timestamp: 42,
  }

  const sourceSelected = await registry.normalize(base, 100)
  assert.equal(sourceSelected.ok, true)
  if (sourceSelected.ok) assert.equal(sourceSelected.event.adapterId, 'codex')

  const genericSelected = await registry.normalize({ ...base, adapterId: 'generic-http' }, 101)
  assert.equal(genericSelected.ok, true)
  if (genericSelected.ok) assert.equal(genericSelected.event.adapterId, 'generic-http')

  const mismatched = await registry.normalize({ ...base, source: 'claude', adapterId: 'codex' }, 102)
  assert.deepEqual(mismatched, { ok: false, error: 'adapter_claim_not_allowed' })

  const unknown = await registry.normalize({ ...base, adapterId: 'untrusted-adapter' }, 103)
  assert.deepEqual(unknown, { ok: false, error: 'unknown_adapter' })
})

test('generic HTTP remains observe-only at the capability boundary', async () => {
  const registry = createAgentAdapterRegistry()
  const generic = registry.adapters.find(adapter => adapter.id === 'generic-http')
  assert.ok(generic)
  assert.equal(generic.capabilities.permissions, 'none')
  assert.deepEqual(generic.capabilities.permissionModes, [])
  assert.equal(generic.capabilities.healthCheck, false)
})

test('fixture-only adapters can satisfy the contract without product changes', async () => {
  const fixtureAdapter: AgentAdapter = {
    id: 'generic-http',
    displayName: 'Fixture Adapter',
    adapterVersion: 'fixture-1',
    sources: ['codex'],
    capabilities: GENERIC_HTTP_CAPABILITIES,
    detect: async () => ({
      installed: true,
      health: 'ready',
      message: 'Fixture only.',
      capabilities: GENERIC_HTTP_CAPABILITIES,
      sources: ['codex'],
      sourceLabels: ['Codex fixture'],
      installable: false,
    }),
    install: async () => (await fixtureAdapter.detect({ now: () => Date.now() })),
    uninstall: async () => (await fixtureAdapter.detect({ now: () => Date.now() })),
    diagnose: async context => ({
      adapterId: 'generic-http',
      health: 'ready',
      checkedAt: context.now(),
      checks: [{ id: 'fixture', status: 'pass', message: 'Fixture contract only.' }],
    }),
    normalize: async (_input, _context, receivedAt = Date.now()) => {
      const event: AgentStatusEvent = {
        adapterId: 'generic-http',
        source: 'codex',
        sessionId: 'fixture-only',
        state: 'thinking',
        timestamp: receivedAt,
      }
      return { ok: true, event }
    },
  }

  await assertAgentAdapterContract(fixtureAdapter, 'codex')
})

test('Claude Code reports respond only while answering from the pet is turned on', async () => {
  let enabled = false
  const registry = createAgentAdapterRegistry({
    inspect: () => ({ installed: true, health: 'ready', message: 'fixture', checks: [] }),
    install: () => {},
    uninstall: () => {},
    capabilities: (id, base) => projectAdapterCapabilities(id, base, enabled),
  })
  const claude = async () => (await registry.listStatuses()).find(status => status.id === 'claude-code')!
  assert.equal((await claude()).capabilities.permissions, 'observe')
  assert.deepEqual((await claude()).capabilities.permissionModes, [])

  enabled = true
  const on = (await claude()).capabilities
  assert.equal(on.permissions, 'respond')
  assert.deepEqual(on.permissionModes, ['allow_once', 'deny'])
  assert.ok(Object.isFrozen(on))
  const statuses = await registry.listStatuses()
  assert.equal(statuses.find(status => status.id === 'codex')!.capabilities.permissions, 'observe')
  assert.equal(statuses.find(status => status.id === 'generic-http')!.capabilities.permissions, 'none')

  // The static registry entry (README source of truth) never changes.
  assert.equal(registry.adapters.find(adapter => adapter.id === 'claude-code')!.capabilities.permissions, 'observe')
})
