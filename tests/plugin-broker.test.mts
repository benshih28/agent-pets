import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import test from 'node:test'
import { PluginBroker, PLUGIN_LOG_MAX_ENTRIES, PLUGIN_RPC_MAX_BYTES } from '../electron/plugin-broker.ts'
import { PluginFeedController } from '../electron/plugin-feed.ts'
import type { PluginManifest } from '../src/types/plugin.ts'
import { SKIP_WITHOUT_FILE_SYMLINKS } from './support/fs-capabilities.mts'

const PLUGIN_NAME = { 'zh-TW': '測試插件', 'en-US': 'Test Plugin' }

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'sample',
    name: PLUGIN_NAME,
    version: '1.0.0',
    apiVersion: '1',
    author: 'Test',
    entry: 'dist/main.js',
    permissions: { storage: true },
    contributes: { feed: true, reaction: true },
    ...overrides,
  }
}

function createHarness(options: {
  pluginManifest?: PluginManifest
  pluginRateLimit?: number
  storageBytesPerPlugin?: number
  onSecretGet?: (pluginId: string, key: string) => string | { ok: false; error: 'secret_unavailable' | 'secret_not_found' }
  onSettingsGet?: (pluginId: string) => Record<string, unknown> | { ok: false; error: 'settings_invalid' }
  onAgentStatusGet?: (pluginId: string) => unknown
  onAgentEmit?: (pluginId: string, event: unknown) => unknown
  onBadgeSet?: (pluginId: string, badge: unknown) => unknown
} = {}) {
  const userDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-broker-'))
  fs.mkdirSync(path.join(userDataDirectory, 'plugins', 'sample'), { recursive: true })
  let now = 1_000_000
  let dndEnabled = false
  const context = {
    manifest: options.pluginManifest ?? manifest(),
    enabled: true,
    pluginsEnabled: true,
    dndEnabled,
    storageBytesPerPlugin: options.storageBytesPerPlugin ?? 1024 * 1024,
  }
  const reactions: unknown[] = []
  const feed = new PluginFeedController({
    emit: () => {},
    isPetVisible: () => true,
    getGlobalState: () => ({ pluginsEnabled: true, dndEnabled, rateLimitPer10Min: 60 }),
    getPluginState: () => ({ enabled: true, muted: false, rateLimitPer10Min: options.pluginRateLimit ?? 5, name: PLUGIN_NAME }),
    isLinkHostAllowed: () => false,
    resolveIconUrl: (pluginId, iconPath) => `agent-pets://plugin/${pluginId}/${iconPath}`,
    now: () => now,
    createId: () => 'feed-item-00000001',
  })
  const broker = new PluginBroker({
    userDataDirectory,
    getContext: () => ({ ...context, dndEnabled }),
    feed,
    onReaction: (_pluginId, reaction) => {
      reactions.push(reaction)
      return { ok: true }
    },
    onSecretGet: options.onSecretGet,
    onSettingsGet: options.onSettingsGet,
    onAgentStatusGet: options.onAgentStatusGet,
    onAgentEmit: options.onAgentEmit,
    onBadgeSet: options.onBadgeSet,
    now: () => now,
  })
  return {
    broker,
    context,
    feed,
    reactions,
    userDataDirectory,
    setDnd: (value: boolean) => { dndEnabled = value; context.dndEnabled = value },
    setNow: (value: number) => { now = value },
    cleanup: () => {
      broker.destroy()
      fs.rmSync(userDataDirectory, { recursive: true, force: true })
    },
  }
}

function request(id: string, method: string, args: unknown[] = []) {
  return { id, method, args }
}

