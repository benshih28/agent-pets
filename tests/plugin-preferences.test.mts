import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import test from 'node:test'
import {
  DEFAULT_PLUGIN_PREFERENCES,
  DEFAULT_PLUGIN_RESOURCES,
  PLUGIN_PREFERENCES_FILENAME,
  PLUGIN_PREFERENCES_MAX_BYTES,
  PLUGIN_RESOURCE_BOUNDS,
  PluginPreferencesFileError,
  PluginPreferencesStore,
  pluginHostMemoryBudgetMb,
} from '../electron/plugin-preferences.ts'
import { DEFAULT_PLUGIN_CATALOG_URL } from '../src/types/plugin-catalog.ts'
import { POSIX_FILE_MODES, SKIP_WITHOUT_FILE_SYMLINKS } from './support/fs-capabilities.mts'

function withUserData(run: (userData: string) => void): void {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-plugin-preferences-'))
  try { run(userData) } finally { fs.rmSync(userData, { recursive: true, force: true }) }
}

test('plugin preferences use secure defaults and persist under userData atomically', () => {
  withUserData((userData) => {
    const store = new PluginPreferencesStore(userData)
    assert.deepEqual(store.get(), DEFAULT_PLUGIN_PREFERENCES)
    assert.deepEqual(store.getPlugin('sample'), {
      enabled: false,
      muted: false,
      rateLimitPer10Min: 5,
      targetPetId: null,
      grantedHosts: [],
    })

    const updated = store.updateGlobal({ pluginsEnabled: true, developerMode: true })
    store.updatePlugin('sample', {
      enabled: true,
      muted: true,
      rateLimitPer10Min: 12,
      targetPetId: 'pet-main',
      grantedHosts: ['api.example.com'],
    })

    const filePath = path.join(userData, PLUGIN_PREFERENCES_FILENAME)
    assert.equal(fs.existsSync(filePath), true)
    if (POSIX_FILE_MODES) assert.equal(fs.statSync(filePath).mode & 0o777, 0o600)
    assert.equal(updated.pluginsEnabled, true)

    const reopened = new PluginPreferencesStore(userData)
    assert.equal(reopened.get().pluginsEnabled, true)
    assert.equal(reopened.get().developerMode, true)
    assert.deepEqual(reopened.getPlugin('sample'), {
      enabled: true,
      muted: true,
      rateLimitPer10Min: 12,
      targetPetId: 'pet-main',
      grantedHosts: ['api.example.com'],
    })
  })
})

test('resource defaults match the plan and accept values only within each hard bound', () => {
  withUserData((userData) => {
    const store = new PluginPreferencesStore(userData)
    assert.deepEqual(store.get().resources, DEFAULT_PLUGIN_RESOURCES)
    assert.equal(Object.isFrozen(PLUGIN_RESOURCE_BOUNDS), true)
    assert.equal(Object.isFrozen(PLUGIN_RESOURCE_BOUNDS.maxEnabledPlugins), true)
    for (const [key, bounds] of Object.entries(PLUGIN_RESOURCE_BOUNDS)) {
      const field = key as keyof typeof PLUGIN_RESOURCE_BOUNDS
      const atMinimum = store.updateGlobal({ resources: { [field]: bounds.min } })
      assert.equal(atMinimum.resources[field], bounds.min)
      const atMaximum = store.updateGlobal({ resources: { [field]: bounds.max } })
      assert.equal(atMaximum.resources[field], bounds.max)
      assert.throws(() => store.updateGlobal({ resources: { [field]: bounds.min - 1 } }), TypeError)
      assert.throws(() => store.updateGlobal({ resources: { [field]: bounds.max + 1 } }), TypeError)
      assert.throws(() => store.updateGlobal({ resources: { [field]: bounds.default + 0.5 } }), TypeError)
    }
    assert.equal(store.get().resources.maxEnabledPlugins, PLUGIN_RESOURCE_BOUNDS.maxEnabledPlugins.max)
  })
})

