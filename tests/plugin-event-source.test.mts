import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PLUGIN_EVENT_SOURCE_ACTIVE_TTL_MS,
  PLUGIN_EVENT_SOURCE_MAX_EVENT_BYTES,
  PLUGIN_EVENT_SOURCE_MAX_SESSION_LIFETIME_MS,
  PLUGIN_EVENT_SOURCE_MAX_SESSIONS_GLOBAL,
  PLUGIN_EVENT_SOURCE_MAX_SESSIONS_PER_PLUGIN,
  PLUGIN_EVENT_SOURCE_RATE_PER_PLUGIN,
  PLUGIN_EVENT_SOURCE_TERMINAL_TTL_MS,
  PluginEventSourceController,
  normalizePluginEventSourceFamily,
} from '../electron/plugin-event-source.ts'

const pluginName = { 'zh-TW': '狀態測試插件', 'en-US': 'Status Fixture' }
const displayName = { 'zh-TW': '測試工作階段', 'en-US': 'Fixture session' }

function setup(options: { family?: string; enabled?: boolean; pluginsEnabled?: boolean } = {}) {
  let now = 1_000
  let wallNow = 1_700_000_000_000
  const scheduled: Array<{ callback: () => void; delay: number; cancelled: boolean }> = []
  const snapshots: unknown[] = []
  const controller = new PluginEventSourceController({
    getContext: pluginId => pluginId === 'status-fixture' ? {
      enabled: options.enabled ?? true,
      pluginsEnabled: options.pluginsEnabled ?? true,
      pluginName,
      family: options.family ?? 'build-watch',
      displayName,
    } : null,
    onChanged: statuses => snapshots.push(statuses),
    now: () => now,
    wallNow: () => wallNow,
    schedule: (callback, delay) => {
      const entry = { callback, delay, cancelled: false }
      scheduled.push(entry)
      return entry as unknown as ReturnType<typeof setTimeout>
    },
    cancel: timer => {
      const entry = timer as unknown as { cancelled: boolean }
      entry.cancelled = true
    },
  })
  return {
    controller,
    scheduled,
    snapshots,
    setNow: (value: number) => { now = value; wallNow += value },
    fire: (entry: number) => scheduled[entry]!.callback(),
  }
}

test('eventSource family normalizes separators before rejecting every reserved family', () => {
  assert.equal(normalizePluginEventSourceFamily('Build_Watch'), 'build-watch')
  assert.equal(normalizePluginEventSourceFamily('build.watch'), 'build-watch')
  for (const family of ['codex', 'Claude Code', 'CLAUDE_CODE', 'claude.code', 'OpenCode', 'generic-http', 'agent pets', 'plugin', 'system']) {
    assert.equal(normalizePluginEventSourceFamily(family), null, family)
  }
  for (const family of ['', '測試', '-bad', 'bad-', 'a--b', 'x'.repeat(81)]) {
    assert.equal(normalizePluginEventSourceFamily(family), null, family)
  }
})

test('eventSource accepts only the observe-only schema and exposes no family, plugin id, or session id', () => {
  const harness = setup()
  assert.deepEqual(harness.controller.emit('status-fixture', { sessionId: 'run-1', state: 'thinking' }), { accepted: true })
  assert.deepEqual(harness.controller.list(), [{
    key: 1,
    pluginName,
    displayName,
    state: 'thinking',
    updatedAt: 1_700_000_000_000,
  }])
  for (const event of [
    { sessionId: 'run-1', state: 'permission-request' },
    { sessionId: 'run-2', state: 'waiting-permission' },
    { sessionId: 'run-3', state: 'thinking', permission: true },
    { sessionId: 'run-4', state: 'thinking', family: 'codex' },
    { sessionId: 'x'.repeat(65), state: 'idle' },
    { sessionId: 'run-5', state: 'idle', detail: 'x'.repeat(PLUGIN_EVENT_SOURCE_MAX_EVENT_BYTES) },
  ]) assert.deepEqual(harness.controller.emit('status-fixture', event), { ok: false, error: 'invalid_request' })
  assert.equal(harness.controller.emit('unknown-plugin', { sessionId: 'x', state: 'idle' }).error, 'disabled')
  assert.equal(harness.controller.list().length, 1)
  harness.controller.destroy()
})

