import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import test from 'node:test'
import {
  PLUGIN_CATALOG_ALLOWED_HOSTS,
  PLUGIN_CATALOG_MAX_BYTES,
  PLUGIN_CATALOG_MAX_PACKAGE_BYTES,
  catalogFingerprintMatches,
  comparePluginSemver,
  createPluginCatalogGateway,
  isPluginCatalogUrl,
  isCatalogVersionNewer,
  parsePluginCatalog,
  selectLatestCompatiblePluginVersion,
} from '../electron/plugin-catalog.ts'
import { PluginNetworkClient } from '../electron/plugin-net.ts'
import type { PluginCatalogPlugin, PluginCatalogVersion } from '../src/types/plugin-catalog.ts'
import { DEFAULT_PLUGIN_CATALOG_URL, shouldShowCatalogPermissionCheck } from '../src/types/plugin-catalog.ts'

test('default catalog URL is the public index and unknown permission changes require post-download confirmation', () => {
  assert.equal(DEFAULT_PLUGIN_CATALOG_URL,
    'https://raw.githubusercontent.com/Ponpon55837/agent-pets-plugins/main/index.json')
  assert.equal(shouldShowCatalogPermissionCheck(null, true), true)
  assert.equal(shouldShowCatalogPermissionCheck(false, true), false)
  assert.equal(shouldShowCatalogPermissionCheck(null, false), false)
})

function version(overrides: Partial<PluginCatalogVersion> = {}): PluginCatalogVersion {
  const bytes = Buffer.from('sample package')
  return {
    version: '1.0.0',
    apiVersion: '1',
    url: 'https://github.com/example/sample-plugin/releases/download/v1.0.0/sample.agentpet-plugin',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: bytes.byteLength,
    publishedAt: '2026-10-26T00:00:00Z',
    ...overrides,
  }
}

function plugin(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sample-plugin',
    name: { 'zh-TW': '範例插件', 'en-US': 'Sample Plugin' },
    description: { 'zh-TW': '目錄範例', 'en-US': 'Catalog example' },
    author: 'Example Author',
    versions: [version()],
    ...overrides,
  }
}

test('registry parser keeps valid plugins and drops only malformed entries', () => {
  const parsed = parsePluginCatalog({ schemaVersion: 1, plugins: [
    plugin(),
    plugin({ id: 'bad id' }),
    plugin({ author: 'A'.repeat(65) }),
    plugin({ versions: [version({ size: PLUGIN_CATALOG_MAX_PACKAGE_BYTES + 1 })] }),
  ] })
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.deepEqual(parsed.value.plugins.map(entry => entry.id), ['sample-plugin'])
})

test('registry enforces root size, schema version, count limits, and bounded entry versions', () => {
  assert.deepEqual(parsePluginCatalog({ schemaVersion: 2, plugins: [] }), { ok: false, error: 'catalog_invalid' })
  assert.deepEqual(parsePluginCatalog('x'.repeat(PLUGIN_CATALOG_MAX_BYTES + 1)), { ok: false, error: 'catalog_invalid' })
  assert.deepEqual(parsePluginCatalog({ schemaVersion: 1, plugins: Array.from({ length: 501 }, () => plugin()) }), {
    ok: false, error: 'catalog_invalid',
  })
  const tooManyVersions = Array.from({ length: 21 }, (_, index) => version({ version: `1.${index}.0` }))
  const parsed = parsePluginCatalog({ schemaVersion: 1, plugins: [plugin({ versions: tooManyVersions })] })
  assert.equal(parsed.ok, true)
  if (parsed.ok) assert.deepEqual(parsed.value.plugins, [])
})

test('registry drops disallowed download hosts, invalid fingerprint, malformed localized text, and unknown fields', () => {
  const blockedHost = parsePluginCatalog({ schemaVersion: 1, plugins: [
    plugin({ versions: [version({ url: 'https://evil.example/package.agentpet-plugin' })] }),
  ] })
  assert.equal(blockedHost.ok, true)
  if (blockedHost.ok) assert.deepEqual(blockedHost.value.plugins, [])

  const malformed = parsePluginCatalog({ schemaVersion: 1, plugins: [
    plugin({ publicKeyFingerprint: 'x'.repeat(16) }),
    plugin({ name: { 'zh-TW': '名字', 'en-US': 'Name', extra: true } }),
    plugin({ extra: true }),
    plugin({ versions: [version({ extra: true } as Partial<PluginCatalogVersion>)] }),
  ] })
  assert.equal(malformed.ok, true)
  if (malformed.ok) assert.deepEqual(malformed.value.plugins, [])
})