test('global and per-plugin patches reject unknown fields and invalid types', () => {
  withUserData((userData) => {
    const store = new PluginPreferencesStore(userData)
    assert.throws(() => store.updateGlobal({ unknown: true }), /Unsupported plugin preference/)
    assert.throws(() => store.updateGlobal({ pluginsEnabled: 'yes' }), /must be boolean/)
    assert.throws(() => store.updateGlobal({ resources: { surprise: 1 } }), /hard bounds/)
    assert.throws(() => store.updatePlugin('sample', { enabled: 1 }), /must be boolean/)
    assert.throws(() => store.updatePlugin('sample', { unknown: true }), /Unsupported per-plugin preference/)
    assert.throws(() => store.updatePlugin('sample', { rateLimitPer10Min: 0 }), /from 1 to 30/)
    assert.throws(() => store.updatePlugin('sample', { rateLimitPer10Min: 31 }), /from 1 to 30/)
    assert.throws(() => store.updatePlugin('bad id', { enabled: true }), /Plugin id is invalid/)
    assert.throws(() => store.getPlugin('_host'), /Plugin id is invalid/)
  })
})

test('per-plugin target, host grants, and notification rate are bounded and canonicalized', () => {
  withUserData((userData) => {
    const store = new PluginPreferencesStore(userData)
    assert.throws(() => store.updatePlugin('sample', { targetPetId: '../outside' }), /target pet id/)
    assert.throws(() => store.updatePlugin('sample', { grantedHosts: ['localhost'] }), /granted host/)
    assert.throws(() => store.updatePlugin('sample', { grantedHosts: ['127.0.0.1'] }), /granted host/)
    assert.throws(() => store.updatePlugin('sample', { grantedHosts: ['*.example.com'] }), /granted host/)
    assert.throws(() => store.updatePlugin('sample', { grantedHosts: Array.from({ length: 51 }, (_, index) => `api-${index}.example.com`) }), /at most 50/)
    assert.throws(() => store.updatePlugin('sample', { grantedHosts: ['api.example.com', 'api.example.com'] }), /unique/)

    const updated = store.updatePlugin('sample', {
      targetPetId: null,
      grantedHosts: ['api.example.com', 'feeds.example.net'],
      rateLimitPer10Min: 30,
    })
    assert.deepEqual(updated.plugins.sample?.grantedHosts, ['api.example.com', 'feeds.example.net'])
    assert.equal(updated.plugins.sample?.targetPetId, null)
    assert.equal(updated.plugins.sample?.rateLimitPer10Min, 30)

    const skinTarget = store.updatePlugin('sample', { targetPetId: 'plugin:skin-pack:winter-fox' })
    assert.equal(skinTarget.plugins.sample?.targetPetId, 'plugin:skin-pack:winter-fox')
    assert.throws(() => store.updatePlugin('sample', { targetPetId: 'plugin:skin-pack:../fox' }), /target pet id/)
  })
})

test('returned preference objects cannot mutate the cached state', () => {
  withUserData((userData) => {
    const store = new PluginPreferencesStore(userData)
    const snapshot = store.get()
    snapshot.resources.maxEnabledPlugins = 50
    snapshot.plugins.sample = {
      enabled: true,
      muted: false,
      rateLimitPer10Min: 30,
      targetPetId: null,
      grantedHosts: ['api.example.com'],
    }
    const plugin = store.getPlugin('sample')
    plugin.grantedHosts.push('attacker.example')
    assert.equal(store.get().resources.maxEnabledPlugins, DEFAULT_PLUGIN_RESOURCES.maxEnabledPlugins)
    assert.equal(store.getPlugin('sample').enabled, false)
    assert.deepEqual(store.getPlugin('sample').grantedHosts, [])
  })
})

test('stored preferences ignore unknown fields and discard only an invalid plugin entry', () => {
  withUserData((userData) => {
    const filePath = path.join(userData, PLUGIN_PREFERENCES_FILENAME)
    fs.writeFileSync(filePath, JSON.stringify({
      pluginsEnabled: true,
      developerMode: 'invalid',
      resources: { maxEnabledPlugins: 25, memoryMbPerPlugin: 'invalid', futureResource: 99 },
      futureRoot: true,
      plugins: {
        sample: { enabled: true, futurePluginField: 'ignored' },
        broken: { enabled: 'yes' },
        another: { muted: true },
      },
    }))
    const store = new PluginPreferencesStore(userData)
    const loaded = store.get()
    assert.equal(loaded.pluginsEnabled, true)
    assert.equal(loaded.developerMode, false)
    assert.equal(loaded.resources.maxEnabledPlugins, 25)
    assert.equal(loaded.resources.memoryMbPerPlugin, DEFAULT_PLUGIN_RESOURCES.memoryMbPerPlugin)
    assert.equal(loaded.plugins.sample?.enabled, true)
    assert.equal(store.getPlugin('broken').enabled, false)
    assert.equal(loaded.plugins.another?.muted, true)

    store.updateGlobal({ pluginsEnabled: false })
    const persisted = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
      futureRoot?: unknown
      resources: Record<string, unknown>
      plugins: Record<string, Record<string, unknown>>
    }
    assert.equal(persisted.futureRoot, undefined)
    assert.equal(persisted.resources.futureResource, undefined)
    assert.equal(persisted.plugins.sample.futurePluginField, undefined)
    assert.equal(persisted.plugins.broken, undefined)
  })
})