test('eventSource rejects reserved manifest families and disabled plugins', () => {
  assert.deepEqual(setup({ family: 'Codex' }).controller.emit('status-fixture', { sessionId: 'x', state: 'idle' }), {
    ok: false, error: 'not_permitted',
  })
  assert.deepEqual(setup({ enabled: false }).controller.emit('status-fixture', { sessionId: 'x', state: 'idle' }), {
    ok: false, error: 'disabled',
  })
  assert.deepEqual(setup({ pluginsEnabled: false }).controller.emit('status-fixture', { sessionId: 'x', state: 'idle' }), {
    ok: false, error: 'disabled',
  })
})

test('eventSource terminal sessions cannot be rewritten and expire after 30 seconds', () => {
  const harness = setup()
  assert.deepEqual(harness.controller.emit('status-fixture', { sessionId: 'done-1', state: 'done' }), { accepted: true })
  assert.deepEqual(harness.controller.emit('status-fixture', { sessionId: 'done-1', state: 'thinking' }), {
    ok: false, error: 'invalid_request',
  })
  assert.equal(harness.scheduled[0]!.delay, PLUGIN_EVENT_SOURCE_TERMINAL_TTL_MS)
  harness.setNow(1_000 + PLUGIN_EVENT_SOURCE_TERMINAL_TTL_MS)
  assert.deepEqual(harness.controller.list(), [])
  assert.deepEqual(harness.controller.emit('status-fixture', { sessionId: 'done-1', state: 'idle' }), {
    ok: false, error: 'invalid_request',
  })
  harness.controller.destroy()
})

test('eventSource refreshes active TTL and stops a session at its maximum lifetime', () => {
  const harness = setup()
  harness.controller.emit('status-fixture', { sessionId: 'active-1', state: 'thinking' })
  assert.equal(harness.scheduled[0]!.delay, PLUGIN_EVENT_SOURCE_ACTIVE_TTL_MS)
  harness.setNow(60_000)
  harness.controller.emit('status-fixture', { sessionId: 'active-1', state: 'tool-running' })
  assert.equal(harness.scheduled[0]!.cancelled, true)
  assert.deepEqual(harness.controller.list().map(item => item.state), ['tool-running'])
  harness.setNow(1_000 + PLUGIN_EVENT_SOURCE_MAX_SESSION_LIFETIME_MS)
  assert.deepEqual(harness.controller.list(), [])
  harness.controller.destroy()
})

test('eventSource enforces plugin and global event and session limits', () => {
  const contexts = new Map<string, number>()
  const controller = new PluginEventSourceController({
    getContext: id => contexts.has(id) ? {
      enabled: true, pluginsEnabled: true, pluginName, family: `family-${contexts.get(id)}`,
      displayName,
    } : null,
    onChanged: () => {},
    now: () => 10,
    wallNow: () => 100,
    schedule: () => 1 as unknown as ReturnType<typeof setTimeout>,
    cancel: () => {},
  })
  for (let id = 1; id <= 6; id += 1) contexts.set(`source-${id}`, id)
  for (let id = 1; id <= PLUGIN_EVENT_SOURCE_MAX_SESSIONS_PER_PLUGIN; id += 1) {
    assert.deepEqual(controller.emit('source-1', { sessionId: `run-${id}`, state: 'thinking' }), { accepted: true })
  }
  assert.deepEqual(controller.emit('source-1', { sessionId: 'too-many', state: 'thinking' }), { ok: false, error: 'rate_limited' })
  for (let id = 2; id <= 5; id += 1) {
    for (let session = 1; session <= PLUGIN_EVENT_SOURCE_MAX_SESSIONS_PER_PLUGIN; session += 1) {
      assert.deepEqual(controller.emit(`source-${id}`, { sessionId: `run-${session}`, state: 'thinking' }), { accepted: true })
    }
  }
  assert.equal(controller.list().length, PLUGIN_EVENT_SOURCE_MAX_SESSIONS_GLOBAL)
  assert.deepEqual(controller.emit('source-6', { sessionId: 'global-limit', state: 'thinking' }), { ok: false, error: 'rate_limited' })
  controller.destroy()
})

