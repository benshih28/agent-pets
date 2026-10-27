import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PRESENTATION_MAX_MESSAGE_LENGTH,
  PRESENTATION_MAX_QUEUE_DEPTH,
  PRESENTATION_MAX_CLIENT_REQUESTS,
  PresentationController,
  normalizePresentationInput,
  normalizePresentationMessage,
  normalizePresentationStatus,
} from '../electron/presentation-controller.ts'

test('presentation input is bounded plain text and rejects markup/control payloads', () => {
  assert.equal(normalizePresentationMessage('  hello <script>alert(1)</script>\nworld  '), 'hello script alert(1) /script world')
  assert.equal(normalizePresentationMessage('x'.repeat(PRESENTATION_MAX_MESSAGE_LENGTH + 1)), null)
  assert.equal(normalizePresentationInput({ kind: 'say', message: '<b>hello</b>', ttlMs: 1_000 }).ok, true)
  assert.equal(normalizePresentationInput({ kind: 'react', reaction: 'explode' }).ok, false)
  assert.equal(normalizePresentationInput({ kind: 'say', message: 'hello', ttlMs: 999 }).ok, false)
})

test('presentation controller enforces block, per-client rate, TTL and disconnect cleanup', (t) => {
  let now = 10_000
  const emitted: string[] = []
  let blocked: 'disabled' | 'dnd_enabled' | null = null
  const controller = new PresentationController({
    now: () => now,
    createId: (() => {
      let index = 0
      return () => `intent-${++index}`
    })(),
    emit: intent => emitted.push(intent.id),
    getStatus: () => ({ activePets: [], dnd: blocked === 'dnd_enabled', enabled: blocked !== 'disabled' }),
    getBlockReason: () => blocked,
  })
  t.after(() => controller.clear())
  const client = 'client-12345678'

  blocked = 'disabled'
  assert.equal(controller.submit(client, { kind: 'react', reaction: 'happy' }).error, 'disabled')
  blocked = null
  assert.equal(controller.submit(client, { kind: 'react', reaction: 'happy', ttlMs: 1_000 }).accepted, true)
  assert.equal(controller.submit(client, { kind: 'say', message: 'one' }).accepted, true)
  assert.equal(controller.submit(client, { kind: 'say', message: 'two' }).accepted, true)
  assert.equal(controller.submit(client, { kind: 'say', message: 'three' }).error, 'rate_limited')
  assert.deepEqual(emitted, ['intent-1', 'intent-2', 'intent-3'])

  now += 10_001
  controller.cleanupExpired()
  assert.equal(controller.submit(client, { kind: 'say', message: 'after window' }).accepted, true)
  assert.equal(controller.disconnectClient(client), 1)
  assert.equal(controller.getQueueDepth(), 0)
  controller.clear()
})

test('presentation queue has a bounded depth and status projection is sanitized', (t) => {
  let now = 1_000
  const controller = new PresentationController({
    now: () => now,
    emit: () => {},
    getStatus: () => ({ activePets: [], dnd: false, enabled: true }),
    getBlockReason: () => null,
  })
  t.after(() => controller.clear())
  const client = 'client-queue-1234'
  for (let i = 0; i < PRESENTATION_MAX_CLIENT_REQUESTS; i += 1) {
    assert.equal(controller.submit(`${client}${i}`, { kind: 'say', message: `message-${i}`, ttlMs: 15_000 }).accepted, true)
  }
  // The global queue cap is exercised with distinct clients to avoid the per-client cap.
  for (let i = PRESENTATION_MAX_CLIENT_REQUESTS; i < PRESENTATION_MAX_QUEUE_DEPTH + 1; i += 1) {
    controller.submit(`${client}${i}`, { kind: 'say', message: `message-${i}`, ttlMs: 15_000 })
  }
  assert.equal(controller.getQueueDepth(), PRESENTATION_MAX_QUEUE_DEPTH)

  const status = normalizePresentationStatus({
    dnd: true,
    enabled: true,
    activePets: [
      { petId: 'cat', name: '<pet>', mood: 'happy', level: 3, visibleState: 'thinking' },
      { petId: '../secret', name: 'bad', mood: 'happy', level: 3, visibleState: 'thinking' },
    ],
  })
  assert.deepEqual(status.activePets, [{
    petId: 'cat',
    name: 'pet',
    agentFamily: null,
    mood: 'happy',
    level: 3,
    visibleState: 'thinking',
  }])
  now += 20_000
  controller.cleanupExpired()
  controller.clear()
})

test('plugin reactions share the low-priority presentation queue without requiring the MCP switch', (t) => {
  const emitted: import('../src/types/presentation.ts').PresentationIntent[] = []
  let dnd = false
  const controller = new PresentationController({
    now: () => 10_000,
    createId: () => 'plugin-reaction-1',
    emit: intent => emitted.push(intent),
    getStatus: () => ({ activePets: [], dnd, enabled: false }),
    getBlockReason: () => 'disabled',
  })
  t.after(() => controller.clear())

  const accepted = controller.submitPluginReaction('sample', { reaction: 'curious', ttlMs: 2_000 })
  assert.equal(accepted.accepted, true)
  assert.deepEqual(emitted[0], {
    id: 'plugin-reaction-1',
    kind: 'react',
    source: 'plugin',
    reaction: 'curious',
    createdAt: 10_000,
    expiresAt: 12_000,
  })

  dnd = true
  assert.equal(controller.submitPluginReaction('sample', { reaction: 'curious' }).error, 'dnd_enabled')
})
