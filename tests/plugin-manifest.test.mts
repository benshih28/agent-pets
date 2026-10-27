import assert from 'node:assert/strict'
import test from 'node:test'
import { isValidPluginNetworkHost, parsePluginManifest } from '../electron/plugin-manifest.ts'

function validManifest() {
  return {
    id: 'tibo-watch',
    name: { 'zh-TW': 'Tibo 推文提醒', 'en-US': 'Tibo Watch' },
    version: '1.0.0',
    apiVersion: '1',
    author: 'Example Author',
    entry: 'dist/main.js',
    icon: 'assets/icon.png',
    permissions: {
      network: { hosts: ['api.x.com', '*.example.com'], userGranted: true },
      secrets: ['xBearerToken'],
      schedule: { minIntervalSec: 300 },
      storage: true,
      agentStatus: false,
    },
    contributes: {
      feed: true,
      reaction: false,
      panelView: {
        entry: 'ui/index.html',
        title: { 'zh-TW': '推文列表', 'en-US': 'Tweets' },
        preferredSize: { width: 480, height: 600 },
      },
      settings: {
        type: 'object',
        properties: {
          username: { type: 'string', title: '追蹤帳號', maxLength: 32, default: 'tibo' },
          xBearerToken: { type: 'string', title: { 'zh-TW': 'API Token', 'en-US': 'API Token' }, format: 'secret' },
          refresh: { type: 'number', minimum: 1, maximum: 5, enum: [1, 3, 5], default: 3 },
          enabled: { type: 'boolean', default: true },
        },
      },
    },
  }
}

function withManifest(update: (manifest: ReturnType<typeof validManifest>) => void) {
  const manifest = validManifest()
  update(manifest)
  return parsePluginManifest(manifest)
}

test('manifest accepts the supported contract and clamps panel preferred size', () => {
  const result = parsePluginManifest(validManifest())
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.manifest.permissions.network?.hosts[1], '*.example.com')
  assert.equal(result.manifest.contributes.settings?.properties.xBearerToken.format, 'secret')

  const clamped = withManifest((manifest) => {
    manifest.contributes.panelView!.preferredSize = { width: 1_200, height: 100 }
  })
  assert.equal(clamped.ok, true)
  if (clamped.ok) {
    assert.deepEqual(clamped.manifest.contributes.panelView?.preferredSize, { width: 960, height: 240 })
  }
})

test('manifest rejects unknown top-level, permission, contribution, and settings fields', () => {
  for (const result of [
    withManifest(manifest => Object.assign(manifest, { runtime: true })),
    withManifest(manifest => Object.assign(manifest.permissions, { filesystem: true })),
    withManifest(manifest => Object.assign(manifest.contributes, { unknownContribution: true })),
    withManifest(manifest => Object.assign(manifest.contributes.settings!.properties.username, { pattern: '.*' })),
  ]) assert.equal(result.ok, false)
})

test('manifest validates eventSource family normalization, reserved families, and localized labels', () => {
  const valid = withManifest(manifest => {
    (manifest.contributes as Record<string, unknown>).eventSource = {
      family: 'Build_Watch',
      displayName: { 'zh-TW': '建置狀態', 'en-US': 'Build state' },
    }
  })
  assert.equal(valid.ok, true)
  if (valid.ok) assert.deepEqual(valid.manifest.contributes.eventSource, {
    family: 'build-watch',
    displayName: { 'zh-TW': '建置狀態', 'en-US': 'Build state' },
  })
  assert.equal(withManifest(manifest => {
    (manifest.contributes as Record<string, unknown>).eventSource = {
      family: 'emoji-state',
      displayName: { 'zh-TW': '😀'.repeat(80), 'en-US': '😀'.repeat(80) },
    }
  }).ok, true)
  assert.equal(withManifest(manifest => {
    (manifest.contributes as Record<string, unknown>).eventSource = {
      family: 'emoji-state',
      displayName: { 'zh-TW': '😀'.repeat(81), 'en-US': '😀'.repeat(81) },
    }
  }).ok, false)

  for (const family of ['codex', 'Claude Code', 'CLAUDE_CODE', 'claude.code', 'generic-http', 'agent_pets', 'plugin', 'system']) {
    assert.equal(withManifest(manifest => {
      (manifest.contributes as Record<string, unknown>).eventSource = { family, displayName: { 'zh-TW': '狀態', 'en-US': 'Status' } }
    }).ok, false, family)
  }
  for (const eventSource of [
    { family: 'build-watch', displayName: { 'zh-TW': '狀態', 'en-US': 'Status' }, extra: true },
    { family: 'build-watch', displayName: { 'zh-TW': 'x'.repeat(81), 'en-US': 'Status' } },
    { family: 'build-watch', displayName: { 'zh-TW': '狀態', 'en-US': 'Status' }, permission: true },
  ]) assert.equal(withManifest(manifest => { (manifest.contributes as Record<string, unknown>).eventSource = eventSource }).ok, false)
})

