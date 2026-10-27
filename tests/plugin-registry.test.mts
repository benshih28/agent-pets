import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import test from 'node:test'
import { strToU8, zipSync } from 'fflate'
import { PluginRegistry } from '../electron/plugin-registry.ts'

function withUserData(run: (directory: string) => void): void {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-plugin-registry-'))
  try { run(directory) } finally { fs.rmSync(directory, { recursive: true, force: true }) }
}

async function withUserDataAsync(run: (directory: string) => Promise<void> | void): Promise<void> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-plugin-registry-'))
  try { await run(directory) } finally { fs.rmSync(directory, { recursive: true, force: true }) }
}

function makeArchive(options: {
  version?: string
  apiVersion?: string
  storage?: boolean
  feed?: boolean
  icon?: string
  extraFiles?: Record<string, string>
  panelView?: unknown
  eventSource?: unknown
} = {}): Uint8Array {
  const manifest = {
    id: 'sample-plugin',
    name: { 'zh-TW': '測試插件', 'en-US': 'Sample Plugin' },
    version: options.version ?? '1.0.0',
    apiVersion: options.apiVersion ?? '1',
    author: 'Test Author',
    entry: 'dist/main.js',
    ...(options.icon ? { icon: options.icon } : {}),
    permissions: options.storage ? { storage: true } : {},
    contributes: {
      ...(options.feed ? { feed: true } : {}),
      ...(options.panelView ? { panelView: options.panelView } : {}),
      ...(options.eventSource ? { eventSource: options.eventSource } : {}),
    },
  }
  const entries: Record<string, string | Uint8Array> = {
    'plugin.json': JSON.stringify(manifest),
    'dist/main.js': 'export default { activate() {} }',
    ...(options.extraFiles ?? {}),
  }
  if (options.icon) entries[options.icon] = options.icon.endsWith('.png')
    ? new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    : new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
  return zipSync(Object.fromEntries(Object.entries(entries).map(([name, data]) => [name, typeof data === 'string' ? strToU8(data) : data])))
}

function plan(registry: PluginRegistry, archive: Uint8Array) {
  const result = registry.planInstall(archive)
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error(result.error)
  return result.value
}

test('plugin registry plans and atomically installs a valid archive', () => {
  withUserData((userData) => {
    const registry = new PluginRegistry(userData, { now: () => 1_700_000_000_000, createToken: () => 'plan-token' })
    const installPlan = plan(registry, makeArchive({ icon: 'assets/icon.png' }))
    assert.equal(installPlan.kind, 'new')
    const installed = registry.install(installPlan.token)
    assert.equal(installed.ok, true)
    assert.equal(fs.readFileSync(path.join(userData, 'plugins', 'sample-plugin', '1.0.0', 'dist', 'main.js'), 'utf8'), 'export default { activate() {} }')
    assert.equal(fs.existsSync(path.join(userData, 'plugins', 'registry.json')), true)
    assert.equal(fs.readdirSync(path.join(userData, 'plugins', 'sample-plugin')).some(name => name.startsWith('.staging-')), false)
  })
})

test('plugin registry loads a developer folder through the archive validation path', async () => {
  await withUserDataAsync(async (userData) => {
    const source = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-plugin-source-'))
    try {
      fs.mkdirSync(path.join(source, 'dist'), { recursive: true })
      fs.writeFileSync(path.join(source, 'plugin.json'), JSON.stringify({
        id: 'sample-plugin', name: { 'zh-TW': '測試插件', 'en-US': 'Sample Plugin' }, version: '1.0.0',
        apiVersion: '1', author: 'Test Author', entry: 'dist/main.js', permissions: {}, contributes: { feed: true },
      }))
      fs.writeFileSync(path.join(source, 'dist', 'main.js'), 'export default { activate() {} }')
      const registry = new PluginRegistry(userData)
      const planned = await registry.planInstallDirectory(source)
      assert.equal(planned.ok, true)
      if (!planned.ok) return
      const installed = registry.install(planned.value.token)
      assert.equal(installed.ok, true)
      assert.equal(fs.readFileSync(path.join(userData, 'plugins', 'sample-plugin', '1.0.0', 'dist', 'main.js'), 'utf8'), 'export default { activate() {} }')
    } finally {
      fs.rmSync(source, { recursive: true, force: true })
    }
  })
})

