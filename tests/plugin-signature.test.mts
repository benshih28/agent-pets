import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign as cryptoSign } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { strToU8, unzipSync, zipSync } from 'fflate'
import {
  createPluginSignaturePayload,
  formatPluginKeyFingerprint,
  parsePluginSignatureFile,
  pluginPublicKeyFingerprint,
  verifyPluginSignature,
} from '../electron/plugin-signature.ts'
import { PluginRegistry } from '../electron/plugin-registry.ts'

function createTestKeyPair() {
  const pair = generateKeyPairSync('ed25519')
  const publicKey = new Uint8Array(pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32))
  return { privateKey: pair.privateKey, publicKey }
}

function signatureBytes(files: Map<string, Uint8Array>, pair: ReturnType<typeof createTestKeyPair>): Uint8Array {
  const payload = createPluginSignaturePayload(files)
  assert.ok(payload)
  const signature = cryptoSign(null, payload, pair.privateKey)
  return Buffer.from(JSON.stringify({
    alg: 'ed25519',
    publicKey: Buffer.from(pair.publicKey).toString('base64'),
    signature: signature.toString('base64'),
  }), 'utf8')
}

function signedFiles(pair: ReturnType<typeof createTestKeyPair>): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>([
    ['plugin.json', Buffer.from('{"id":"sample-plugin"}')],
    ['dist/main.js', Buffer.from('export default { activate() {} }')],
    ['assets/icon.png', new Uint8Array([0x89, 0x50])],
  ])
  files.set('signature.json', signatureBytes(files, pair))
  return files
}

function makeArchive(version: string, pair?: ReturnType<typeof createTestKeyPair>): Uint8Array {
  const files = new Map<string, Uint8Array>([
    ['plugin.json', strToU8(JSON.stringify({
      id: 'sample-plugin',
      name: { 'zh-TW': '測試插件', 'en-US': 'Sample Plugin' },
      version,
      apiVersion: '1',
      author: 'Test Author',
      entry: 'dist/main.js',
      permissions: {},
      contributes: {},
    }))],
    ['dist/main.js', strToU8('export default { activate() {} }')],
  ])
  if (pair) files.set('signature.json', signatureBytes(files, pair))
  return zipSync(Object.fromEntries(files), { level: 6 })
}

function withUserData(run: (directory: string) => void): void {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-plugin-signature-'))
  try { run(directory) } finally { fs.rmSync(directory, { recursive: true, force: true }) }
}

async function withUserDataAsync(run: (directory: string) => Promise<void> | void): Promise<void> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-plugin-signature-'))
  try { await run(directory) } finally { fs.rmSync(directory, { recursive: true, force: true }) }
}

function successfulPlan(registry: PluginRegistry, archive: Uint8Array) {
  const result = registry.planInstall(archive)
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error(result.error)
  return result.value
}

function install(registry: PluginRegistry, token: string, acceptSignatureChange = false) {
  return registry.install(token, false, acceptSignatureChange)
}

test('signature payload sorts exact package paths, hashes bytes, and excludes only root signature.json', () => {
  const files = new Map<string, Uint8Array>([
    ['z.js', Buffer.from('z')],
    ['signature.json', Buffer.from('ignored')],
    ['folder/a.js', Buffer.from('a')],
    ['plugin.json', Buffer.from('{}')],
  ])
  const payload = createPluginSignaturePayload(files)
  const expected = [
    ['folder/a.js', Buffer.from('a')],
    ['plugin.json', Buffer.from('{}')],
    ['z.js', Buffer.from('z')],
  ].map(([file, bytes]) => `${file}\t${createHash('sha256').update(bytes as Uint8Array).digest('hex')}\n`).join('')
  assert.equal(payload?.toString(), expected)
})