test('plugin ids follow the bounded lowercase form and reject reserved ids', () => {
  for (const id of ['ab', 'A_plugin', 'a'.repeat(49), '_host', '_shared']) {
    assert.equal(withManifest(manifest => { manifest.id = id }).ok, false, id)
  }
  assert.equal(withManifest(manifest => { manifest.id = 'safe-plugin-1' }).ok, true)
})

test('localized manifest names require both supported locales and bounded nonempty text', () => {
  assert.equal(withManifest(manifest => { manifest.name = { 'zh-TW': '中文' } as typeof manifest.name }).ok, false)
  assert.equal(withManifest(manifest => {
    manifest.name = { 'zh-TW': 'x'.repeat(49), 'en-US': 'Name' }
  }).ok, false)
  const normalized = withManifest(manifest => {
    manifest.name = { 'zh-TW': '  Ｔｉｂｏ\n提醒 ', 'en-US': ' Tibo  Watch ' }
  })
  assert.equal(normalized.ok, true)
  if (normalized.ok) assert.deepEqual(normalized.manifest.name, { 'zh-TW': 'Tibo 提醒', 'en-US': 'Tibo Watch' })
  assert.equal(withManifest(manifest => { manifest.author = 'a'.repeat(65) }).ok, false)
})

test('manifest accepts plain x.y.z versions and only API version 1', () => {
  for (const version of ['1.0', '01.0.0', '1.0.0-beta', '1.0.0+build', '1.2.3.4']) {
    assert.equal(withManifest(manifest => { manifest.version = version }).ok, false, version)
  }
  assert.equal(withManifest(manifest => { manifest.version = '0.0.0' }).ok, true)
  assert.equal(withManifest(manifest => { manifest.apiVersion = '2' }).ok, false)
})

test('network declarations accept DNS names and leftmost wildcards only', () => {
  assert.equal(isValidPluginNetworkHost('api.x.com'), true)
  assert.equal(isValidPluginNetworkHost('*.domain.tld'), true)
  for (const host of [
    '127.0.0.1', '1.2.3.4', '0x7f.1', '127.1', '1.0x7f000001',
    'foo.123', 'a.0x10', '*.0x7f.1', '[::1]', 'localhost', 'api.localhost', 'example.local',
    'api.x.com:443', 'api.x.com/path', 'https://api.x.com', '*.x', '*.*.example.com',
    'api..x.com', '-bad.example.com', 'bad-.example.com', 'api.x.com.',
  ]) assert.equal(isValidPluginNetworkHost(host), false, host)
  assert.equal(isValidPluginNetworkHost('*.domain.tld', false), false)
  assert.equal(isValidPluginNetworkHost('a1.example.com'), true)
  assert.equal(isValidPluginNetworkHost('123abc.example.com'), true)
  assert.equal(withManifest(manifest => {
    manifest.permissions.network!.hosts = Array.from({ length: 21 }, (_, index) => `api${index}.example.com`)
  }).ok, false)
  assert.equal(withManifest(manifest => {
    manifest.permissions.network!.hosts = ['api.example.com', 'api.example.com']
  }).ok, false)
})

test('secret declarations are bounded, unique, and match secret settings fields', () => {
  assert.equal(withManifest(manifest => { manifest.permissions.secrets = ['9bad'] }).ok, false)
  assert.equal(withManifest(manifest => { manifest.permissions.secrets = Array.from({ length: 11 }, (_, i) => `key${i}`) }).ok, false)
  assert.equal(withManifest(manifest => {
    manifest.contributes.settings!.properties.xBearerToken.format = 'secret'
    manifest.permissions.secrets = []
  }).ok, false)
  assert.equal(withManifest(manifest => {
    manifest.permissions.secrets = ['key1', 'key1']
  }).ok, false)
})

test('schedule interval accepts 30–3600 integer seconds only', () => {
  for (const minIntervalSec of [29, 3_601, 30.5, Number.POSITIVE_INFINITY]) {
    assert.equal(withManifest(manifest => { manifest.permissions.schedule!.minIntervalSec = minIntervalSec }).ok, false)
  }
  for (const minIntervalSec of [30, 3_600]) {
    assert.equal(withManifest(manifest => { manifest.permissions.schedule!.minIntervalSec = minIntervalSec }).ok, true)
  }
})

test('manifest paths must be safe relative files with the required extensions', () => {
  for (const entry of ['/main.js', '../main.js', 'dist/../main.js', 'C:/main.js', 'dist\\main.js', 'dist/main.ts']) {
    assert.equal(withManifest(manifest => { manifest.entry = entry }).ok, false, entry)
  }
  for (const icon of ['../icon.png', '/icon.png', 'assets/icon.svg']) {
    assert.equal(withManifest(manifest => { manifest.icon = icon }).ok, false, icon)
  }
  for (const entry of ['/ui/index.html', '../ui.html', 'ui/index.htm']) {
    assert.equal(withManifest(manifest => { manifest.contributes.panelView!.entry = entry }).ok, false, entry)
  }
  assert.equal(withManifest(manifest => { manifest.entry = 'bundle/main.JS' }).ok, true)
})

