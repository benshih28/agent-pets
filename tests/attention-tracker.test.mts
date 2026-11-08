import assert from 'node:assert/strict'
import test from 'node:test'
import { AttentionTracker } from '../electron/attention-tracker.ts'

const ev = (state: string, sessionId = 's1', source = 'claude') => ({ source, sessionId, state })

test('counts go down when the wait clears, instead of accumulating', () => {
  const tracker = new AttentionTracker()
  tracker.observeEvent(ev('waiting-input'))
  tracker.observeEvent(ev('waiting-permission', 's2'))
  assert.deepEqual(tracker.summary(), { permission: 0, external: 1, input: 1, total: 2 })
  tracker.observeEvent(ev('thinking'))
  tracker.observeEvent(ev('idle', 's2'))
  assert.equal(tracker.summary().total, 0)
})

test('repeated events for one wait are one item', () => {
  const tracker = new AttentionTracker()
  for (let i = 0; i < 5; i += 1) tracker.observeEvent(ev('waiting-input'))
  assert.equal(tracker.summary().input, 1)
})

test('a broker request and its waiting-permission event count once', () => {
  const tracker = new AttentionTracker()
  tracker.observeEvent(ev('waiting-permission', 'ses', 'opencode-cli'))
  tracker.setRequests([{ requestId: 'r1', agentId: 'opencode-cli', sessionId: 'ses' }])
  assert.deepEqual(tracker.summary(), { permission: 1, external: 0, input: 0, total: 1 })
  tracker.setRequests([])
  assert.equal(tracker.summary().external, 1)
})

test('stale waits expire and test events are ignored', () => {
  const tracker = new AttentionTracker()
  tracker.observeEvent(ev('waiting-input'), 0)
  assert.equal(tracker.summary(31 * 60_000).total, 0)
  assert.equal(tracker.observeEvent({ ...ev('waiting-input'), originalEvent: 'AgentPetsIntegrationTest' }), false)
})