test('registry accepts its published example and rejects invalid plugin fields independently', () => {
  const example = JSON.parse(fs.readFileSync(new URL('../docs/plugins/registry/index.example.json', import.meta.url), 'utf8')) as unknown
  const parsedExample = parsePluginCatalog(example)
  assert.equal(parsedExample.ok, true)
  if (parsedExample.ok) assert.equal(parsedExample.value.plugins[0]?.id, 'sample-plugin')

  const invalidPlugins = [
    plugin({ id: 'bad id' }),
    plugin({ name: { 'zh-TW': '', 'en-US': 'Name' } }),
    plugin({ name: { 'zh-TW': '名'.repeat(49), 'en-US': 'Name' } }),
    plugin({ description: { 'zh-TW': '簡介', 'en-US': 'x'.repeat(201) } }),
    plugin({ author: '' }),
    plugin({ author: 'A\nuthor' }),
    plugin({ homepage: 'http://github.com/example/plugin' }),
    plugin({ homepage: 'https://user:pass@github.com/example/plugin' }),
    plugin({ homepage: 'https://127.0.0.1/example/plugin' }),
    plugin({ publicKeyFingerprint: '0123456789abcde' }),
    plugin({ versions: [] }),
    plugin({ versions: Array.from({ length: 21 }, (_, index) => version({ version: `1.${index}.0` })) }),
  ]
  for (const invalidPlugin of invalidPlugins) {
    const parsed = parsePluginCatalog({ schemaVersion: 1, plugins: [invalidPlugin] })
    assert.equal(parsed.ok, true)
    if (parsed.ok) assert.deepEqual(parsed.value.plugins, [])
  }
})

test('catalog metadata validates homepage, dates, URLs, digests, sizes, and API version fields', () => {
  const invalidVersions: Array<Partial<PluginCatalogVersion>> = [
    { version: '01.0.0' },
    { apiVersion: '1.0' },
    { url: 'http://github.com/example/package.agentpet-plugin' },
    { url: 'https://example.com/package.agentpet-plugin' },
    { url: 'https://user:pass@github.com/package.agentpet-plugin' },
    { url: 'https://github.com:444/package.agentpet-plugin' },
    { sha256: 'a'.repeat(63) },
    { size: 0 },
    { size: PLUGIN_CATALOG_MAX_PACKAGE_BYTES + 1 },
    { publishedAt: 'yesterday' },
  ]
  for (const invalidVersion of invalidVersions) {
    const parsed = parsePluginCatalog({ schemaVersion: 1, plugins: [plugin({ versions: [version(invalidVersion)] })] })
    assert.equal(parsed.ok, true)
    if (parsed.ok) assert.equal(parsed.value.plugins.length, 0)
  }
  const invalidHomepages = [
    'http://github.com/example/plugin',
    'https://user:pass@github.com/example/plugin',
    'https://127.0.0.1/example/plugin',
    'https://github.com\n.evil.example/plugin',
  ]
  for (const homepage of invalidHomepages) {
    const parsed = parsePluginCatalog({ schemaVersion: 1, plugins: [plugin({ homepage })] })
    assert.equal(parsed.ok, true)
    if (parsed.ok) assert.equal(parsed.value.plugins.length, 0)
  }
  const valid = parsePluginCatalog({ schemaVersion: 1, plugins: [plugin({
    homepage: 'https://github.com/example/sample-plugin',
    publicKeyFingerprint: '0123456789abcdef',
    versions: [version({ apiVersion: '2' }), version({ version: '1.1.0', apiVersion: '1' })],
  })] })
  assert.equal(valid.ok, true)
  if (valid.ok) assert.equal(valid.value.plugins[0]?.versions.length, 2)
  assert.equal(isPluginCatalogUrl('https://raw.githubusercontent.com/example/catalog/main/index.json'), true)
  assert.equal(isPluginCatalogUrl('https://raw.githubusercontent.com.evil.example/index.json'), false)
  assert.equal(isPluginCatalogUrl('https://github.com:444/example/catalog'), false)
})

test('duplicate plugin IDs are discarded as ambiguous and invalid versions are skipped individually', () => {
  const parsed = parsePluginCatalog({ schemaVersion: 1, plugins: [
    plugin(),
    plugin({ id: 'other-plugin', versions: [
      version({ version: '1.0.0', url: 'https://evil.example/blocked.agentpet-plugin' }),
      version({ version: '1.1.0' }),
    ] }),
    plugin(),
  ] })
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.deepEqual(parsed.value.plugins.map(entry => entry.id), ['other-plugin'])
  assert.deepEqual(parsed.value.plugins[0]?.versions.map(entry => entry.version), ['1.1.0'])
})

