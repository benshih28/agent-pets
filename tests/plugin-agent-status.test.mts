import assert from 'node:assert/strict'
import test from 'node:test'
import { PluginAgentStatusController } from '../electron/plugin-agent-status.ts'
import { PLUGIN_STATUS_COALESCE_MS } from '../electron/plugin-agent-status.ts'

function snapshot(visibleState: string, dnd = false, agentFamily: unknown = 'codex') {
  return {
    activePets: [{
      petId: 'pet-main', name: '<Main Pet>', mood: 'happy', level: 4, visibleState,
      agentFamily, project: '/private/path', sessionId: 'secret-session',
    }],
    dnd,
    enabled: true,
  }
}

test('status projection emits only the approved keys and merges each pet changes for one second', () => {
  const emitted: unknown[] = []
  const scheduled: Array<() => void> = []
  let now = 10_000
  const controller = new PluginAgentStatusController({
    emit: change => emitted.push(change),
    now: () => now,
    schedule: callback => {
      scheduled.push(callback)
      return scheduled.length as unknown as ReturnType<typeof setTimeout>
    },
    cancel: () => {},
  })
  controller.update(snapshot('thinking'))
  now += PLUGIN_STATUS_COALESCE_MS - 100
  controller.update(snapshot('tool-running'))
  assert.equal(emitted.length, 0)
  assert.equal(scheduled.length, 1)
  controller.flushPending()
  assert.deepEqual(emitted, [{
    petId: 'pet-main',
    name: 'Main Pet',
    agentFamily: 'codex',
    previousState: 'offline',
    visibleState: 'tool-running',
    dnd: false,
    at: now,
  }])
  assert.deepEqual(Object.keys(emitted[0] as Record<string, unknown>).sort(), [
    'agentFamily', 'at', 'dnd', 'name', 'petId', 'previousState', 'visibleState',
  ])
})

test('DND changes notify status subscribers and unknown agent families are removed', () => {
  const emitted: unknown[] = []
  const controller = new PluginAgentStatusController({ emit: change => emitted.push(change), now: () => 42, schedule: () => 1 as unknown as ReturnType<typeof setTimeout>, cancel: () => {} })
  controller.update(snapshot('idle'))
  controller.flushPending()
  emitted.length = 0
  controller.update(snapshot('idle', true, 'unknown'))
  controller.flushPending()
  assert.deepEqual(emitted, [{
    petId: 'pet-main', name: 'Main Pet', agentFamily: null,
    previousState: 'idle', visibleState: 'idle', dnd: true, at: 42,
  }])
  assert.deepEqual(controller.getStatus(), [{
    petId: 'pet-main', name: 'Main Pet', agentFamily: null,
    previousState: 'idle', visibleState: 'idle', dnd: true, at: 42,
  }])
})

test('a state change that returns to its original state within the coalescing window emits nothing', () => {
  const emitted: unknown[] = []
  const controller = new PluginAgentStatusController({ emit: change => emitted.push(change), now: () => 42, schedule: () => 1 as unknown as ReturnType<typeof setTimeout>, cancel: () => {} })
  controller.update(snapshot('thinking'))
  controller.update(snapshot('offline'))
  controller.flushPending()
  assert.deepEqual(emitted, [])
})
