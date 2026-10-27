import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { strToU8, zipSync } from 'fflate'
import { PluginBroker } from '../electron/plugin-broker.ts'
import { PluginFeedController, type PluginFeedPluginState } from '../electron/plugin-feed.ts'
import { PLUGIN_ARCHIVE_MAX_FILES, PLUGIN_ARCHIVE_SKIN_IMAGE_MAX_BYTES, PluginRegistry } from '../electron/plugin-registry.ts'
import { PLUGIN_CONTENT_SECURITY_POLICY } from '../electron/plugin-protocol.ts'
import { parsePluginManifest } from '../electron/plugin-manifest.ts'
import { pluginHostAssets } from '../electron/plugin-host-assets.ts'
import type { PluginManifest } from '../src/types/plugin.ts'

const fixtureRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'plugins')
const FIXTURE_IDS = ['ok-notify', 'ok-panel', 'ok-skin', 'ok-commands', 'ok-event-source', 'evil-event-source', 'ok-signed', 'ok-signed-rotated', 'evil-signed-tampered', 'evil-fetch', 'evil-loop', 'evil-spam', 'evil-xss', 'evil-spoof', 'evil-zip', 'evil-escape', 'evil-network', 'evil-panel', 'evil-badge', 'evil-skin'] as const

function readFixture(pluginId: string): { manifest: PluginManifest; files: Record<string, Uint8Array> } {
  const sourceDirectory = path.join(fixtureRoot, pluginId)
  const manifestBytes = fs.readFileSync(path.join(sourceDirectory, 'plugin.json'))
  const parsed = parsePluginManifest(JSON.parse(manifestBytes.toString('utf8')) as unknown)
  assert.equal(parsed.ok, true, `fixture ${pluginId} has a valid manifest`)
  if (!parsed.ok) throw new Error(parsed.error)

  const files: Record<string, Uint8Array> = {}
  function collect(directory: string, relativeDirectory = ''): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = path.posix.join(relativeDirectory, entry.name)
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) collect(absolute, relative)
      else if (entry.isFile()) files[relative] = new Uint8Array(fs.readFileSync(absolute))
    }
  }
  collect(sourceDirectory)
  assert.ok(files['plugin.json'])
  if (parsed.manifest.entry) assert.ok(files[parsed.manifest.entry])
  if (parsed.manifest.icon) assert.ok(files[parsed.manifest.icon])
  return { manifest: parsed.manifest, files }
}

function packFixture(pluginId: string, extra: Record<string, Uint8Array> = {}): Uint8Array {
  const { files } = readFixture(pluginId)
  return zipSync({ ...files, ...extra }, { level: 6 })
}

function createFeed(pluginId: string, manifest: PluginManifest, rateLimitPer10Min = 5) {
  const emitted: Array<{ title: string; body: string }> = []
  const state: PluginFeedPluginState = {
    enabled: true,
    muted: false,
    rateLimitPer10Min,
    name: manifest.name,
  }
  const feed = new PluginFeedController({
    emit: item => emitted.push({ title: item.title, body: item.body }),
    isPetVisible: () => true,
    getGlobalState: () => ({ pluginsEnabled: true, dndEnabled: false, rateLimitPer10Min: 60 }),
    getPluginState: id => id === pluginId ? state : null,
    isLinkHostAllowed: () => false,
    now: () => 1_700_000_000_000,
    createId: (() => {
      let sequence = 0
      return () => `fixture-${String(++sequence).padStart(8, '0')}`
    })(),
  })
  return { feed, emitted }
}

