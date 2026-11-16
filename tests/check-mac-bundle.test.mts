import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  CS_RUNTIME_FLAG,
  FUSE_SENTINEL,
  FUSE_V1_INDEX,
  compareDeveloperIdSignature,
  compareFuses,
  compareSpctlOutput,
  isMachOCandidate,
  parseArgs,
  parseCodesignDetails,
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

const DEVELOPER_ID_OUTPUT = [
  'Executable=/Volumes/Agent Pets/Agent Pets.app/Contents/MacOS/Agent Pets',
  'Identifier=com.agent-pets.app',
  'Format=app bundle with Mach-O thin (arm64)',
  'CodeDirectory v=20500 size=700 flags=0x10000(runtime) hashes=10+7 location=embedded',
  'Authority=Developer ID Application: Example Co (ABCDE12345)',
  'Authority=Developer ID Certification Authority',
  'Authority=Apple Root CA',
  'Timestamp=Jan 1, 2026 at 12:00:00',
  'TeamIdentifier=ABCDE12345',
].join('\n')

const ADHOC_OUTPUT = [
  'Identifier=com.agent-pets.app',
  'CodeDirectory v=20500 size=467 flags=0x10002(adhoc,runtime) hashes=4+7 location=embedded',
  'Signature=adhoc',
  'TeamIdentifier=not set',
].join('\n')

test('codesign -dvv output is parsed into authorities, team, signature and flags', () => {
  const developerId = parseCodesignDetails(DEVELOPER_ID_OUTPUT)
  assert.deepEqual(developerId.authorities, ['Developer ID Application: Example Co (ABCDE12345)', 'Developer ID Certification Authority', 'Apple Root CA'])
  assert.equal(developerId.teamIdentifier, 'ABCDE12345')
  assert.equal(developerId.flags, CS_RUNTIME_FLAG)
  assert.deepEqual(developerId.flagNames, ['runtime'])

  const adhoc = parseCodesignDetails(ADHOC_OUTPUT)
  assert.equal(adhoc.signature, 'adhoc')
  assert.equal(adhoc.flags, 0x10002)
  assert.deepEqual(adhoc.flagNames, ['adhoc', 'runtime'])

  assert.deepEqual(parseCodesignDetails(''), { authorities: [], teamIdentifier: null, signature: null, flags: null, flagNames: [] })
})

test('the Developer ID check accepts a hardened Developer ID bundle and rejects ad-hoc or non-hardened ones', () => {
  assert.deepEqual(compareDeveloperIdSignature(parseCodesignDetails(DEVELOPER_ID_OUTPUT)), [])

  const adhoc = compareDeveloperIdSignature(parseCodesignDetails(ADHOC_OUTPUT)).join('\n')
  assert.match(adhoc, /expected Developer ID Application/)
  assert.match(adhoc, /ad-hoc signed/)
  assert.match(adhoc, /TeamIdentifier is not set/)

  const noRuntime = DEVELOPER_ID_OUTPUT.replace('flags=0x10000(runtime)', 'flags=0x0(none)')
  assert.deepEqual(compareDeveloperIdSignature(parseCodesignDetails(noRuntime)), ['hardened runtime flag (runtime) is missing from codesign flags'])

  const development = DEVELOPER_ID_OUTPUT.replace('Developer ID Application: Example Co', 'Apple Development: someone')
  assert.match(compareDeveloperIdSignature(parseCodesignDetails(development)).join('\n'), /Apple Development/)
})

test('spctl output distinguishes notarized, Developer ID only and rejected apps', () => {
  const notarized = '/x/Agent Pets.app: accepted\nsource=Notarized Developer ID\norigin=Developer ID Application: Example Co (ABCDE12345)'
  const unnotarized = '/x/Agent Pets.app: accepted\nsource=Developer ID'
  assert.deepEqual(compareSpctlOutput(notarized, true), [])
  assert.deepEqual(compareSpctlOutput(notarized, false), [])
  assert.deepEqual(compareSpctlOutput(unnotarized, false), [])
  assert.match(compareSpctlOutput(unnotarized, true)[0], /expected Notarized Developer ID/)
  assert.match(compareSpctlOutput('/x/Agent Pets.app: rejected\nsource=no usable signature', false)[0], /did not accept/)
})

test('command line flags are validated', () => {
  assert.deepEqual(parseArgs(['--app', 'a', '--arch', 'x64']), { app: 'a', arch: 'x64', notarized: false })
  assert.deepEqual(
    parseArgs(['--app', 'a', '--arch', 'arm64', '--expect-signed', 'developer-id', '--expect-notarized']),
    { app: 'a', arch: 'arm64', signed: 'developer-id', notarized: true },
  )
  assert.throws(() => parseArgs(['--app', 'a', '--arch', 'x64', '--expect-notarized']), /requires --expect-signed/)
  assert.throws(() => parseArgs(['--app', 'a', '--arch', 'x64', '--expect-signed', 'adhoc']), /only supports developer-id/)
  assert.throws(() => parseArgs(['--app', 'a', '--arch', 'ppc']), /usage/)
  assert.throws(() => parseArgs(['--bogus']), /unknown argument/)
})