test('semver selects the latest compatible version and compares prereleases by SemVer precedence', () => {
  const candidate: PluginCatalogPlugin = {
    id: 'sample-plugin',
    name: { 'zh-TW': '範例插件', 'en-US': 'Sample Plugin' },
    description: { 'zh-TW': '目錄範例', 'en-US': 'Catalog example' },
    author: 'Example Author',
    versions: [
      version({ version: '2.0.0', apiVersion: '2' }),
      version({ version: '1.0.0-alpha.2' }),
      version({ version: '1.0.0-alpha.10' }),
      version({ version: '1.0.0' }),
    ],
  }
  assert.equal(selectLatestCompatiblePluginVersion(candidate, '1')?.version, '1.0.0')
  assert.equal(selectLatestCompatiblePluginVersion(candidate, '3'), null)
  assert.equal(comparePluginSemver('1.0.0-alpha', '1.0.0-alpha.2'), -1)
  assert.equal(comparePluginSemver('1.0.0-alpha.2', '1.0.0-alpha.10'), -1)
  assert.equal(comparePluginSemver('1.0.0-rc.1', '1.0.0'), -1)
  assert.equal(comparePluginSemver('1.0.0+build.1', '1.0.0+build.2'), 0)
  assert.equal(comparePluginSemver('01.0.0', '1.0.0'), null)
  assert.equal(isCatalogVersionNewer('1.0.0', '1.1.0'), true)
  assert.equal(isCatalogVersionNewer('1.1.0', '1.0.0'), false)
})

test('catalog gateway injects registry and download functions and checks exact size and SHA-256', async () => {
  const bytes = Buffer.from('sample package')
  const itemVersion = version()
  let requestedRegistry = ''
  let requestedArchive = ''
  let registryLimit = 0
  let archiveLimit = 0
  const gateway = createPluginCatalogGateway({
    fetchRegistry: async (url, maxBytes) => {
      requestedRegistry = url
      registryLimit = maxBytes
      return JSON.stringify({ schemaVersion: 1, plugins: [plugin({ versions: [itemVersion] })] })
    },
    downloadArchive: async (url, maxBytes) => {
      requestedArchive = url
      archiveLimit = maxBytes
      return bytes
    },
  })
  const loaded = await gateway.load('https://raw.githubusercontent.com/example/plugins/main/index.json')
  assert.equal(loaded.ok, true)
  assert.equal(requestedRegistry, 'https://raw.githubusercontent.com/example/plugins/main/index.json')
  assert.equal(registryLimit, PLUGIN_CATALOG_MAX_BYTES)
  const downloaded = await gateway.download(itemVersion)
  assert.equal(downloaded.ok, true)
  if (downloaded.ok) assert.deepEqual(Buffer.from(downloaded.value), bytes)
  assert.equal(requestedArchive, itemVersion.url)
  assert.equal(archiveLimit, PLUGIN_CATALOG_MAX_PACKAGE_BYTES)

  const mismatch = createPluginCatalogGateway({
    fetchRegistry: async () => ({}),
    downloadArchive: async () => Buffer.from('different'),
  })
  assert.deepEqual(await mismatch.download(itemVersion), { ok: false, error: 'download_mismatch' })

  const oversized = createPluginCatalogGateway({
    fetchRegistry: async () => ({}),
    downloadArchive: async () => { throw Object.assign(new Error('too large'), { code: 'too_large' }) },
  })
  assert.deepEqual(await oversized.download(itemVersion), { ok: false, error: 'download_mismatch' })
})

test('catalog URLs reject unsupported hosts and fingerprint pins must match the verified signature', async () => {
  const gateway = createPluginCatalogGateway({
    fetchRegistry: async () => { throw new Error('should not fetch') },
    downloadArchive: async () => { throw new Error('should not download') },
  })
  assert.deepEqual(await gateway.load('https://example.com/index.json'), { ok: false, error: 'host_not_allowed' })
  assert.equal(PLUGIN_CATALOG_ALLOWED_HOSTS.includes('raw.githubusercontent.com'), true)
  assert.equal(catalogFingerprintMatches(undefined, undefined), true)
  assert.equal(catalogFingerprintMatches('0123456789abcdef', '0123456789abcdef'), true)
  assert.equal(catalogFingerprintMatches('0123456789abcdef', 'fedcba9876543210'), false)
  assert.equal(catalogFingerprintMatches('bad', 'bad'), false)
})

test('catalog gateway distinguishes a missing default index from other network failures', async () => {
  const gateway = createPluginCatalogGateway({
    fetchRegistry: async () => { throw Object.assign(new Error('Not found'), { code: 'catalog_not_found' }) },
    downloadArchive: async () => Buffer.alloc(0),
  })
  assert.deepEqual(await gateway.load(DEFAULT_PLUGIN_CATALOG_URL), { ok: false, error: 'catalog_not_found' })
})

test('plugin network redirects are revalidated and cannot escape the fixed catalog hosts', async () => {
  let requestCount = 0
  const client = new PluginNetworkClient({
    lookupAll: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async () => {
      requestCount += 1
      return new Response(null, { status: 302, headers: { location: 'https://evil.example/redirected.json' } })
    },
    now: () => 1_700_000_000_000,
  })
  const result = await client.fetch(
    'plugin-catalog',
    'https://raw.githubusercontent.com/example/plugins/main/index.json',
    undefined,
    PLUGIN_CATALOG_ALLOWED_HOSTS,
    { maxResponseBytes: 1024, timeoutMs: 1000, requestsPerMinute: 10 },
  )
  assert.deepEqual(result, { ok: false, error: 'host_not_allowed' })
  assert.equal(requestCount, 1)
})