test('plugin fixture sources have bounded manifests and include all declared runtime assets', () => {
  for (const pluginId of FIXTURE_IDS) {
    const { manifest, files } = readFixture(pluginId)
    assert.equal(manifest.id, pluginId === 'ok-signed-rotated' ? 'ok-signed' : pluginId)
    if (manifest.entry) assert.ok(files[manifest.entry])
    if (manifest.icon) {
      assert.deepEqual([...files[manifest.icon]!.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    }
  }
})

test('every fixture and public example entry exports an object with activate(api)', () => {
  const roots = [fixtureRoot, path.resolve('docs/plugins/examples')]
  const manifests: string[] = []
  function collect(directory: string): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) collect(target)
      else if (entry.isFile() && entry.name === 'plugin.json') manifests.push(target)
    }
  }
  roots.forEach(collect)

  for (const manifestPath of manifests) {
    const manifestValue = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown
    const parsed = parsePluginManifest(manifestValue)
    assert.equal(parsed.ok, true, `${manifestPath} must pass manifest validation`)
    if (!parsed.ok || !parsed.manifest.entry) continue

    const entryPath = path.join(path.dirname(manifestPath), parsed.manifest.entry)
    const source = fs.readFileSync(entryPath, 'utf8')
    assert.match(source, /export\s+default\s*\{[\s\S]*?\bactivate\s*(?:async\s*)?\(/,
      `${path.relative(process.cwd(), entryPath)} must export an object with activate(api)`)
  }
})

test('ok-skin is a skin-only fixture with a valid WebP spritesheet and no worker entry', () => {
  const { manifest, files } = readFixture('ok-skin')
  assert.equal(manifest.entry, undefined)
  assert.equal(manifest.contributes.skins?.[0]?.id, 'winter-fox')
  const spritesheet = files['skins/winter-fox.webp']
  assert.ok(spritesheet)
  assert.equal(Buffer.from(spritesheet!.subarray(0, 4)).toString('ascii'), 'RIFF')
  assert.equal(Buffer.from(spritesheet!.subarray(8, 12)).toString('ascii'), 'WEBP')
  assert.equal(files['dist/main.js'], undefined)
})

test('ok-commands declares user-triggered commands, Tray entries, and a badge', () => {
  const { manifest, files } = readFixture('ok-commands')
  assert.deepEqual(manifest.contributes.commands?.map(command => command.id), ['start', 'stop'])
  assert.deepEqual(manifest.contributes.tray?.commands, ['start', 'stop'])
  assert.equal(manifest.contributes.badge, true)
  const source = Buffer.from(files['dist/main.js']!).toString('utf8')
  assert.match(source, /api\.commands\.onInvoke/)
  assert.match(source, /api\.badge\.set/)
  assert.match(source, /api\.feed\.notify/)
})

test('eventSource fixtures declare a valid observer and probe its rejected inputs', () => {
  const accepted = readFixture('ok-event-source')
  assert.deepEqual(accepted.manifest.contributes.eventSource, {
    family: 'build-watch',
    displayName: { 'zh-TW': '建置工作', 'en-US': 'Build job' },
  })
  const acceptedSource = Buffer.from(accepted.files['dist/main.js']!).toString('utf8')
  assert.match(acceptedSource, /api\.agent\.emit\(\{ sessionId: 'fixture-build-1', state: 'thinking' \}\)/)

  const evil = readFixture('evil-event-source')
  assert.equal(evil.manifest.contributes.eventSource?.family, 'probe-status')
  const evilSource = Buffer.from(evil.files['dist/main.js']!).toString('utf8')
  assert.match(evilSource, /permission: \{ decision: 'allow' \}/)
  assert.match(evilSource, /waiting-permission/)
  assert.match(evilSource, /'x'\.repeat\(65\)/)
  assert.match(evilSource, /index < 31/)
})

test('evil-badge probes overlong text and attempts updates every 10 milliseconds', () => {
  const { manifest, files } = readFixture('evil-badge')
  assert.equal(manifest.contributes.badge, true)
  const source = Buffer.from(files['dist/main.js']!).toString('utf8')
  assert.match(source, /text:\s*'TOO-LONG'/)
  assert.match(source, /setInterval\(probe,\s*10\)/)
  assert.match(source, /api\.log\.info/)
})

test('evil-skin uses a forged WebP and an oversized sheet is rejected during planning', () => {
  const { manifest, files } = readFixture('evil-skin')
  assert.equal(manifest.entry, undefined)
  assert.equal(manifest.contributes.skins?.[0]?.spritesheet, 'skins/not-an-image.webp')
  assert.notEqual(Buffer.from(files['skins/not-an-image.webp']!.subarray(8, 12)).toString('ascii'), 'WEBP')

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-plugin-evil-skin-'))
  try {
    const registry = new PluginRegistry(userData)
    assert.deepEqual(registry.planInstall(packFixture('evil-skin')), { ok: false, error: 'invalid_manifest' })
    const oversized = new Uint8Array(PLUGIN_ARCHIVE_SKIN_IMAGE_MAX_BYTES + 1)
    assert.deepEqual(registry.planInstall(packFixture('evil-skin', { 'skins/not-an-image.webp': oversized })), {
      ok: false,
      error: 'invalid_archive',
    })
  } finally {
    fs.rmSync(userData, { recursive: true, force: true })
  }
})

test('every evil fixture records a host log entry for its runtime probe', () => {
  for (const pluginId of ['evil-fetch', 'evil-loop', 'evil-spam', 'evil-xss', 'evil-spoof', 'evil-zip', 'evil-escape', 'evil-network', 'evil-panel', 'evil-badge', 'evil-event-source']) {
    const source = Buffer.from(readFixture(pluginId).files['dist/main.js']!).toString('utf8')
    assert.match(source, /api\.log\.info/, `${pluginId} must leave inspectable evidence`)
  }
})

test('panel fixtures declare valid isolated pages and the worker-panel message probe', () => {
  for (const pluginId of ['ok-panel', 'evil-panel']) {
    const { manifest, files } = readFixture(pluginId)
    assert.ok(manifest.contributes.panelView, `${pluginId} must contribute a panelView`)
    assert.ok(files[manifest.contributes.panelView!.entry], `${pluginId} panel entry must be packaged`)
    assert.ok(files['ui/panel.js'], `${pluginId} panel script must be packaged`)
  }
  const okWorker = Buffer.from(readFixture('ok-panel').files['dist/main.js']!).toString('utf8')
  const okPanel = Buffer.from(readFixture('ok-panel').files['ui/panel.js']!).toString('utf8')
  assert.match(okWorker, /api\.ui\.onMessage/)
  assert.match(okWorker, /api\.ui\.postMessage/)
  assert.match(okPanel, /api\.ui\.postMessage/)
  assert.match(okPanel, /api\.ui\.onMessage/)
})

test('evil-panel fixture attempts each forbidden panel action and renders a fake confirmation surface', () => {
  const fixture = readFixture('evil-panel')
  const source = Buffer.from(fixture.files['ui/panel.js']!).toString('utf8')
  const html = Buffer.from(fixture.files['ui/index.html']!).toString('utf8')
  const styles = Buffer.from(fixture.files['ui/panel.css']!).toString('utf8')
  for (const marker of [
    'fetch(', 'new XMLHttpRequest()', 'new WebSocket(', 'otherPluginFile', 'window.open(',
    'window.location.assign(', 'navigationStayedOnPluginPage', 'window.parent', 'window.top',
    'parentCanSeeHostFrame', 'fakeDialogRendered', 'secretsExposed', 'requestHostExposed',
    'downloadAttempted', 'navigator.permissions.query', "name: 'camera'", "name: 'geolocation'",
    'Notification.requestPermission()', "new DragEvent('drop'", '__evilPanelDropEventCount',
  ]) assert.ok(source.includes(marker), `evil-panel missing probe: ${marker}`)
  assert.ok(!source.includes('getUserMedia('), 'evil-panel must never request real camera or microphone access')
  assert.ok(!source.includes('getCurrentPosition('), 'evil-panel must never request real location access')
  assert.ok(html.includes('fake-permission-dialog'), 'evil-panel page must render a fake confirmation surface')
  assert.match(html, /<iframe\b[^>]*src="https:\/\/example\.com\//, 'evil-panel must attempt an external iframe request')
  assert.match(styles, /position:\s*fixed/)
  assert.match(styles, /z-index:\s*2147483647/)
})

test('evil-network exercises a successful declared public host and each forbidden URL class', () => {
  const fixture = readFixture('evil-network')
  const source = Buffer.from(fixture.files['dist/main.js']!).toString('utf8')
  assert.ok(fixture.manifest.permissions.network?.hosts.includes('api.github.com'))
  assert.match(source, /api\.net\.fetch\('https:\/\/api\.github\.com\/robots\.txt'\)/)
  for (const marker of [
    'unlisted host', 'http scheme', 'public IP literal', 'localhost', 'private network', 'redirect to loopback',
  ]) assert.ok(source.includes(marker), `missing network rejection probe: ${marker}`)
})

test('all source fixtures can be packed and installed by PluginRegistry', () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-plugin-fixtures-'))
  try {
    const registry = new PluginRegistry(userData)
    for (const pluginId of FIXTURE_IDS) {
      const planned = registry.planInstall(packFixture(pluginId))
      if (pluginId === 'evil-skin') {
        assert.deepEqual(planned, { ok: false, error: 'invalid_manifest' }, 'forged skin must not install')
        continue
      }
      assert.equal(planned.ok, true, `${pluginId} should produce a valid base install plan`)
      if (!planned.ok) continue
      assert.equal(registry.install(planned.value.token).ok, true, `${pluginId} base fixture should install`)
    }
    assert.equal(registry.list().length, new Set(FIXTURE_IDS.map(pluginId => readFixture(pluginId).manifest.id)).size - 1)
  } finally {
    fs.rmSync(userData, { recursive: true, force: true })
  }
})

test('evil-zip path traversal and excess entries are rejected during planning', () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-plugin-evil-zip-'))
  try {
    const registry = new PluginRegistry(userData)
    assert.deepEqual(registry.planInstall(packFixture('evil-zip', { '../escape.txt': strToU8('outside') })), {
      ok: false,
      error: 'invalid_archive',
    })

    const overflow: Record<string, Uint8Array> = {}
    for (let index = 0; index <= PLUGIN_ARCHIVE_MAX_FILES; index += 1) {
      overflow[`extra/${index}.txt`] = strToU8('x')
    }
    assert.deepEqual(registry.planInstall(packFixture('evil-zip', overflow)), {
      ok: false,
      error: 'invalid_archive',
    })
  } finally {
    fs.rmSync(userData, { recursive: true, force: true })
  }
})

