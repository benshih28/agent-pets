import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  FUSE_SENTINEL,
  FUSE_V1_INDEX,
  compareFuses,
  isMachOCandidate,
  parseLipoArchs,
  readFuseWires,
} from '../scripts/check-mac-bundle.mjs'

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const configured: Record<string, boolean> = packageJson.build.electronFuses

/** 依設定組出一份 V1 線路；override 可以把某個 fuse 改成別的狀態 */
function wireBytes(config: Record<string, boolean>, override: Record<number, number> = {}): Buffer {
  const states = Array.from({ length: 9 }, () => 0x31)
  for (const [key, enabled] of Object.entries(config)) states[FUSE_V1_INDEX[key as keyof typeof FUSE_V1_INDEX]] = enabled ? 0x31 : 0x30
  for (const [index, value] of Object.entries(override)) states[Number(index)] = value
  return Buffer.concat([Buffer.from('padding'), Buffer.from(FUSE_SENTINEL, 'latin1'), Buffer.from([1, states.length, ...states]), Buffer.from('tail')])
}

test('every configured electronFuses key is a known V1 fuse', () => {
  for (const key of Object.keys(configured)) assert.ok(key in FUSE_V1_INDEX, key)
})

test('a wire written from build.electronFuses passes the fuse check', () => {
  const wires = readFuseWires(wireBytes(configured))
  assert.equal(wires.length, 1)
  assert.deepEqual(compareFuses(wires, configured), [])
})

test('a flipped fuse, a second universal slice and a missing sentinel are all reported', () => {
  const flipped = wireBytes(configured, { [FUSE_V1_INDEX.runAsNode]: 0x31 })
  assert.match(compareFuses(readFuseWires(flipped), configured).join('\n'), /runAsNode is 1, expected 0/)

  const universal = Buffer.concat([wireBytes(configured), flipped])
  const problems = compareFuses(readFuseWires(universal), configured)
  assert.deepEqual(problems, ['slice 1: runAsNode is 1, expected 0'])

  assert.deepEqual(compareFuses(readFuseWires(Buffer.from('no wire here')), configured), ['fuse sentinel not found'])
})

test('lipo output and Mach-O candidate paths are parsed as the release check expects', () => {
  assert.deepEqual(parseLipoArchs('x86_64 arm64\n'), ['x86_64', 'arm64'])
  assert.deepEqual(parseLipoArchs('\n'), [])

  const candidates = [
    'Contents/MacOS/Agent Pets',
    'Contents/Frameworks/Agent Pets Helper.app/Contents/MacOS/Agent Pets Helper',
    'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework',
    'Contents/Frameworks/Electron Framework.framework/Versions/A/Helpers/chrome_crashpad_handler',
    'Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libEGL.dylib',
    'Contents/Resources/app.asar.unpacked/node_modules/@koromix/koffi-darwin-arm64/darwin_arm64/koffi.node',
  ]
  for (const path of candidates) assert.ok(isMachOCandidate(path), path)

  for (const path of ['Contents/Info.plist', 'Contents/Resources/app.asar', 'Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/Info.plist']) {
    assert.equal(isMachOCandidate(path), false, path)
  }
})