test('eventSource rate limits each plugin and globally over a rolling minute', () => {
  let now = 10
  const contexts = new Map<string, number>()
  const controller = new PluginEventSourceController({
    getContext: id => contexts.has(id) ? {
      enabled: true, pluginsEnabled: true, pluginName, family: `family-${contexts.get(id)}`,
      displayName,
    } : null,
    onChanged: () => {},
    now: () => now,
    wallNow: () => 100,
    schedule: () => 1 as unknown as ReturnType<typeof setTimeout>,
    cancel: () => {},
  })
  for (let id = 1; id <= 5; id += 1) contexts.set(`source-${id}`, id)
  for (let id = 1; id <= 4; id += 1) {
    for (let event = 0; event < PLUGIN_EVENT_SOURCE_RATE_PER_PLUGIN; event += 1) {
      assert.deepEqual(controller.emit(`source-${id}`, { sessionId: `rolling-${id}`, state: 'thinking' }), { accepted: true })
    }
  }
  assert.deepEqual(controller.emit('source-1', { sessionId: 'rolling-1', state: 'thinking' }), { ok: false, error: 'rate_limited' })
  assert.deepEqual(controller.emit('source-5', { sessionId: 'global-last', state: 'thinking' }), { ok: false, error: 'rate_limited' })
  now += 60_001
  assert.deepEqual(controller.emit('source-1', { sessionId: 'rolling-new', state: 'idle' }), { accepted: true })
  controller.destroy()
})

test('eventSource disable, remove, crash, and reload resets clear visible state and plugin/global rates', () => {
  for (const lifecycle of ['disable', 'remove', 'crash', 'reload'] as const) {
    let now = 10
    let exists = true
    let enabled = true
    const pluginIds = ['status-fixture', 'second-source', 'third-source', 'fourth-source']
    const controller = new PluginEventSourceController({
      getContext: id => pluginIds.includes(id) && (id !== 'status-fixture' || exists) ? {
        enabled: id === 'status-fixture' ? enabled : true,
        pluginsEnabled: true,
        pluginName: { 'zh-TW': id, 'en-US': id },
        family: `${id}-family`,
        displayName,
      } : null,
      onChanged: () => {},
      now: () => now,
      wallNow: () => 100,
      schedule: () => 1 as unknown as ReturnType<typeof setTimeout>,
      cancel: () => {},
    })
    for (const pluginId of pluginIds) {
      for (let event = 0; event < PLUGIN_EVENT_SOURCE_RATE_PER_PLUGIN; event += 1) {
        assert.deepEqual(controller.emit(pluginId, { sessionId: 'work', state: 'thinking' }), { accepted: true })
      }
    }
    assert.deepEqual(controller.emit('status-fixture', { sessionId: 'work', state: 'thinking' }), { ok: false, error: 'rate_limited' })
    if (lifecycle === 'disable') enabled = false
    if (lifecycle === 'remove') exists = false
    controller.clearPlugin('status-fixture')
    assert.equal(controller.list().some(item => item.pluginName['en-US'] === 'status-fixture'), false, lifecycle)
    assert.equal(controller.list().length, 3, lifecycle)
    assert.deepEqual(controller.emit('status-fixture', { sessionId: 'next-work', state: 'idle' }),
      lifecycle === 'disable' || lifecycle === 'remove'
        ? { ok: false, error: 'disabled' }
        : { accepted: true })
    if (lifecycle === 'disable') {
      enabled = true
      assert.deepEqual(controller.emit('status-fixture', { sessionId: 'next-work', state: 'idle' }), { accepted: true })
    }
    if (lifecycle === 'remove') {
      exists = true
      assert.deepEqual(controller.emit('status-fixture', { sessionId: 'next-work', state: 'idle' }), { accepted: true })
    }
    now += 1
    controller.destroy()
  }
})
