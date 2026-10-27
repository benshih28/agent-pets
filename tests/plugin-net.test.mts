import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isPluginNetHostAllowed,
  isPluginNetIpBlocked,
  isPublicPluginNetworkHost,
  PluginNetworkClient,
  filterPluginRequestHeaders,
  stripPluginSetCookieHeaders,
  validatePluginNetUrl,
} from '../electron/plugin-net.ts'

test('plugin network blocks loopback, private, link-local, CGNAT and mapped IPv4 addresses', () => {
  for (const address of [
    '0.1.2.3', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.1.2',
    '172.16.0.1', '192.168.1.1', '224.0.0.1', '240.0.0.1', '::', '::1',
    'fc00::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1',
    '192.0.0.1', '192.0.2.1', '198.18.0.1', '198.19.255.254', '198.51.100.1',
    '203.0.113.1', '255.255.255.255', '64:ff9b::a00:1', '64:ff9b::a9fe:101',
    '2002:7f00:1::', '2002:a00:1::', '2001:db8::1', '100::1',
  ]) assert.equal(isPluginNetIpBlocked(address), true, address)
  for (const address of [
    '8.8.8.8', '93.184.216.34', '2606:4700:4700::1111',
    '64:ff9b::808:808', '2002:808:808::',
  ]) {
    assert.equal(isPluginNetIpBlocked(address), false, address)
  }
})

test('host matching allows exact and wildcard subdomains only', () => {
  assert.equal(isPluginNetHostAllowed('api.example.com', ['api.example.com']), true)
  assert.equal(isPluginNetHostAllowed('v2.api.example.com', ['*.example.com']), true)
  assert.equal(isPluginNetHostAllowed('example.com', ['*.example.com']), false)
  assert.equal(isPluginNetHostAllowed('evil-example.com', ['*.example.com']), false)
})

test('plugin response cookie headers are removed before the Session cookie store can receive them', () => {
  assert.deepEqual(stripPluginSetCookieHeaders({
    'content-type': ['application/json'],
    'Set-Cookie': ['sid=one; Secure'],
    'set-cookie2': ['legacy=two'],
  }), { 'content-type': ['application/json'] })
  assert.equal(stripPluginSetCookieHeaders(undefined), undefined)
})

test('plugin requests remove cookies and locale headers and use the fixed user agent', () => {
  assert.deepEqual(filterPluginRequestHeaders({
    Authorization: 'Bearer synthetic',
    Cookie: 'sid=one',
    'Accept-Language': 'zh-TW',
    'User-Agent': 'Electron/43.0 App/1.2',
  }), {
    Authorization: 'Bearer synthetic',
    'User-Agent': 'AgentPetsPlugin/1',
  })
})

test('URL validation rejects http, credentials, ports, IP and unlisted hosts', () => {
  const allowed = ['api.example.com']
  for (const url of [
    'http://api.example.com/', 'https://user:pass@api.example.com/',
    'https://api.example.com:8443/', 'https://127.0.0.1/',
    'https://localhost/', 'https://unlisted.example.com/',
  ]) assert.equal(validatePluginNetUrl(url, allowed), null, url)
  assert.equal(validatePluginNetUrl('https://api.example.com:443/v1', allowed)?.hostname, 'api.example.com')
})

test('requestHost DNS validation requires every address to be public', async () => {
  assert.equal(await isPublicPluginNetworkHost('api.example.com', async () => [
    { address: '93.184.216.34', family: 4 }, { address: '2606:4700:4700::1111', family: 6 },
  ]), true)
  assert.equal(await isPublicPluginNetworkHost('api.example.com', async () => [
    { address: '93.184.216.34', family: 4 }, { address: '10.0.0.4', family: 4 },
  ]), false)
})