test('plugin registry refuses symlinks and unsupported files in developer folders', async () => {
  await withUserDataAsync(async (userData) => {
    const source = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-plugin-source-'))
    const outside = path.join(source, '..', `${path.basename(source)}-outside.js`)
    try {
      fs.mkdirSync(path.join(source, 'dist'), { recursive: true })
      fs.writeFileSync(path.join(source, 'plugin.json'), '{}')
      fs.writeFileSync(path.join(source, 'dist', 'main.js'), 'export default {}')
      fs.writeFileSync(outside, 'outside')
      fs.symlinkSync(outside, path.join(source, 'dist', 'linked.js'))
      assert.deepEqual(await new PluginRegistry(userData).planInstallDirectory(source), { ok: false, error: 'invalid_archive' })
      fs.rmSync(path.join(source, 'dist', 'linked.js'))
      fs.writeFileSync(path.join(source, 'notes.txt'), 'not packaged')
      assert.deepEqual(await new PluginRegistry(userData).planInstallDirectory(source), { ok: false, error: 'invalid_archive' })
    } finally {
      fs.rmSync(source, { recursive: true, force: true })
      fs.rmSync(outside, { force: true })
    }
  })
})

test('invalid developer folder changes do not replace the installed package', async () => {
  await withUserDataAsync(async (userData) => {
    const source = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-plugin-source-'))
    try {
      fs.mkdirSync(path.join(source, 'dist'), { recursive: true })
      const writeManifest = (version: string) => fs.writeFileSync(path.join(source, 'plugin.json'), JSON.stringify({
        id: 'sample-plugin', name: { 'zh-TW': '測試插件', 'en-US': 'Sample Plugin' }, version,
        apiVersion: '1', author: 'Test Author', entry: 'dist/main.js', permissions: {}, contributes: { feed: true },
      }))
      writeManifest('1.0.0')
      fs.writeFileSync(path.join(source, 'dist', 'main.js'), 'export default { activate() {} }')
      const registry = new PluginRegistry(userData)
      const first = await registry.planInstallDirectory(source)
      assert.equal(first.ok, true)
      if (!first.ok) return
      assert.equal(registry.install(first.value.token).ok, true)

      writeManifest('2.0.0')
      fs.writeFileSync(path.join(source, 'README.txt'), 'unsupported developer file')
      assert.equal((await registry.planInstallDirectory(source)).ok, false)
      assert.equal(registry.list().find(entry => entry.id === 'sample-plugin')?.currentVersion, '1.0.0')
      assert.equal(fs.readFileSync(path.join(userData, 'plugins', 'sample-plugin', '1.0.0', 'dist', 'main.js'), 'utf8'), 'export default { activate() {} }')
    } finally {
      fs.rmSync(source, { recursive: true, force: true })
    }
  })
})

test('plugin registry rejects missing entry, invalid icon, and misplaced html', () => {
  withUserData((userData) => {
    const registry = new PluginRegistry(userData)
    const missingEntry = zipSync({ 'plugin.json': strToU8(JSON.stringify({
      id: 'sample-plugin', name: { 'zh-TW': '測試', 'en-US': 'Test' }, version: '1.0.0', apiVersion: '1', author: 'Test', entry: 'missing.js', permissions: {}, contributes: {},
    })) })
    assert.deepEqual(registry.planInstall(missingEntry), { ok: false, error: 'missing_entry' })
    const invalidIcon = zipSync({
      'plugin.json': strToU8(JSON.stringify({
        id: 'sample-plugin', name: { 'zh-TW': '測試', 'en-US': 'Test' }, version: '1.0.0', apiVersion: '1', author: 'Test', entry: 'dist/main.js', icon: 'icon.png', permissions: {}, contributes: {},
      })),
      'dist/main.js': strToU8('export default {}'),
      'icon.png': strToU8('not an image'),
    })
    assert.deepEqual(registry.planInstall(invalidIcon), { ok: false, error: 'invalid_icon' })
    assert.deepEqual(registry.planInstall(makeArchive({ panelView: { entry: 'panel/index.html', title: { 'zh-TW': '面板', 'en-US': 'Panel' } }, extraFiles: { 'panel/index.html': '<p>ok</p>', 'other/index.html': '<p>no</p>' } })), { ok: false, error: 'invalid_html_location' })
  })
})

