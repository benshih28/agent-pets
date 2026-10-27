import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import test from 'node:test'
import {
  handlePluginProtocolRequest,
  createPluginHostProtocolHandler,
  createPluginPanelProtocolHandler,
  PLUGIN_CONTENT_SECURITY_POLICY,
  PLUGIN_PANEL_CONTENT_SECURITY_POLICY,
  PLUGIN_WORKER_CONTENT_SECURITY_POLICY,
} from '../electron/plugin-protocol.ts'
import { pluginHostAssets } from '../electron/plugin-host-assets.ts'

async function withPluginRoot(run: (root: string) => void | Promise<void>): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-plugin-protocol-'))
  try { await run(root) } finally { fs.rmSync(root, { recursive: true, force: true }) }
}

test('plugin protocol serves only current plugin files with the required CSP and MIME headers', async () => {
  await withPluginRoot(async (userData) => {
    const root = path.join(userData, 'sample-plugin', '1.0.0')
    fs.mkdirSync(path.join(root, 'dist'), { recursive: true })
    fs.writeFileSync(path.join(root, 'dist', 'main.js'), 'export default 1')
    const response = await handlePluginProtocolRequest('agent-pets://plugin/sample-plugin/dist/main.js', {
      pluginRootForId: id => id === 'sample-plugin' ? root : null,
      hostAssets: pluginHostAssets,
    })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'text/javascript; charset=utf-8')
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(response.headers.get('content-security-policy'), PLUGIN_CONTENT_SECURITY_POLICY)
    assert.equal(await response.text(), 'export default 1')
  })
})

test('plugin protocol serves embedded host resources and denies uninstalled or disabled ids', async () => {
  const response = await handlePluginProtocolRequest('agent-pets://plugin/_host/worker-bootstrap.js', {
    pluginRootForId: () => null,
    hostAssets: pluginHostAssets,
  })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'text/javascript; charset=utf-8')
  assert.match(await response.text(), /removeCrossPluginApis/)

  for (const url of [
    'agent-pets://plugin/unknown-plugin/main.js',
    'agent-pets://plugin/sample-plugin/%2e%2e/secret.js',
    'agent-pets://plugin/_host/unknown.js',
    'agent-pets://plugin/sample-plugin/main.js?query=1',
  ]) {
    assert.equal((await handlePluginProtocolRequest(url, { pluginRootForId: () => null, hostAssets: pluginHostAssets })).status, 404)
  }
})

test('plugin skin assets use byte-detected MIME and remain unavailable while the plugin is disabled', async () => {
  await withPluginRoot(async userData => {
    const root = path.join(userData, 'skin-pack', '1.0.0')
    fs.mkdirSync(path.join(root, 'skins'), { recursive: true })
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
    fs.writeFileSync(path.join(root, 'skins', 'winter fox.webp'), png)
    let enabled = true
    const options = {
      pluginRootForId: (pluginId: string) => enabled && pluginId === 'skin-pack' ? root : null,
      pluginSkinAssetForId: (pluginId: string, relativePath: string) => {
        if (pluginId !== 'skin-pack' || relativePath !== 'skins/winter fox.webp') return undefined
        const data = fs.readFileSync(path.join(root, relativePath))
        return { data, contentType: 'image/png' }
      },
      hostAssets: pluginHostAssets,
    }
    const url = 'agent-pets://plugin/skin-pack/skins/winter%20fox.webp'
    const response = await handlePluginProtocolRequest(url, options)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'image/png')
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.deepEqual(await response.arrayBuffer().then(value => Buffer.from(value)), png)
    enabled = false
    assert.equal((await handlePluginProtocolRequest(url, options)).status, 404)
  })
})

test('plugin protocol refuses symlink files and non-regular file paths', async () => {
  if (process.platform === 'win32') return
  await withPluginRoot(async userData => {
    const root = path.join(userData, 'sample-plugin', '1.0.0')
    fs.mkdirSync(root, { recursive: true })
    const outside = path.join(userData, 'outside.js')
    fs.writeFileSync(outside, 'secret')
    fs.symlinkSync(outside, path.join(root, 'main.js'))
    const options = { pluginRootForId: () => root, hostAssets: pluginHostAssets }
    assert.equal((await handlePluginProtocolRequest('agent-pets://plugin/sample-plugin/main.js', options)).status, 404)
    assert.equal((await handlePluginProtocolRequest('agent-pets://plugin/sample-plugin/missing.js', options)).status, 404)
  })
})

