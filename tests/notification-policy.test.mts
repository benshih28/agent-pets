import assert from 'node:assert/strict'
import test from 'node:test'
import {
  aggregateTerminalNotifications,
  classifyNotification,
  NotificationCooldown,
} from '../electron/notification-policy.ts'
import { makeAgentStatusEvent as event } from './support/agent-status-event.mts'

test('classifies waiting and terminal events without exposing tool data', () => {
  const waiting = classifyNotification(event('waiting-permission', {
    toolName: 'secret command',
  }))
  assert.equal(waiting?.kind, 'waiting-permission')
  assert.equal(waiting?.title, 'Codex 需要你的權限確認')
  assert.equal(waiting?.body, 'agent-pets')
  assert.doesNotMatch(`${waiting?.title} ${waiting?.body}`, /secret command/)

  const success = classifyNotification(event('success'))
  assert.equal(success?.terminal, true)
  assert.equal(classifyNotification(event('thinking')), null)
})

test('external-only permission waits say they must be answered in the original tool', () => {
  const external = classifyNotification(event('waiting-permission', {
    permissionNotice: { responseMode: 'external_only' },
  }))
  assert.equal(external?.title, 'Codex 等你核准（請回原工具處理）')
})

test('suppresses integration-test notifications', () => {
  assert.equal(classifyNotification(event('success', {
    originalEvent: 'AgentPetsIntegrationTest',
  })), null)
})

test('cooldown rejects duplicate session and event class within the window', () => {
  const cooldown = new NotificationCooldown(60_000)
  assert.equal(cooldown.take('codex:session-1:success', 1_000), true)
  assert.equal(cooldown.take('codex:session-1:success', 2_000), false)
  assert.equal(cooldown.take('codex:session-1:error', 2_000), true)
  assert.equal(cooldown.take('codex:session-1:success', 61_000), true)
})

test('aggregates terminal notifications without project or session details', () => {
  const candidates = [
    classifyNotification(event('success')),
    classifyNotification(event('error', { sessionId: 'session-2' })),
  ].filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)

  assert.deepEqual(aggregateTerminalNotifications(candidates), {
    title: '2 個工作結束（1 個失敗）',
    body: '1 個已完成 · 1 個失敗',
  })
})

test('mixed aggregate title does not claim everything completed', () => {
  const ok = classifyNotification(event('success', { sessionId: 'a' }))!
  const bad = classifyNotification(event('error', { sessionId: 'b' }))!
  const mixed = aggregateTerminalNotifications([ok, bad])
  assert.match(mixed.title, /1 個失敗/)
  assert.doesNotMatch(mixed.title, /已完成/)
  const allOk = aggregateTerminalNotifications([ok, classifyNotification(event('success', { sessionId: 'c' }))!])
  assert.match(allOk.title, /已完成/)
})

test('only waiting notifications name a session a click may switch to', () => {
  assert.deepEqual(classifyNotification(event('waiting-input'))?.session, { source: 'codex', sessionId: 'session-1' })
  assert.deepEqual(classifyNotification(event('waiting-permission', { source: 'claude', sessionId: 's-9' }))?.session, { source: 'claude', sessionId: 's-9' })
  assert.equal(classifyNotification(event('success'))?.session, undefined)
  assert.equal(classifyNotification(event('error'))?.session, undefined)
})