test('settings schemas bound properties, fields, enums, values, and types', () => {
  const twentyOneProperties = Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`p${index}`, { type: 'string' }]))
  assert.equal(withManifest(manifest => {
    manifest.contributes.settings = { type: 'object', properties: twentyOneProperties } as typeof manifest.contributes.settings
  }).ok, false)
  assert.equal(withManifest(manifest => {
    manifest.contributes.settings!.properties.username.type = 'object' as 'string'
  }).ok, false)
  assert.equal(withManifest(manifest => {
    manifest.contributes.settings!.properties.username.enum = Array.from({ length: 51 }, (_, index) => String(index))
  }).ok, false)
  assert.equal(withManifest(manifest => {
    manifest.contributes.settings!.properties.username.maxLength = 4_097
  }).ok, false)
  assert.equal(withManifest(manifest => {
    manifest.contributes.settings!.properties.refresh.minimum = 10
  }).ok, false)
  assert.equal(withManifest(manifest => {
    manifest.contributes.settings!.properties.username.format = 'secret'
    manifest.permissions.secrets = ['xBearerToken']
  }).ok, false)
  assert.equal(withManifest(manifest => {
    manifest.contributes.settings!.properties.username.default = 'x'.repeat(33)
  }).ok, false)
  assert.equal(withManifest(manifest => {
    manifest.contributes.settings!.properties.username.enum = [1, 2] as unknown as string[]
  }).ok, false)
})

test('optional manifest structures reject malformed shapes and nonboolean flags', () => {
  assert.equal(withManifest(manifest => { manifest.permissions.storage = 'true' as unknown as boolean }).ok, false)
  assert.equal(withManifest(manifest => { manifest.permissions.network = { hosts: ['api.example.com'], userGranted: 1 } as never }).ok, false)
  assert.equal(withManifest(manifest => { manifest.contributes.panelView!.title = 'Panel' as never }).ok, false)
  assert.equal(withManifest(manifest => { manifest.contributes.settings = { type: 'array', properties: {} } as never }).ok, false)
})


test('manifest validates commands, tray references, badge, and localized skins', () => {
  const result = withManifest(manifest => {
    manifest.contributes.commands = [
      { id: 'start', title: { 'zh-TW': '開始', 'en-US': 'Start' } },
      { id: 'stop', title: { 'zh-TW': '停止', 'en-US': 'Stop' } },
    ] as never
    manifest.contributes.tray = { commands: ['start'] } as never
    manifest.contributes.badge = true as never
    manifest.contributes.skins = [{
      id: 'winter-cat', displayName: { 'zh-TW': '冬日貓', 'en-US': 'Winter Cat' },
      spritesheet: 'skins/winter.webp', kind: 'animal', behaviorManifest: { walk: { row: 1, frames: 4 } },
    }] as never
  })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.manifest.contributes.commands?.length, 2)
    assert.deepEqual(result.manifest.contributes.tray?.commands, ['start'])
    assert.equal(result.manifest.contributes.skins?.[0]?.behaviorManifest?.walk?.frames, 4)
  }
})

test('manifest rejects malformed commands, undeclared tray commands, and invalid skin paths', () => {
  for (const result of [
    withManifest(manifest => { manifest.contributes.commands = Array.from({ length: 11 }, (_, index) => ({ id: `c${index}`, title: { 'zh-TW': '命令', 'en-US': 'Command' } })) as never }),
    withManifest(manifest => { manifest.contributes.commands = [{ id: 'Bad_ID', title: { 'zh-TW': '命令', 'en-US': 'Command' } }] as never }),
    withManifest(manifest => { manifest.contributes.commands = [{ id: 'start', title: { 'zh-TW': '命令', 'en-US': 'x'.repeat(33) } }] as never }),
    withManifest(manifest => { manifest.contributes.commands = [{ id: 'start', title: { 'zh-TW': '命令', 'en-US': 'Start' } }, { id: 'start', title: { 'zh-TW': '重複', 'en-US': 'Duplicate' } }] as never }),
    withManifest(manifest => { manifest.contributes.tray = { commands: ['undeclared'] } as never }),
    withManifest(manifest => { manifest.contributes.skins = [{ id: 'cat', displayName: { 'zh-TW': '貓', 'en-US': 'Cat' }, spritesheet: '../cat.webp', kind: 'animal' }] as never }),
  ]) assert.equal(result.ok, false)
})

test('entry may be omitted only for a permission-free skin-only plugin', () => {
  const skinOnly = {
    id: 'skin-pack', name: { 'zh-TW': '外觀包', 'en-US': 'Skin Pack' }, version: '1.0.0', apiVersion: '1', author: 'Example',
    permissions: {}, contributes: { skins: [{ id: 'fox', displayName: { 'zh-TW': '狐狸', 'en-US': 'Fox' }, spritesheet: 'fox.webp', kind: 'animal' }] },
  }
  assert.equal(parsePluginManifest(skinOnly).ok, true)
  assert.equal(parsePluginManifest({ ...skinOnly, contributes: { feed: true, skins: skinOnly.contributes.skins } }).ok, false)
  assert.equal(parsePluginManifest({ ...skinOnly, permissions: { storage: true } }).ok, false)
  assert.equal(parsePluginManifest({ ...skinOnly, contributes: {} }).ok, false)
})