test('evil-fetch source targets forbidden network APIs and host CSP denies connections', () => {
  const source = Buffer.from(readFixture('evil-fetch').files['dist/main.js']!).toString('utf8')
  for (const api of ['fetch(', 'new WebSocket(', 'importScripts(', "import('https://"]) assert.ok(source.includes(api))
  assert.match(source, /api\.log\.info\(JSON\.stringify\(results\)\)/)
  assert.match(PLUGIN_CONTENT_SECURITY_POLICY, /connect-src 'none'/)
  assert.match(pluginHostAssets['host.js'] ?? '', /worker-crash/)
})

test('evil-loop source contains a blocking loop for manual Worker termination checks', () => {
  const source = Buffer.from(readFixture('evil-loop').files['dist/main.js']!).toString('utf8')
  assert.match(source, /while\s*\(true\)/)
  assert.match(pluginHostAssets['worker-bootstrap.js'] ?? '', /postToHost\(\{ type: 'pong'/)
})

test('evil-spam is rate limited and the excess notifications stay out of bubbles', () => {
  const manifest = readFixture('evil-spam').manifest
  const { feed, emitted } = createFeed('evil-spam', manifest, 5)
  const source = Buffer.from(readFixture('evil-spam').files['dist/main.js']!).toString('utf8')
  assert.match(source, /index < 100/)
  for (let index = 0; index < 100; index += 1) {
    const result = feed.submit('evil-spam', { title: `Spam ${index}`, body: 'Repeated test notification.' })
    assert.equal(result.accepted, index < 5)
    if (result.accepted && result.delivery === 'bubble') feed.complete(result.itemId)
  }
  assert.equal(emitted.length, 5)
  assert.equal(feed.unreadCount(), 95)
})

test('evil-xss notification data is reduced to inert plain text', () => {
  const manifest = readFixture('evil-xss').manifest
  const { feed, emitted } = createFeed('evil-xss', manifest)
  feed.submit('evil-xss', {
    title: '<img src=x onerror=alert(1)>',
    body: '<svg onload=alert(1)>unsafe markup</svg>',
  })
  assert.equal(emitted.length, 1)
  assert.ok(!emitted[0]?.title.includes('<'))
  assert.ok(!emitted[0]?.body.includes('<'))
})

test('evil-spoof cannot claim another plugin id or call an undeclared capability', () => {
  const { manifest } = readFixture('evil-spoof')
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-plugin-evil-spoof-'))
  const { feed } = createFeed('evil-spoof', manifest)
  try {
    const source = Buffer.from(readFixture('evil-spoof').files['dist/main.js']!).toString('utf8')
    assert.match(source, /DedicatedWorkerGlobalScope\.prototype\.postMessage/)
    assert.match(source, /api\.log\.info\(JSON\.stringify\(results\)\)/)
    const broker = new PluginBroker({
      userDataDirectory: userData,
      getContext: pluginId => pluginId === 'evil-spoof'
        ? { manifest, enabled: true, pluginsEnabled: true, dndEnabled: false, storageBytesPerPlugin: 1024 * 1024 }
        : null,
      feed,
      onReaction: () => ({ ok: true }),
    })
    assert.deepEqual(broker.handle('evil-spoof', {
      id: 'spoof-1',
      pluginId: 'ok-notify',
      method: 'pet.react',
      args: ['jump'],
    }), { id: 'spoof-1', ok: false, error: 'invalid_request' })
    assert.deepEqual(broker.handle('evil-spoof', {
      id: 'spoof-2',
      method: 'pet.react',
      args: ['jump'],
    }), { id: 'spoof-2', ok: false, error: 'not_permitted' })
    assert.deepEqual(broker.handle('ok-notify', {
      id: 'spoof-3',
      method: 'feed.notify',
      args: [{ title: 'spoof', body: 'spoof' }],
    }), { id: 'spoof-3', ok: false, error: 'disabled' })
  } finally {
    fs.rmSync(userData, { recursive: true, force: true })
  }
})

test('evil-escape logs isolation probes and Host API results are unwrapped', () => {
  const { files } = readFixture('evil-escape')
  const source = Buffer.from(files['dist/main.js']!).toString('utf8')
  for (const probe of [
    'fetch https', 'fetch loopback event server', 'fetch app origin', 'import other plugin module',
    'nested worker', 'BroadcastChannel', 'indexedDB', 'raw rpc via prototype', 'storage round-trip',
  ]) assert.ok(source.includes(probe))
  assert.match(source, /api\.log\.info\(JSON\.stringify\(results\)\)/)
  const bootstrap = pluginHostAssets['worker-bootstrap.js'] ?? ''
  for (const api of ['indexedDB', 'caches', 'BroadcastChannel', 'Worker', 'SharedWorker', 'WebSocket', 'EventSource', 'XMLHttpRequest', 'fetch']) {
    assert.ok(bootstrap.includes(`'${api}'`), `${api} is removed before plugin import`)
  }
  assert.match(bootstrap, /pendingRequest\.resolve\(result\.value\)/)
  assert.match(bootstrap, /pendingRequest\.reject\(error\)/)
  assert.ok(bootstrap.includes("import('agent-pets://plugin/' + pluginToken"))
  assert.match(pluginHostAssets['host.js'] ?? '', /event\.source !== window/)
  assert.match(pluginHostAssets['host.js'] ?? '', /event\.origin !== window\.location\.origin/)
  assert.match(pluginHostAssets['host.js'] ?? '', /portAccepted/)
  const hostPreload = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'electron', 'plugin-host-preload.ts'), 'utf8')
  assert.match(hostPreload, /window\.postMessage\('agent-pets-plugin-host-port', window\.location\.origin, \[port\]\)/)
  assert.doesNotMatch(hostPreload, /contextBridge/)
})

test('optional Host API arguments are omitted from RPC instead of serializing undefined', () => {
  const bootstrap = pluginHostAssets['worker-bootstrap.js'] ?? ''
  assert.ok(bootstrap.includes("react: (reaction, options) => rpc('pet.react', options === undefined ? [reaction] : [reaction, options])"))
  assert.ok(bootstrap.includes("fetch: (url, options) => rpc('net.fetch', options === undefined ? [url] : [url, options])"))
})