test('valid Ed25519 signatures verify and expose the raw-key fingerprint', () => {
  const pair = createTestKeyPair()
  const files = signedFiles(pair)
  const verified = verifyPluginSignature(files)
  assert.equal(verified.status, 'valid')
  if (verified.status !== 'valid') return
  const expectedFingerprint = createHash('sha256').update(pair.publicKey).digest('hex').slice(0, 16)
  assert.equal(verified.fingerprint, expectedFingerprint)
  assert.equal(pluginPublicKeyFingerprint(pair.publicKey), expectedFingerprint)
  assert.equal(formatPluginKeyFingerprint(expectedFingerprint), expectedFingerprint.match(/.{4}/g)?.join(' '))
})

test('changing any signed file, including plugin.json, invalidates the signature', () => {
  const pair = createTestKeyPair()
  const original = signedFiles(pair)
  const changedAsset = new Map(original)
  changedAsset.set('dist/main.js', Buffer.from('changed'))
  const changedManifest = new Map(original)
  changedManifest.set('plugin.json', Buffer.from('{"id":"other-plugin"}'))
  assert.equal(verifyPluginSignature(changedAsset).status, 'invalid')
  assert.equal(verifyPluginSignature(changedManifest).status, 'invalid')
})

test('distribution fixtures cover a valid signature, a post-signature tamper, and a rotated signing key', () => {
  const fixtureRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'plugins')
  const readFiles = (fixtureId: string) => {
    const root = path.join(fixtureRoot, fixtureId)
    const files = new Map<string, Uint8Array>()
    const walk = (directory: string, prefix = '') => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const relativePath = path.posix.join(prefix, entry.name)
        const fullPath = path.join(directory, entry.name)
        if (entry.isDirectory()) walk(fullPath, relativePath)
        else if (entry.isFile()) files.set(relativePath, new Uint8Array(fs.readFileSync(fullPath)))
      }
    }
    walk(root)
    return files
  }
  const firstKey = createTestKeyPair()
  const rotatedKey = createTestKeyPair()
  const signed = readFiles('ok-signed')
  assert.match(Buffer.from(signed.get('dist/main.js')!).toString('utf8'), /export default\s*\{\s*activate\s*\(/)
  signed.set('signature.json', signatureBytes(signed, firstKey))
  assert.equal(verifyPluginSignature(signed).status, 'valid')

  const tampered = readFiles('evil-signed-tampered')
  tampered.set('signature.json', signatureBytes(tampered, firstKey))
  tampered.set('dist/main.js', Buffer.from('api.log.info("altered after signing")'))
  assert.equal(verifyPluginSignature(tampered).status, 'invalid')

  const rotated = readFiles('ok-signed-rotated')
  assert.match(Buffer.from(rotated.get('dist/main.js')!).toString('utf8'), /export default\s*\{\s*activate\s*\(/)
  rotated.set('signature.json', signatureBytes(rotated, rotatedKey))
  assert.equal(verifyPluginSignature(rotated).status, 'valid')
  assert.notEqual(pluginPublicKeyFingerprint(firstKey.publicKey), pluginPublicKeyFingerprint(rotatedKey.publicKey))
})

test('signature parser rejects bad lengths, non-canonical base64, unknown algorithms, and extra fields', () => {
  const pair = createTestKeyPair()
  const valid = {
    alg: 'ed25519',
    publicKey: Buffer.from(pair.publicKey).toString('base64'),
    signature: Buffer.alloc(64).toString('base64'),
  }
  assert.ok(parsePluginSignatureFile(valid))
  assert.equal(parsePluginSignatureFile({ ...valid, extra: true }), null)
  assert.equal(parsePluginSignatureFile({ ...valid, alg: 'rsa' }), null)
  assert.equal(parsePluginSignatureFile({ ...valid, publicKey: Buffer.alloc(31).toString('base64') }), null)
  assert.equal(parsePluginSignatureFile({ ...valid, signature: Buffer.alloc(63).toString('base64') }), null)
  assert.equal(parsePluginSignatureFile({ ...valid, publicKey: 'not-base64!' }), null)
  assert.equal(parsePluginSignatureFile({ ...valid, signature: `${valid.signature}\n` }), null)
  assert.equal(verifyPluginSignature(new Map([['signature.json', Buffer.alloc(4 * 1024 + 1)]] as const)).status, 'invalid')
  assert.equal(verifyPluginSignature(new Map()).status, 'unsigned')
  assert.equal(formatPluginKeyFingerprint('z'.repeat(16)), null)
})

test('registry records first trust, keeps same-key updates, and gates key rotation', () => {
  withUserData((userData) => {
    const registry = new PluginRegistry(userData)
    const firstPair = createTestKeyPair()
    const first = successfulPlan(registry, makeArchive('1.0.0', firstPair))
    assert.equal(first.signatureStatus, 'valid')
    assert.equal(first.signatureChange, 'first-trust')
    assert.equal(first.requiresSignatureConfirmation, false)
    assert.equal(install(registry, first.token).ok, true)
    const trusted = registry.list()[0]?.trustedKeyFingerprint
    assert.equal(trusted, createHash('sha256').update(firstPair.publicKey).digest('hex').slice(0, 16))
    assert.equal(new PluginRegistry(userData).list()[0]?.trustedKeyFingerprint, trusted)

    const sameKey = successfulPlan(registry, makeArchive('1.1.0', firstPair))
    assert.equal(sameKey.signatureChange, 'unchanged')
    assert.equal(sameKey.requiresSignatureConfirmation, false)
    assert.equal(install(registry, sameKey.token).ok, true)
    assert.equal(registry.list()[0]?.trustedKeyFingerprint, trusted)

    const rotatedPair = createTestKeyPair()
    const rotated = successfulPlan(registry, makeArchive('1.2.0', rotatedPair))
    assert.equal(rotated.signatureChange, 'key-changed')
    assert.equal(rotated.requiresSignatureConfirmation, true)
    assert.equal(rotated.previousTrustedFingerprint, trusted)
    assert.deepEqual(install(registry, rotated.token), { ok: false, error: 'signature_confirmation_required' })
    assert.equal(install(registry, rotated.token, true).ok, true)
    assert.equal(registry.list()[0]?.trustedKeyFingerprint,
      createHash('sha256').update(rotatedPair.publicKey).digest('hex').slice(0, 16))
  })
})

test('missing persisted fingerprint on a previously signed plugin fails closed as a key change', () => {
  withUserData((userData) => {
    const registry = new PluginRegistry(userData)
    const originalPair = createTestKeyPair()
    const initial = successfulPlan(registry, makeArchive('1.0.0', originalPair))
    assert.equal(install(registry, initial.token).ok, true)
    const registryPath = path.join(userData, 'plugins', 'registry.json')
    const raw = JSON.parse(fs.readFileSync(registryPath, 'utf8')) as { plugins: Record<string, Record<string, unknown>> }
    raw.plugins['sample-plugin']!.signatureFingerprint = 'invalid'
    raw.plugins['sample-plugin']!.trustedKeyFingerprint = 'invalid'
    fs.writeFileSync(registryPath, JSON.stringify(raw))

    const rotated = successfulPlan(new PluginRegistry(userData), makeArchive('1.1.0', createTestKeyPair()))
    assert.equal(rotated.signatureChange, 'key-changed')
    assert.equal(rotated.requiresSignatureConfirmation, true)
    assert.equal(rotated.previousTrustedFingerprint, undefined)
  })
})

test('signed-to-unsigned updates require confirmation and preserve the previous trusted key', () => {
  withUserData((userData) => {
    const registry = new PluginRegistry(userData)
    const pair = createTestKeyPair()
    const signed = successfulPlan(registry, makeArchive('1.0.0', pair))
    assert.equal(install(registry, signed.token).ok, true)
    const unsigned = successfulPlan(registry, makeArchive('1.1.0'))
    assert.equal(unsigned.signatureChange, 'signed-to-unsigned')
    assert.equal(unsigned.requiresSignatureConfirmation, true)
    assert.deepEqual(install(registry, unsigned.token), { ok: false, error: 'signature_confirmation_required' })
    assert.equal(install(registry, unsigned.token, true).ok, true)
    assert.equal(registry.list()[0]?.signatureStatus, 'unsigned')
    assert.equal(registry.list()[0]?.trustedKeyFingerprint,
      createHash('sha256').update(pair.publicKey).digest('hex').slice(0, 16))
  })
})

test('unsigned-to-signed updates notify once and record the new trust key', () => {
  withUserData((userData) => {
    const registry = new PluginRegistry(userData)
    const unsigned = successfulPlan(registry, makeArchive('1.0.0'))
    assert.equal(install(registry, unsigned.token).ok, true)
    const pair = createTestKeyPair()
    const signed = successfulPlan(registry, makeArchive('1.1.0', pair))
    assert.equal(signed.signatureChange, 'unsigned-to-signed')
    assert.equal(signed.requiresSignatureConfirmation, false)
    assert.equal(install(registry, signed.token).ok, true)
    assert.equal(registry.list()[0]?.trustedKeyFingerprint,
      createHash('sha256').update(pair.publicKey).digest('hex').slice(0, 16))
  })
})

test('developer folder plans skip signatures and mark the installed package unverified', async () => {
  await withUserDataAsync(async (userData) => {
    const source = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-plugin-dev-signature-'))
    try {
      fs.mkdirSync(path.join(source, 'dist'), { recursive: true })
      fs.writeFileSync(path.join(source, 'plugin.json'), JSON.stringify({
        id: 'sample-plugin', name: { 'zh-TW': '測試插件', 'en-US': 'Sample Plugin' }, version: '1.0.0',
        apiVersion: '1', author: 'Test Author', entry: 'dist/main.js', permissions: {}, contributes: {},
      }))
      fs.writeFileSync(path.join(source, 'dist', 'main.js'), 'export default { activate() {} }')
      fs.writeFileSync(path.join(source, 'signature.json'), '{invalid signature}')
      const registry = new PluginRegistry(userData)
      const planned = await registry.planInstallDirectory(source)
      assert.equal(planned.ok, true)
      if (!planned.ok) return
      assert.equal(planned.value.developerMode, true)
      assert.equal(planned.value.signatureStatus, 'unsigned')
      assert.equal(install(registry, planned.value.token).ok, true)
      assert.equal(registry.list()[0]?.signatureStatus, 'unverified')
    } finally {
      fs.rmSync(source, { recursive: true, force: true })
    }
  })
})

test('registry rejects an archive with an invalid signature before creating an install plan', () => {
  withUserData((userData) => {
    const registry = new PluginRegistry(userData)
    const pair = createTestKeyPair()
    const entries = unzipSync(makeArchive('1.0.0', pair))
    entries['signature.json'] = strToU8(JSON.stringify({
      alg: 'ed25519',
      publicKey: Buffer.from(pair.publicKey).toString('base64'),
      signature: Buffer.alloc(64).toString('base64'),
    }))
    assert.deepEqual(registry.planInstall(zipSync(entries)), { ok: false, error: 'signature_invalid' })
  })
})

test('signature-risk confirmation defaults focus to Cancel and shows key fingerprints', () => {
  const dialog = fs.readFileSync(new URL('../src/components/ui/ConfirmDialog.vue', import.meta.url), 'utf8')
  const panel = fs.readFileSync(new URL('../src/components/PluginPanel.vue', import.meta.url), 'utf8')
  const dialogs = fs.readFileSync(new URL('../src/components/plugin-panel/PluginPanelDialogs.vue', import.meta.url), 'utf8')
  assert.match(dialog, /props\.focusCancel \? '\[data-cancel\]' : '\[data-confirm\]'/)
  assert.match(dialog, /data-cancel/)
  assert.match(dialogs, /:focus-cancel="plan\?\.requiresSignatureConfirmation === true"/)
  assert.match(dialogs, /pluginSignatureKeyChanged/)
  assert.match(panel, /plugin\.signatureStatus === 'valid'/)
  assert.match(panel, /plugin\.signatureFingerprint/)
  assert.match(dialogs, /displayFingerprint\(plan\.previousTrustedFingerprint\)/)
})