test('PluginBroker rejects unknown methods and RPC payloads over 256 KB', () => {
  const harness = createHarness()
  try {
    assert.deepEqual(harness.broker.handle('sample', request('u1', 'network.fetch')), {
      id: 'u1', ok: false, error: 'invalid_request',
    })
    const tooLarge = harness.broker.handle('sample', request('u2', 'log.info', [[ 'x'.repeat(PLUGIN_RPC_MAX_BYTES) ]]))
    assert.deepEqual(tooLarge, { id: 'u2', ok: false, error: 'too_large' })
    assert.equal(harness.broker.listDiagnostics('sample').some(entry => entry.code === 'too_large'), true)
  } finally {
    harness.cleanup()
  }
})

test('PluginBroker rejects self-asserted plugin identity and ungranted APIs', () => {
  const harness = createHarness({
    pluginManifest: manifest({ permissions: {}, contributes: {} }),
  })
  try {
    assert.deepEqual(harness.broker.handle('sample', {
      ...request('spoof', 'feed.notify', [{ title: 'Hello', body: 'World' }]),
      pluginId: 'other-plugin',
    }), { id: 'spoof', ok: false, error: 'invalid_request' })
    assert.deepEqual(harness.broker.handle('sample', request('feed', 'feed.notify', [{ title: 'Hello', body: 'World' }])), {
      id: 'feed', ok: false, error: 'not_permitted',
    })
    assert.deepEqual(harness.broker.handle('sample', request('store', 'storage.set', ['key', 'value'])), {
      id: 'store', ok: false, error: 'not_permitted',
    })
    assert.deepEqual(harness.broker.handle('sample', request('badge', 'badge.set', [{ text: 'READY' }])), {
      id: 'badge', ok: false, error: 'not_permitted',
    })
  } finally {
    harness.cleanup()
  }
})

test('PluginBroker requires contributes.badge and unwraps badge.set success values', () => {
  const calls: unknown[] = []
  const harness = createHarness({
    pluginManifest: manifest({ contributes: { badge: true } }),
    onBadgeSet: (pluginId, badge) => { calls.push({ pluginId, badge }); return { set: true } },
  })
  try {
    assert.deepEqual(harness.broker.handle('sample', request('badge-1', 'badge.set', [{ text: 'BUILD', tone: 'info' }])), {
      id: 'badge-1', ok: true, value: { set: true },
    })
    assert.deepEqual(calls, [{ pluginId: 'sample', badge: { text: 'BUILD', tone: 'info' } }])
  } finally {
    harness.cleanup()
  }
})

test('PluginBroker validates reactions, applies DND, and shares feed rate limits', () => {
  const harness = createHarness({ pluginRateLimit: 1 })
  try {
    const accepted = harness.broker.handle('sample', request('react-1', 'pet.react', ['happy', { ttlMs: 2_000 }]))
    assert.deepEqual(accepted, { id: 'react-1', ok: true, value: { accepted: true } })
    assert.deepEqual(harness.reactions, [{ reaction: 'happy', ttlMs: 2_000 }])
    assert.deepEqual(harness.broker.handle('sample', request('react-2', 'pet.react', ['unknown'])), {
      id: 'react-2', ok: false, error: 'invalid_request',
    })
    assert.deepEqual(harness.broker.handle('sample', request('feed-1', 'feed.notify', [{ title: 'Update', body: 'Ready' }])), {
      id: 'feed-1', ok: false, error: 'rate_limited',
    })

    harness.setNow(1_000_000 + 10 * 60_000)
    harness.setDnd(true)
    assert.deepEqual(harness.broker.handle('sample', request('react-dnd', 'pet.react', ['curious'])), {
      id: 'react-dnd', ok: false, error: 'disabled',
    })
    assert.equal(harness.reactions.length, 1)
  } finally {
    harness.cleanup()
  }
})