test('malformed and oversized preference files are backed up before the first write', () => {
  withUserData((userData) => {
    const filePath = path.join(userData, PLUGIN_PREFERENCES_FILENAME)
    const malformed = '{bad json'
    fs.writeFileSync(filePath, malformed)
    const corrupt = new PluginPreferencesStore(userData)
    assert.equal(corrupt.get().pluginsEnabled, false)
    corrupt.updateGlobal({ pluginsEnabled: true })
    const corruptBackup = fs.readdirSync(userData).find(name => name.startsWith(`${PLUGIN_PREFERENCES_FILENAME}.corrupt-`))
    assert.ok(corruptBackup)
    assert.equal(fs.readFileSync(path.join(userData, corruptBackup!), 'utf8'), malformed)
    assert.equal(new PluginPreferencesStore(userData).get().pluginsEnabled, true)

    fs.writeFileSync(filePath, 'x'.repeat(PLUGIN_PREFERENCES_MAX_BYTES + 1))
    const oversized = new PluginPreferencesStore(userData)
    assert.equal(oversized.get().pluginsEnabled, false)
    oversized.updateGlobal({ developerMode: true })
    const backups = fs.readdirSync(userData).filter(name => name.startsWith(`${PLUGIN_PREFERENCES_FILENAME}.corrupt-`))
    assert.equal(backups.length, 2)
    assert.equal(backups.filter(name => fs.statSync(path.join(userData, name)).size === PLUGIN_PREFERENCES_MAX_BYTES + 1).length, 1)
    assert.equal(new PluginPreferencesStore(userData).get().developerMode, true)
  })
})

test('preference writes reject symlinks and non-regular files with a typed error', { skip: SKIP_WITHOUT_FILE_SYMLINKS }, () => {
  withUserData((userData) => {
    const filePath = path.join(userData, PLUGIN_PREFERENCES_FILENAME)
    const targetPath = path.join(userData, 'target.json')
    fs.writeFileSync(targetPath, '{"safe":true}')
    fs.symlinkSync(targetPath, filePath)
    const symlinkStore = new PluginPreferencesStore(userData)
    assert.throws(() => symlinkStore.updateGlobal({ pluginsEnabled: true }), PluginPreferencesFileError)
    assert.equal(fs.readFileSync(targetPath, 'utf8'), '{"safe":true}')

    fs.unlinkSync(filePath)
    fs.mkdirSync(filePath)
    const directoryStore = new PluginPreferencesStore(userData)
    assert.throws(() => directoryStore.updateGlobal({ pluginsEnabled: true }), PluginPreferencesFileError)
  })
})

test('symlink preference files fail closed without being renamed or replaced', { skip: SKIP_WITHOUT_FILE_SYMLINKS }, () => {
  withUserData((userData) => {
    const filePath = path.join(userData, PLUGIN_PREFERENCES_FILENAME)
    const outside = path.join(userData, 'outside.json')
    fs.writeFileSync(outside, JSON.stringify({ pluginsEnabled: true }))
    fs.symlinkSync(outside, filePath)
    const symlinked = new PluginPreferencesStore(userData)
    assert.equal(symlinked.get().pluginsEnabled, false)
    assert.throws(() => symlinked.updateGlobal({ pluginsEnabled: true }), /unsafe/)
    assert.equal(fs.lstatSync(filePath).isSymbolicLink(), true)
    assert.equal(fs.readdirSync(userData).some(name => name.startsWith(`${PLUGIN_PREFERENCES_FILENAME}.corrupt-`)), false)
    assert.equal(JSON.parse(fs.readFileSync(outside, 'utf8')).pluginsEnabled, true)
  })
})

