import assert from 'node:assert/strict'
import test from 'node:test'
import { AgentSessionIndex } from '../src/utils/agent-session-index.ts'
import type { AgentSession, AgentState } from '../src/types/agent.ts'

const states: AgentState[] = ['offline', 'idle', 'thinking', 'tool-running', 'waiting-permission', 'waiting-input', 'success', 'error']

function random(seed: number): () => number {
  let value = seed >>> 0
  return () => {
    value = (value + 0x6D2B79F5) >>> 0
    let next = value
    next = Math.imul(next ^ (next >>> 15), next | 1)
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61)
    return ((next ^ (next >>> 14)) >>> 0) / 0x1_0000_0000
  }
}

function legacyUpsert(sessions: Record<string, AgentSession>, incoming: AgentSession, maximum: number): string | null {
  let evictedKey: string | null = null
  if (!sessions[incoming.key] && Object.keys(sessions).length >= maximum) {
    const values = Object.values(sessions)
    let candidate = values[0]
    for (const item of values) {
      const offlineDelta = Number(item.state !== 'offline') - Number(candidate.state !== 'offline')
      if (offlineDelta < 0 || (offlineDelta === 0 && item.lastSeenAt < candidate.lastSeenAt)) candidate = item
    }
    evictedKey = candidate?.key ?? null
    if (evictedKey) delete sessions[evictedKey]
  }
  sessions[incoming.key] = incoming
  return evictedKey
}

function snapshot(entries: Iterable<AgentSession>): Array<[string, AgentState, number]> {
  return [...entries].map(session => [session.key, session.state, session.lastSeenAt])
}

test('indexed session upsert preserves legacy eviction across 1,000 seeded streams', () => {
  const nextRandom = random(18_040)
  for (let batch = 0; batch < 1_000; batch += 1) {
    const limit = 4 + Math.floor(nextRandom() * 20)
    const legacy: Record<string, AgentSession> = {}
    const indexed = new AgentSessionIndex<AgentSession>()
    for (let step = 0; step < 120; step += 1) {
      const key = `session-${Math.floor(nextRandom() * (limit + 12))}`
      const incoming: AgentSession = {
        key,
        source: 'codex',
        sessionId: key,
        state: states[Math.floor(nextRandom() * states.length)],
        lastSeenAt: Math.floor(nextRandom() * 12),
      }
      const expectedEviction = legacyUpsert(legacy, { ...incoming }, limit)
      const actualEviction = indexed.upsert({ ...incoming }, limit)?.key ?? null
      assert.equal(actualEviction, expectedEviction, `batch ${batch}, step ${step}`)
      assert.deepEqual(snapshot(indexed.values()), snapshot(Object.values(legacy)), `batch ${batch}, step ${step}`)
    }
  }
})

test('priority updates, deletes, and reinsertions retain offline and insertion-order eviction rules', () => {
  const index = new AgentSessionIndex<AgentSession>()
  const create = (key: string, state: AgentState, lastSeenAt: number): AgentSession => ({
    key, source: 'codex', sessionId: key, state, lastSeenAt,
  })
  index.upsert(create('a', 'thinking', 1), 3)
  index.upsert(create('b', 'offline', 4), 3)
  index.upsert(create('c', 'offline', 4), 3)
  index.updatePriority('a', 'offline', 4)
  assert.equal(index.upsert(create('d', 'idle', 10), 3)?.key, 'a')
  assert.equal(index.delete('b')?.key, 'b')
  index.upsert(create('b', 'offline', 4), 3)
  assert.equal(index.upsert(create('e', 'error', 11), 3)?.key, 'c')
  assert.deepEqual([...index.values()].map(item => item.key), ['d', 'b', 'e'])
})