test('PluginBroker returns clean feed results and records host startup diagnostics', () => {
  const harness = createHarness()
  try {
    assert.deepEqual(harness.broker.handle('sample', request('feed-ok', 'feed.notify', [{ title: 'Ready', body: 'Storage is available.' }])), {
      id: 'feed-ok',
      ok: true,
      value: { itemId: 'feed-item-00000001', delivery: 'bubble' },
    })
    harness.broker.recordHostUnavailable('sample')
    assert.deepEqual(harness.broker.listDiagnostics('sample').at(-1), {
      at: 1_000_000,
      code: 'host_unavailable',
      method: 'host.start',
    })
  } finally {
    harness.cleanup()
  }
})

test('PluginBroker persists storage atomically and rejects values over the configured limit', () => {
  const harness = createHarness({ storageBytesPerPlugin: 64 * 1024 })
  try {
    assert.deepEqual(harness.broker.handle('sample', request('set', 'storage.set', ['profile', { level: 3 }])), {
      id: 'set', ok: true, value: { stored: true },
    })
    assert.equal(harness.broker.flushStorage('sample'), true)
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(harness.userDataDirectory, 'plugins', 'sample', 'data', 'storage.json'), 'utf8')), {
      profile: { level: 3 },
    })
    assert.deepEqual(harness.broker.handle('sample', request('get', 'storage.get', ['profile'])), {
      id: 'get', ok: true, value: { found: true, value: { level: 3 } },
    })
    assert.deepEqual(harness.broker.handle('sample', request('oversize', 'storage.set', ['large', 'x'.repeat(64 * 1024)])), {
      id: 'oversize', ok: false, error: 'too_large',
    })
  } finally {
    harness.cleanup()
  }
})

test('PluginBroker returns declared secrets and non-secret settings directly with coded failures', () => {
  const harness = createHarness({
    pluginManifest: manifest({
      permissions: { secrets: ['apiToken', 'missingToken'] },
      contributes: { settings: { type: 'object', properties: {
        apiToken: { type: 'string', format: 'secret' },
        missingToken: { type: 'string', format: 'secret' },
      } } },
    }),
    onSecretGet: (_pluginId, key) => key === 'apiToken' ? 'private-value' : { ok: false, error: 'secret_not_found' },
    onSettingsGet: () => ({ theme: 'compact', enabled: true }),
  })
  try {
    assert.deepEqual(harness.broker.handle('sample', request('secret', 'secrets.get', ['apiToken'])), {
      id: 'secret', ok: true, value: 'private-value',
    })
    assert.deepEqual(harness.broker.handle('sample', request('undeclared', 'secrets.get', ['other'])), {
      id: 'undeclared', ok: false, error: 'not_permitted',
    })
    assert.deepEqual(harness.broker.handle('sample', request('settings', 'settings.get')), {
      id: 'settings', ok: true, value: { theme: 'compact', enabled: true },
    })
    assert.deepEqual(harness.broker.handle('sample', request('secret-missing', 'secrets.get', ['missingToken'])), {
      id: 'secret-missing', ok: false, error: 'secret_not_found',
    })
  } finally { harness.cleanup() }
})

test('pet.status requires agentStatus permission and returns the sanitized projection directly', () => {
  const status = [{
    petId: 'pet-main', name: 'Main Pet', agentFamily: 'claude-code',
    previousState: 'thinking', visibleState: 'tool-running', dnd: false, at: 1_000_000,
  }]
  const harness = createHarness({
    pluginManifest: manifest({ permissions: { agentStatus: true } }),
    onAgentStatusGet: () => status,
  })
  try {
    assert.deepEqual(harness.broker.handle('sample', request('status', 'pet.status')), {
      id: 'status', ok: true, value: status,
    })
    assert.deepEqual(harness.broker.handle('sample', request('bad-args', 'pet.status', ['private'])), {
      id: 'bad-args', ok: false, error: 'invalid_request',
    })
  } finally { harness.cleanup() }

  const denied = createHarness({ pluginManifest: manifest({ permissions: {} }) })
  try {
    assert.deepEqual(denied.broker.handle('sample', request('denied', 'pet.status')), {
      id: 'denied', ok: false, error: 'not_permitted',
    })
  } finally { denied.cleanup() }
})

