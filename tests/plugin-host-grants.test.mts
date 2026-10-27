import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import test from 'node:test'
import { PluginBroker } from '../electron/plugin-broker.ts'
import { PluginFeedController } from '../electron/plugin-feed.ts'
import type { PluginManifest } from '../src/types/plugin.ts'
import {
  normalizePluginHostRequest,
  PluginHostGrantController,
  sanitizePluginHostRequestReason,
  PLUGIN_HOST_DENIAL_COOLDOWN_MS,
  PLUGIN_HOST_REQUEST_WINDOW_MS,
} from '../electron/plugin-host-grants.ts'

test('requestHost accepts only normalized public DNS names and bounded plain-text reasons', () => {
  for (const host of ['*.example.com', '127.0.0.1', 'localhost', 'pet.local', 'example.internal', 'example.com:443', 'example.com/']) {
    assert.equal(normalizePluginHostRequest(host), null, host)
  }
  assert.equal(normalizePluginHostRequest('api.example.com'), 'api.example.com')
  assert.equal(sanitizePluginHostRequestReason('  Read <feed>\nupdates  '), 'Read feed updates')
  assert.equal(sanitizePluginHostRequestReason('x'.repeat(121)), null)
  assert.equal(sanitizePluginHostRequestReason('   '), null)
})

test('requestHost allows at most three prompts per plugin in ten minutes', () => {
  let now = 1_000
  const controller = new PluginHostGrantController({ now: () => now })
  for (let index = 0; index < 3; index += 1) {
    const request = controller.begin('sample', `host${index}.example.com`, 'Read updates', [])
    assert.equal(request.ok, true)
    if (request.ok) controller.finish('sample', request.host, true)
  }
  assert.deepEqual(controller.begin('sample', 'fourth.example.com', 'Read updates', []), {
    ok: false, error: 'rate_limited',
  })
  now += PLUGIN_HOST_REQUEST_WINDOW_MS + 1
  assert.equal(controller.begin('sample', 'fourth.example.com', 'Read updates', []).ok, true)
})

test('requestHost caches denial for 24 hours but does not prompt for already granted hosts', () => {
  let now = 1_000
  const controller = new PluginHostGrantController({ now: () => now })
  const first = controller.begin('sample', 'api.example.com', 'Read updates', [])
  assert.equal(first.ok, true)
  if (first.ok) controller.finish('sample', first.host, false)
  assert.deepEqual(controller.begin('sample', 'api.example.com', 'Read updates', []), {
    ok: false, error: 'denied',
  })
  assert.deepEqual(controller.begin('sample', 'api.example.com', 'Read updates', ['api.example.com']), {
    ok: true, host: 'api.example.com', alreadyGranted: true,
  })
  now += PLUGIN_HOST_DENIAL_COOLDOWN_MS + 1
  assert.equal(controller.begin('sample', 'api.example.com', 'Read updates', []).ok, true)
})

test('requestHost rejects concurrent prompts for the same host and can clear plugin state', () => {
  const controller = new PluginHostGrantController({ now: () => 1_000 })
  const first = controller.begin('sample', 'api.example.com', 'Read updates', [])
  assert.equal(first.ok, true)
  assert.deepEqual(controller.begin('sample', 'api.example.com', 'Read updates', []), {
    ok: false, error: 'rate_limited',
  })
  controller.clearPlugin('sample')
  assert.equal(controller.begin('sample', 'api.example.com', 'Read updates', []).ok, true)
})

test('PluginBroker requestHost requires userGranted and returns the direct successful value', async () => {
  const userDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-host-grant-broker-'))
  const manifest: PluginManifest = {
    id: 'sample',
    name: { 'zh-TW': '測試插件', 'en-US': 'Test Plugin' },
    version: '1.0.0',
    apiVersion: '1',
    author: 'Test',
    entry: 'dist/main.js',
    permissions: { network: { hosts: ['api.example.com'], userGranted: true } },
    contributes: {},
  }
  const feed = new PluginFeedController({
    emit: () => {},
    isPetVisible: () => true,
    getGlobalState: () => ({ pluginsEnabled: true, dndEnabled: false }),
    getPluginState: () => null,
    isLinkHostAllowed: () => false,
  })
  const broker = new PluginBroker({
    userDataDirectory,
    getContext: () => ({
      manifest,
      enabled: true,
      pluginsEnabled: true,
      dndEnabled: false,
      storageBytesPerPlugin: 1024 * 1024,
      grantedHosts: ['api.example.com'],
    }),
    feed,
    onReaction: () => ({ ok: true }),
    onRequestHost: async (_pluginId, host) => ({ host, granted: true }),
  })
  try {
    assert.deepEqual(await broker.handle('sample', {
      id: 'host-request-1', method: 'net.requestHost', args: ['api.example.com', 'Read updates'],
    }), {
      id: 'host-request-1', ok: true, value: { host: 'api.example.com', granted: true },
    })
    manifest.permissions.network.userGranted = false
    assert.deepEqual(broker.handle('sample', {
      id: 'host-request-2', method: 'net.requestHost', args: ['api.example.com', 'Read updates'],
    }), { id: 'host-request-2', ok: false, error: 'not_permitted' })
  } finally {
    broker.destroy()
    fs.rmSync(userDataDirectory, { recursive: true, force: true })
  }
})