test('plugin registry detects update, downgrade, reinstall and requests permission reconsent', () => {
  withUserData((userData) => {
    const registry = new PluginRegistry(userData)
    const first = plan(registry, makeArchive())
    assert.equal(registry.install(first.token).ok, true)
    fs.mkdirSync(path.join(userData, 'plugins', 'sample-plugin', 'data'), { recursive: true })
    fs.writeFileSync(path.join(userData, 'plugins', 'sample-plugin', 'data', 'storage.json'), '{"kept":true}')

    const update = plan(registry, makeArchive({
      version: '2.0.0', storage: true, feed: true,
      eventSource: { family: 'build-watch', displayName: { 'zh-TW': '建置狀態', 'en-US': 'Build status' } },
    }))
    assert.equal(update.kind, 'update')
    assert.equal(update.requiresReconsent, true)
    assert.equal(update.addedPermissions.includes('contributes:eventSource'), true)
    assert.deepEqual(registry.install(update.token), { ok: false, error: 'permission_reconsent_required' })
    assert.equal(registry.install(update.token, true).ok, true)
    assert.equal(fs.readFileSync(path.join(userData, 'plugins', 'sample-plugin', 'data', 'storage.json'), 'utf8'), '{"kept":true}')
    assert.equal(fs.existsSync(path.join(userData, 'plugins', 'sample-plugin', '1.0.0')), false)

    assert.equal(plan(registry, makeArchive({ version: '2.0.0', storage: true, feed: true })).kind, 'reinstall')
    assert.equal(plan(registry, makeArchive({ version: '1.5.0', storage: true, feed: true })).kind, 'downgrade')
  })
})

test('incompatible apiVersion is represented as a rejecting install plan', () => {
  withUserData((userData) => {
    const registry = new PluginRegistry(userData)
    const installPlan = plan(registry, makeArchive({ apiVersion: '2' }))
    assert.equal(installPlan.kind, 'incompatible')
    assert.deepEqual(registry.install(installPlan.token), { ok: false, error: 'incompatible' })
    assert.deepEqual(registry.list(), [])
  })
})

test('remove can preserve plugin data while deleting code, or remove all plugin files', () => {
  withUserData((userData) => {
    const registry = new PluginRegistry(userData)
    const first = plan(registry, makeArchive())
    assert.equal(registry.install(first.token).ok, true)
    const data = path.join(userData, 'plugins', 'sample-plugin', 'data')
    fs.mkdirSync(data, { recursive: true })
    fs.writeFileSync(path.join(data, 'storage.json'), '{}')
    assert.deepEqual(registry.remove('sample-plugin', true), { ok: true, value: { removed: true, keptData: true } })
    assert.equal(fs.existsSync(path.join(userData, 'plugins', 'sample-plugin', '1.0.0')), false)
    assert.equal(fs.existsSync(path.join(data, 'storage.json')), true)

    const reinstalled = plan(registry, makeArchive())
    assert.equal(registry.install(reinstalled.token).ok, true)
    assert.deepEqual(registry.remove('sample-plugin', false), { ok: true, value: { removed: true, keptData: false } })
    assert.equal(fs.existsSync(path.join(userData, 'plugins', 'sample-plugin')), false)
  })
})


test('plugin registry accepts a valid entry-free skin package and rejects invalid spritesheets', () => {
  withUserData(userData => {
    const registry = new PluginRegistry(userData)
    const manifest = {
      id: 'sample-plugin', name: { 'zh-TW': '外觀包', 'en-US': 'Skin Pack' }, version: '1.0.0', apiVersion: '1', author: 'Test Author',
      permissions: {}, contributes: { skins: [{ id: 'fox', displayName: { 'zh-TW': '狐狸', 'en-US': 'Fox' }, spritesheet: 'skins/fox.webp', kind: 'animal' }] },
    }
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
    const archive = zipSync({ 'plugin.json': strToU8(JSON.stringify(manifest)), 'skins/fox.webp': webp })
    const planned = registry.planInstall(archive)
    assert.equal(planned.ok, true, planned.ok ? '' : planned.error)
    if (planned.ok) assert.equal(registry.install(planned.value.token).ok, true)
    const invalid = zipSync({ 'plugin.json': strToU8(JSON.stringify(manifest)), 'skins/fox.webp': strToU8('not an image') })
    assert.deepEqual(registry.planInstall(invalid), { ok: false, error: 'invalid_manifest' })
  })
})