test('PluginBroker fails closed for symlinked plugin storage', { skip: SKIP_WITHOUT_FILE_SYMLINKS }, () => {
  const harness = createHarness()
  const outsidePath = path.join(harness.userDataDirectory, 'outside')
  fs.mkdirSync(outsidePath)
  try {
    fs.symlinkSync(outsidePath, path.join(harness.userDataDirectory, 'plugins', 'sample', 'data'))
    assert.deepEqual(harness.broker.handle('sample', request('read', 'storage.get', ['key'])), {
      id: 'read', ok: false, error: 'disabled',
    })
    assert.equal(harness.broker.flushStorage('sample'), false)
  } finally {
    harness.cleanup()
  }
})

test('PluginBroker keeps only the latest 200 bounded plain-text log messages', () => {
  const harness = createHarness()
  try {
    for (let index = 0; index < PLUGIN_LOG_MAX_ENTRIES + 5; index += 1) {
      assert.deepEqual(harness.broker.handle('sample', request(`log-${index}`, 'log.info', [[`<message ${index}>`]])), {
        id: `log-${index}`, ok: true, value: { logged: true },
      })
    }
    const entries = harness.broker.listLogs('sample')
    assert.equal(entries.length, PLUGIN_LOG_MAX_ENTRIES)
    assert.equal(entries[0]?.message, '<message 5>')
    assert.equal(entries.at(-1)?.message, '<message 204>')
    assert.equal(entries.every(entry => entry.message.length <= 1_000), true)
  } finally {
    harness.cleanup()
  }
})

test('agent.emit reaches only the observe-only event source callback', () => {
  const calls = new Map<string, number>()
  const hit = (name: string) => calls.set(name, (calls.get(name) ?? 0) + 1)
  const hostCapabilityCalls = {
    feedSubmit: 0,
    reaction: 0,
    agentStatus: 0,
    secrets: 0,
    settings: 0,
    badge: 0,
  }
  const harness = createHarness({
    pluginManifest: manifest({ contributes: {
      eventSource: { family: 'build-watch', displayName: { 'zh-TW': '建置狀態', 'en-US': 'Build state' } },
    } }),
    onAgentEmit: (_pluginId, event) => {
      hit('eventSource')
      return event && typeof event === 'object' && 'state' in event ? { accepted: true } : { ok: false, error: 'invalid_request' }
    },
    onAgentStatusGet: () => { hostCapabilityCalls.agentStatus += 1; hit('agentStatus'); return null },
    onSecretGet: () => { hostCapabilityCalls.secrets += 1; hit('secrets'); return 'secret' },
    onSettingsGet: () => { hostCapabilityCalls.settings += 1; hit('settings'); return {} },
    onBadgeSet: () => { hostCapabilityCalls.badge += 1; hit('badge'); return { set: true } },
  })
  const feedSubmit = harness.feed.submit.bind(harness.feed)
  harness.feed.submit = (...args) => { hostCapabilityCalls.feedSubmit += 1; hit('feed'); return feedSubmit(...args) }
  const reactionCallback = harness.reactions.push.bind(harness.reactions)
  harness.reactions.push = (...args) => { hostCapabilityCalls.reaction += args.length; return reactionCallback(...args) }
  try {
    assert.deepEqual(harness.broker.handle('sample', request('event', 'agent.emit', [{ sessionId: 'build-1', state: 'thinking' }])), {
      id: 'event', ok: true, value: { accepted: true },
    })
    assert.deepEqual([...calls.entries()], [['eventSource', 1]])
    assert.equal(harness.reactions.length, 0)
    assert.deepEqual(hostCapabilityCalls, {
      feedSubmit: 0,
      reaction: 0,
      agentStatus: 0,
      secrets: 0,
      settings: 0,
      badge: 0,
    })
  } finally { harness.cleanup() }
})