test('removePlugin deletes only that plugin settings and writes the remaining preferences', () => {
  withUserData((userData) => {
    const store = new PluginPreferencesStore(userData)
    store.updatePlugin('sample', { enabled: true, grantedHosts: ['api.example.com'] })
    store.updatePlugin('another', { muted: true })
    const remaining = store.removePlugin('sample')
    assert.equal(remaining.plugins.sample, undefined)
    assert.equal(remaining.plugins.another?.muted, true)
    assert.equal(new PluginPreferencesStore(userData).getPlugin('sample').enabled, false)
  })
})

test('online catalog stays off by default and persists only allowed HTTPS GitHub URLs', () => {
  withUserData((userData) => {
    const store = new PluginPreferencesStore(userData)
    assert.equal(store.get().onlineCatalogEnabled, false)
    assert.equal(store.get().dailyUpdateCheck, false)
    assert.equal(store.get().catalogUrl, DEFAULT_PLUGIN_CATALOG_URL)
    assert.throws(() => store.updateGlobal({ catalogUrl: 'http://raw.githubusercontent.com/example/index.json' }), /catalog URL/)
    assert.throws(() => store.updateGlobal({ catalogUrl: 'https://example.com/index.json' }), /catalog URL/)
    assert.throws(() => store.updateGlobal({ catalogUrl: 'https://user:pass@github.com/example/index.json' }), /catalog URL/)
    assert.throws(() => store.updateGlobal({ onlineCatalogEnabled: 'yes' as unknown as boolean }), /must be boolean/)

    const updated = store.updateGlobal({
      onlineCatalogEnabled: true,
      catalogUrl: 'https://raw.githubusercontent.com/example/plugins/main/index.json',
    })
    assert.equal(updated.onlineCatalogEnabled, true)
    assert.equal(new PluginPreferencesStore(userData).get().catalogUrl,
      'https://raw.githubusercontent.com/example/plugins/main/index.json')
    const scheduled = store.updateGlobal({ dailyUpdateCheck: true })
    assert.equal(scheduled.dailyUpdateCheck, true)
    assert.throws(() => store.updateGlobal({ dailyUpdateCheck: 'yes' as unknown as boolean }), /must be boolean/)
    assert.equal(store.updateGlobal({ onlineCatalogEnabled: false }).dailyUpdateCheck, false)
    assert.throws(() => store.updateGlobal({ dailyUpdateCheck: true }), /require the online catalog/)
  })
})

test('legacy preferences without catalogUrl adopt the default while explicit empty stays editable', () => {
  withUserData((userData) => {
    const file = path.join(userData, PLUGIN_PREFERENCES_FILENAME)
    fs.writeFileSync(file, JSON.stringify({ pluginsEnabled: false, plugins: {} }))
    const store = new PluginPreferencesStore(userData)
    assert.equal(store.get().catalogUrl, DEFAULT_PLUGIN_CATALOG_URL)
    assert.equal(store.updateGlobal({ catalogUrl: '' }).catalogUrl, '')
  })
})

test('daily catalog check date persists privately and rejects malformed dates', () => {
  withUserData((userData) => {
    const store = new PluginPreferencesStore(userData)
    assert.equal(store.getLastCatalogAutoCheckDay(), null)
    assert.throws(() => store.setLastCatalogAutoCheckDay('2026-99-99'), /day is invalid/)
    store.setLastCatalogAutoCheckDay('2026-10-26')
    assert.equal(new PluginPreferencesStore(userData).getLastCatalogAutoCheckDay(), '2026-10-26')
    assert.equal(Object.hasOwn(new PluginPreferencesStore(userData).get(), 'lastCatalogAutoCheckDay'), false)
  })
})

test('plugin host memory budget is the combined per-plugin growth allowance', () => {
  assert.equal(pluginHostMemoryBudgetMb(DEFAULT_PLUGIN_RESOURCES.memoryMbPerPlugin, 1), 64)
  assert.equal(pluginHostMemoryBudgetMb(PLUGIN_RESOURCE_BOUNDS.memoryMbPerPlugin.min, 2), 32)
  assert.equal(pluginHostMemoryBudgetMb(64, 3), 192)
  assert.equal(pluginHostMemoryBudgetMb(64, 0), 0)
  assert.equal(pluginHostMemoryBudgetMb(0, 2), 0)
  assert.equal(pluginHostMemoryBudgetMb(Number.NaN, 2), 0)
})
