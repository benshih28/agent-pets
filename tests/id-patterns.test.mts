import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {
  isKeyFingerprint,
  isPluginCommandId,
  isPluginId,
  isProjectId,
  isSafeItemId,
  isSemverCore,
  isUuidV4,
  PLUGIN_COMMAND_ID_PATTERN,
  PLUGIN_ID_PATTERN,
  PLUGIN_ID_SOURCE,
} from '../src/types/id-patterns.ts'
import { pluginHostAssets } from '../electron/plugin-host-assets.ts'
import { isRecord } from '../electron/value-guards.ts'

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap(name => {
    const file = path.join(directory, name)
    if (statSync(file).isDirectory()) return sourceFiles(file)
    return /\.(?:ts|vue|mjs)$/.test(file) ? [file] : []
  })
}

test('identifier guards accept the documented formats and reject everything else', () => {
  for (const id of ['ok-notify', 'abc', 'a'.repeat(48)]) assert.equal(isPluginId(id), true, id)
  for (const id of ['_host', '_shared', 'ab', 'a'.repeat(49), 'Upper', '../x', 'a b', 'ab\n', 7, null]) assert.equal(isPluginId(id), false, String(id))
  assert.equal(isPluginCommandId('open-panel'), true)
  for (const id of ['1open', 'Open', `a${'b'.repeat(32)}`, '']) assert.equal(isPluginCommandId(id), false, id)
  assert.equal(isSafeItemId('abcd_EF-12'), true)
  assert.equal(isSafeItemId('short'), false)
  assert.equal(isKeyFingerprint('0123456789abcdef'), true)
  assert.equal(isKeyFingerprint('0123456789ABCDEF'), false)
  assert.equal(isProjectId('a'.repeat(32)), true)
  assert.equal(isProjectId('a'.repeat(31)), false)
  assert.equal(isSemverCore('1.12.0'), true)
  for (const version of ['01.2.3', '1.2', '1.2.3-beta', 'v1.2.3']) assert.equal(isSemverCore(version), false, version)
  assert.equal(isUuidV4('3f2a8c1e-9b4d-4c1a-8e2f-0a1b2c3d4e5f'), true)
  assert.equal(isUuidV4('3f2a8c1e-9b4d-1c1a-8e2f-0a1b2c3d4e5f'), false)
  assert.equal(isRecord({}), true)
  for (const value of [null, [], 'x', 1]) assert.equal(isRecord(value), false)
})

test('each identifier format has exactly one source: no copied regex literal or isRecord helper remains', () => {
  const literals = [
    `[a-z0-9-]{3,48}$/`,
    '[a-z][a-z0-9-]{0,31}$/',
    '[A-Za-z0-9_-]{8,80}$/',
    '[a-f0-9]{16}$/',
    '[a-f0-9]{32}$/',
    '[89ab][a-f0-9]{3}',
    String.raw`(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/`,
  ]
  const offenders: string[] = []
  for (const file of [...sourceFiles('electron'), ...sourceFiles('src')]) {
    if (file === path.join('src', 'types', 'id-patterns.ts')) continue
    const source = readFileSync(file, 'utf8')
    for (const literal of literals) if (source.includes(literal)) offenders.push(`${file}: ${literal}`)
    // plugin-panel-themes.ts 由目錄驗證器原封不動地內嵌，必須保留自己的副本。
    if (/function isRecord\(/.test(source) && file !== path.join('electron', 'value-guards.ts') && file !== path.join('electron', 'plugin-panel-themes.ts')) {
      offenders.push(`${file}: isRecord`)
    }
  }
  assert.deepEqual(offenders, [])
})

test('the worker host and the test packer use the same plugin id rule', () => {
  assert.equal(PLUGIN_ID_PATTERN.source, `^${PLUGIN_ID_SOURCE}$`)
  for (const asset of ['host.js', 'worker-bootstrap.js']) {
    const source = pluginHostAssets[asset]!
    assert.ok(source.includes(`${PLUGIN_ID_PATTERN}.test(`), asset)
    assert.ok(source.includes(`${PLUGIN_COMMAND_ID_PATTERN}.test(data.commandId)`), asset)
  }
  // scripts/pack-test-plugin.mjs 直接以 node 執行（無型別剝除），所以保留字面值，但必須與來源相同。
  const packer = readFileSync('scripts/pack-test-plugin.mjs', 'utf8')
  assert.ok(packer.includes(`${PLUGIN_ID_PATTERN}.test(pluginId)`))
})
