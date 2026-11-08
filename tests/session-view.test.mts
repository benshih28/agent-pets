import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentSession } from '../src/types/agent.ts'
import { countByBucket, formatElapsed, groupSessions, projectLabels, sessionBucket } from '../src/utils/session-view.ts'

const make = (key: string, state: AgentSession['state'], lastSeenAt: number, source: AgentSession['source'] = 'claude'): AgentSession => (
  { key, source, sessionId: key, state, lastSeenAt }
)

const sessions = [
  make('a', 'thinking', 30),
  make('b', 'waiting-permission', 10, 'codex'),
  make('c', 'success', 50),
  make('d', 'offline', 5),
  make('e', 'error', 40, 'codex-desktop'),
  make('f', 'offline', 9),
]

test('sessions are bucketed by urgency', () => {
  assert.equal(sessionBucket('waiting-input'), 'attention')
  assert.equal(sessionBucket('error'), 'attention')
  assert.equal(sessionBucket('tool-running'), 'running')
  assert.equal(sessionBucket('idle'), 'other')
  assert.deepEqual(countByBucket(sessions), { attention: 2, running: 1, other: 1 })
})

test('grouping applies filter, source family and sort; offline ignores the urgency filter', () => {
  const all = groupSessions(sessions, { filter: 'all', sources: null, sort: 'recent' })
  assert.deepEqual(all.attention.map(s => s.key), ['e', 'b'])
  assert.deepEqual(all.offline.map(s => s.key), ['f', 'd'])
  const attention = groupSessions(sessions, { filter: 'attention', sources: null, sort: 'priority' })
  assert.deepEqual(attention.running, [])
  assert.equal(attention.offline.length, 2)
  const codex = groupSessions(sessions, { filter: 'all', sources: ['codex', 'codex-desktop'], sort: 'priority' })
  assert.deepEqual([...codex.attention, ...codex.running, ...codex.other].map(s => s.key), ['b', 'e'])
})

test('duplicate project names get their parent directory', () => {
  const labels = projectLabels(['/work/app', '/play/app', '/work/docs', undefined])
  assert.equal(labels.get('/work/app'), 'work/app')
  assert.equal(labels.get('/play/app'), 'play/app')
  assert.equal(labels.get('/work/docs'), 'docs')
  assert.equal(projectLabels(['C:\\code\\web']).get('C:\\code\\web'), 'web')
})

test('elapsed time is compact', () => {
  assert.equal(formatElapsed(-5), '0s')
  assert.equal(formatElapsed(12_400), '12s')
  assert.equal(formatElapsed(65_000), '1:05')
  assert.equal(formatElapsed(3_723_000), '1:02:03')
})