test('fetch rechecks DNS after every redirect and blocks a private target', async () => {
  let lookupCount = 0
  let fetchCount = 0
  const client = new PluginNetworkClient({
    now: () => 10_000,
    lookupAll: async () => {
      lookupCount += 1
      return [{ address: lookupCount === 1 ? '93.184.216.34' : '10.0.0.8', family: 4 }]
    },
    request: async () => {
      fetchCount += 1
      return new Response(null, { status: 302, headers: { location: '/redirected' } })
    },
  })
  const result = await client.fetch('demo-plugin', 'https://api.example.com/start', undefined,
    ['api.example.com'], { maxResponseBytes: 1024, timeoutMs: 1000, requestsPerMinute: 30 })
  assert.deepEqual(result, { ok: false, error: 'host_not_allowed' })
  assert.equal(lookupCount, 2)
  assert.equal(fetchCount, 1)
})

test('fetch strips credentials on cross-origin redirects and returns bounded text response', async () => {
  const calls: Array<{ url: string; authorization: string | null }> = []
  const client = new PluginNetworkClient({
    now: () => 10_000,
    lookupAll: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async (url, init) => {
      calls.push({ url, authorization: new Headers(init.headers).get('authorization') })
      return calls.length === 1
        ? new Response(null, { status: 302, headers: { location: 'https://other.example.com/next' } })
        : new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json', etag: '"v1"' } })
    },
  })
  const result = await client.fetch('demo-plugin', 'https://api.example.com/start', {
    headers: { authorization: 'Bearer test-secret' },
  }, ['api.example.com', 'other.example.com'], { maxResponseBytes: 1024, timeoutMs: 1000, requestsPerMinute: 30 })
  assert.deepEqual(calls, [
    { url: 'https://api.example.com/start', authorization: 'Bearer test-secret' },
    { url: 'https://other.example.com/next', authorization: null },
  ])
  assert.deepEqual(result, {
    ok: true,
    value: { status: 200, headers: { 'content-type': 'application/json', etag: '"v1"' }, body: '{"ok":true}' },
  })
})

test('fetch enforces request header allowlist, body and request rate', async () => {
  let fetchCount = 0
  const client = new PluginNetworkClient({
    now: () => 10_000,
    lookupAll: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async () => { fetchCount += 1; return new Response('ok', { headers: { 'content-type': 'text/plain' } }) },
  })
  const limits = { maxResponseBytes: 1024, timeoutMs: 1000, requestsPerMinute: 1 }
  assert.deepEqual(await client.fetch('demo-plugin', 'https://api.example.com', { headers: { cookie: 'bad' } }, ['api.example.com'], limits),
    { ok: false, error: 'invalid_request' })
  assert.deepEqual(await client.fetch('demo-plugin', 'https://api.example.com', { method: 'POST', body: 'x'.repeat(256 * 1024 + 1) }, ['api.example.com'], limits),
    { ok: false, error: 'invalid_request' })
  assert.equal((await client.fetch('demo-plugin', 'https://api.example.com', undefined, ['api.example.com'], limits)).ok, true)
  assert.deepEqual(await client.fetch('demo-plugin', 'https://api.example.com', undefined, ['api.example.com'], limits),
    { ok: false, error: 'rate_limited' })
  assert.equal(fetchCount, 1)
})

test('fetch returns non-text as base64 and rejects response size above the configured cap', async () => {
  const client = new PluginNetworkClient({
    now: () => 10_000,
    lookupAll: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async () => new Response(new Uint8Array([0, 1, 2, 3]), { headers: { 'content-type': 'image/png' } }),
  })
  assert.deepEqual(await client.fetch('binary-plugin', 'https://api.example.com/image', undefined, ['api.example.com'], {
    maxResponseBytes: 8, timeoutMs: 1000, requestsPerMinute: 30,
  }), { ok: true, value: { status: 200, headers: { 'content-type': 'image/png' }, body: 'AAECAw==', isBase64Encoded: true } })
  const largeClient = new PluginNetworkClient({
    now: () => 10_000,
    lookupAll: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async () => new Response(new Uint8Array(16), { headers: { 'content-type': 'text/plain' } }),
  })
  assert.deepEqual(await largeClient.fetch('large-plugin', 'https://api.example.com/data', undefined, ['api.example.com'], {
    maxResponseBytes: 8, timeoutMs: 1000, requestsPerMinute: 30,
  }), { ok: false, error: 'too_large' })
})