test('plugin-host partition handler serves only token-scoped plugin files and embedded host assets', async () => {
  await withPluginRoot(async userData => {
    const root = path.join(userData, 'sample-plugin', '1.0.0')
    fs.mkdirSync(path.join(root, 'dist'), { recursive: true })
    fs.writeFileSync(path.join(root, 'dist', 'main.js'), 'export default 1')
    const token = '123e4567-e89b-42d3-a456-426614174000'
    let currentRoot: string | null = root
    const handler = createPluginHostProtocolHandler({
      pluginRootForToken: value => value === token ? currentRoot : null,
      hostAssets: pluginHostAssets,
    })
    const pluginResponse = await handler({ url: `agent-pets://plugin/${token}/dist/main.js`, method: 'GET' })
    assert.equal(pluginResponse.status, 200)
    assert.equal(pluginResponse.headers.get('content-security-policy'), PLUGIN_WORKER_CONTENT_SECURITY_POLICY)
    assert.equal(pluginResponse.status, 200)
    assert.equal((await handler({ url: `agent-pets://plugin/${token}/dist/main.js` })).status, 200)
    assert.equal((await handler({ url: 'agent-pets://plugin/sample-plugin/dist/main.js', method: 'GET' })).status, 404)
    assert.equal((await handler({ url: `agent-pets://plugin/${token}/dist/main.js`, method: 'POST' })).status, 405)
    assert.equal((await handler({ url: 'agent-pets://app/index.html', method: 'GET' })).status, 404)
    assert.equal((await handler({ url: 'agent-pets://custom/pet/spritesheet.webp', method: 'GET' })).status, 404)
    assert.equal((await handler({ url: 'agent-pets://plugin/unknown-token/dist/main.js', method: 'GET' })).status, 404)
    assert.equal((await handler({ url: `agent-pets://plugin/${token}/dist/main.js?x=1`, method: 'GET' })).status, 404)
    currentRoot = null
    assert.equal((await handler({ url: `agent-pets://plugin/${token}/dist/main.js`, method: 'GET' })).status, 404)

    const workerBootstrap = await handler({ url: 'agent-pets://plugin/_host/worker-bootstrap.js', method: 'GET' })
    assert.equal(workerBootstrap.status, 200)
    assert.equal(workerBootstrap.headers.get('content-security-policy'), PLUGIN_WORKER_CONTENT_SECURITY_POLICY)
    assert.match(PLUGIN_CONTENT_SECURITY_POLICY, /worker-src agent-pets:\/\/plugin/)
    assert.match(PLUGIN_WORKER_CONTENT_SECURITY_POLICY, /worker-src 'none'/)
  })
})

test('plugin panel protocol serves only token-scoped plugin files and read-only shared tokens.css', async () => {
  await withPluginRoot(async userData => {
    const root = path.join(userData, 'sample-plugin', '1.0.0')
    fs.mkdirSync(path.join(root, 'ui'), { recursive: true })
    fs.writeFileSync(path.join(root, 'ui', 'index.html'), '<main>ok</main>')
    fs.writeFileSync(path.join(root, 'ui', 'app.js'), 'globalThis.started = true')
    fs.writeFileSync(path.join(root, 'notes.txt'), 'private package note')
    const token = '123e4567-e89b-42d3-a456-426614174000'
    let currentRoot: string | null = root
    const handler = createPluginPanelProtocolHandler({
      pluginRootForToken: value => value === token ? currentRoot : null,
      tokensCss: ':root { --pet-ui-test: 1; }',
    })

    const entry = await handler({ url: `agent-pets://plugin/${token}/ui/index.html`, method: 'GET' })
    assert.equal(entry.status, 200)
    assert.equal(entry.headers.get('content-security-policy'), PLUGIN_PANEL_CONTENT_SECURITY_POLICY)
    assert.equal(entry.headers.get('cache-control'), 'no-store')
    assert.equal(await entry.text(), '<main>ok</main>')

    const script = await handler({ url: `agent-pets://plugin/${token}/ui/app.js`, method: 'GET' })
    assert.equal(script.status, 200)
    assert.equal(await script.text(), 'globalThis.started = true')

    const shared = await handler({ url: 'agent-pets://plugin/_shared/tokens.css', method: 'GET' })
    assert.equal(shared.status, 200)
    assert.equal(shared.headers.get('content-type'), 'text/css; charset=utf-8')
    assert.equal(await shared.text(), ':root { --pet-ui-test: 1; }')

    for (const request of [
      { url: `agent-pets://plugin/${token}/notes.txt`, method: 'GET' },
      { url: `agent-pets://plugin/${token}/../notes.txt`, method: 'GET' },
      { url: `agent-pets://plugin/${token}/ui/index.html?x=1`, method: 'GET' },
      { url: 'agent-pets://plugin/_shared/other.css', method: 'GET' },
      { url: 'agent-pets://plugin/sample-plugin/ui/index.html', method: 'GET' },
      { url: `agent-pets://plugin/${token}/ui/index.html`, method: 'POST' },
      { url: 'https://example.com/', method: 'GET' },
    ]) assert.notEqual((await handler(request)).status, 200)

    currentRoot = null
    assert.equal((await handler({ url: `agent-pets://plugin/${token}/ui/index.html`, method: 'GET' })).status, 404)
  })
})

test('plugin panel protocol refuses symlinks and encoded traversal', async () => {
  if (process.platform === 'win32') return
  await withPluginRoot(async userData => {
    const root = path.join(userData, 'sample-plugin', '1.0.0')
    fs.mkdirSync(path.join(root, 'ui'), { recursive: true })
    const outside = path.join(userData, 'outside.html')
    fs.writeFileSync(outside, '<p>outside</p>')
    fs.symlinkSync(outside, path.join(root, 'ui', 'link.html'))
    const token = '123e4567-e89b-42d3-a456-426614174000'
    const handler = createPluginPanelProtocolHandler({
      pluginRootForToken: value => value === token ? root : null,
      tokensCss: '',
    })
    assert.equal((await handler({ url: `agent-pets://plugin/${token}/ui/link.html`, method: 'GET' })).status, 404)
    assert.equal((await handler({ url: `agent-pets://plugin/${token}/%2e%2e/outside.html`, method: 'GET' })).status, 404)
    assert.equal((await handler({ url: `agent-pets://plugin/${token}/ui/link.html`, method: 'GET' })).status, 404)
  })
})
