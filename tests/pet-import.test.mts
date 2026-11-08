import assert from 'node:assert/strict'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { zipSync, type Zippable } from 'fflate'
import { parsePetBehaviorManifest } from '../electron/pet-behavior-manifest.ts'
import { sanitizePetId } from '../electron/pet-id.ts'
import {
  PET_IMPORT_STAGING_DIRNAME,
  PetImportStaging,
  parsePetZip,
  parseUntrustedJson,
  type ParsedPetKit,
  type ParsePetZipOptions,
} from '../electron/pet-import.ts'

const text = (value: string) => new TextEncoder().encode(value)

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(64)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  return bytes
}

const V1 = png(1536, 208 * 9)
const V2 = png(1536, 208 * 11)

const OPTIONS: ParsePetZipOptions = {
  limits: { maxZipBytes: 10 * 1024 * 1024, maxEntries: 64, maxUncompressedBytes: 25 * 1024 * 1024, maxJsonBytes: 256 * 1024, maxImageBytes: 20 * 1024 * 1024 },
  sanitizePetId,
  parsePetBehaviorManifest,
  isSupportedRasterImage: data => data[0] === 0x89 && data[1] === 0x50,
  now: () => 1,
}

function kit(petJson: unknown, files: Zippable = { 'spritesheet.webp': V2 }): Uint8Array {
  return zipSync({ 'pet.json': text(typeof petJson === 'string' ? petJson : JSON.stringify(petJson)), ...files })
}

function parsed(petJson: unknown, files?: Zippable): ParsedPetKit {
  const result = parsePetZip(kit(petJson, files), OPTIONS)
  assert.equal(result.ok, true, JSON.stringify(result))
  return (result as { ok: true; pet: ParsedPetKit }).pet
}

test('detects v1 and v2 atlases from the image and maps the v2 walk row', () => {
  const v2 = parsed({ id: 'fox', displayName: 'Fox', spriteVersionNumber: 2 })
  assert.equal(v2.atlas.version, 2)
  assert.equal(v2.atlas.rows, 11)
  assert.equal(v2.atlas.columns, 8)
  assert.deepEqual(v2.behaviorManifest, { walk: { row: 1 } })
  assert.deepEqual(v2.autoBehaviors, ['walk'])
  assert.deepEqual(v2.warnings, [])

  const v1 = parsed({ id: 'duck' }, { 'spritesheet.webp': V1 })
  assert.equal(v1.atlas.version, 1)
  assert.equal(v1.behaviorManifest, undefined)
  assert.deepEqual(v1.autoBehaviors, [])

  const mismatch = parsed({ id: 'duck', spriteVersionNumber: 2 }, { 'spritesheet.webp': V1 })
  assert.equal(mismatch.atlas.version, 1)
  assert.deepEqual(mismatch.warnings, ['declared-version-mismatch'])
})

test('keeps a declared manifest, drops rows beyond the sheet, and reports extra files', () => {
  const declared = parsed({ id: 'cat', behaviorManifest: { walk: { row: 2 }, sleep: { row: 5 } } })
  assert.deepEqual(declared.behaviorManifest, { walk: { row: 2 }, sleep: { row: 5 } })
  assert.deepEqual(declared.autoBehaviors, [])

  const outOfRange = parsed({ id: 'cat', behaviorManifest: { sleep: { row: 10 } } }, { 'spritesheet.webp': V1, 'README.txt': text('hi') })
  assert.equal(outOfRange.behaviorManifest, undefined)
  assert.deepEqual(outOfRange.warnings, ['behavior-row-out-of-range', 'ignored-entries'])
})

test('drops prototype-pollution keys and rejects non-object or non-UTF-8 pet.json', () => {
  const value = parseUntrustedJson(text('{"__proto__":{"polluted":true},"a":{"constructor":{"prototype":{"x":1}},"b":1}}')) as Record<string, unknown>
  assert.equal(Object.prototype.hasOwnProperty.call(value, '__proto__'), false)
  assert.deepEqual(value.a, { b: 1 })
  assert.equal(({} as Record<string, unknown>).polluted, undefined)

  const pet = parsed('{"id":"safe","__proto__":{"displayName":"Injected"},"behaviorManifest":{"__proto__":{"walk":{"row":3}}}}')
  assert.equal(pet.displayName, 'safe')
  assert.deepEqual(pet.behaviorManifest, { walk: { row: 1 } })

  assert.deepEqual(parsePetZip(kit('[1,2]'), OPTIONS), { ok: false, code: 'E_JSON', error: 'pet.json must contain a JSON object' })
  assert.deepEqual(parsePetZip(kit('null'), OPTIONS), { ok: false, code: 'E_JSON', error: 'pet.json must contain a JSON object' })
  const latin1 = zipSync({ 'pet.json': new Uint8Array([0x7b, 0x22, 0x69, 0x64, 0x22, 0x3a, 0x22, 0xe9, 0x22, 0x7d]), 'a.png': V2 })
  assert.deepEqual(parsePetZip(latin1, OPTIONS), { ok: false, code: 'E_JSON', error: 'pet.json is not valid UTF-8 JSON' })
})

test('rejects ambiguous, oversized or hostile kits before writing anything', () => {
  assert.equal(parsePetZip(zipSync({ 'a/pet.json': text('{}'), 'b/pet.json': text('{}'), 'a.png': V2 }), OPTIONS).ok, false)
  assert.deepEqual(parsePetZip(zipSync({ 'a.png': V2 }), OPTIONS), { ok: false, error: 'No pet.json found in this zip' })
  assert.deepEqual(parsePetZip(kit({ id: 'x' }, {}), OPTIONS), { ok: false, error: 'No spritesheet image found in this zip' })
  const bigJson = parsePetZip(zipSync({ 'pet.json': text(`{"pad":"${'a'.repeat(300 * 1024)}"}`), 'a.png': V2 }), OPTIONS)
  assert.deepEqual(bigJson, { ok: false, error: 'pet.json exceeds the 256 KB safety limit' })
  // A header advertising a huge canvas is refused from the header alone (pixel cap before decode).
  assert.equal(parsePetZip(kit({ id: 'x' }, { 'a.png': png(192 * 32, 208 * 64) }), OPTIONS).ok, false)
  assert.equal(parsePetZip(zipSync({ '../pet.json': text('{}'), 'a.png': V2 }), OPTIONS).ok, false)
  // macOS resource forks are ignored rather than picked as the spritesheet.
  const mac = parsed({ id: 'mac' }, { '__MACOSX/._a.png': text('junk'), 'a.png': V2 })
  assert.equal(mac.atlas.version, 2)
})

test('prefers the declared spritesheet next to pet.json', () => {
  const pet = parsePetZip(zipSync({
    'kit/pet.json': text(JSON.stringify({ id: 'k', spritesheetPath: 'sheet.png' })),
    'kit/other.png': V1,
    'kit/sheet.png': V2,
  }), OPTIONS)
  assert.equal(pet.ok && pet.pet.atlas.version, 2)
})

function tempRoot(t: { after(fn: () => void): void }): string {
  const root = mkdtempSync(join(tmpdir(), 'agent-pets-import-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

function staging(root: string, builtIn: string[] = []): PetImportStaging {
  return new PetImportStaging({ root, sanitizePetId: OPTIONS.sanitizePetId, builtinPetIds: async () => builtIn, ttlMs: 60_000 })
}

function installedPet(root: string, id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, 'custom', id, 'pet.json'), 'utf8'))
}

function stagingEntries(root: string): string[] {
  const directory = join(root, PET_IMPORT_STAGING_DIRNAME)
  return existsSync(directory) ? readdirSync(directory) : []
}

test('stages privately, previews, and installs atomically with the detected version', async t => {
  const root = tempRoot(t)
  const importer = staging(root)
  const preview = await importer.stage(parsed({ id: 'fox', displayName: 'Fox' }))
  assert.match(preview.token, /^[0-9a-f]{32}$/)
  assert.equal(preview.previewUrl, `agent-pets://import-preview/${preview.token}/spritesheet`)
  assert.equal(preview.conflict, null)
  assert.equal(existsSync(join(root, 'custom', 'fox')), false, 'nothing is installed before commit')
  const stagedDir = importer.previewDirectory(preview.token)!
  assert.ok(stagedDir.startsWith(join(root, PET_IMPORT_STAGING_DIRNAME)))
  assert.equal(importer.previewDirectory('not-a-token'), null)

  assert.equal((await importer.commit(preview.token, 'replace', preview.expectedState)).ok, false, 'replace needs a conflict')
  assert.deepEqual(await importer.commit(preview.token, 'install', 'forged'), {
    ok: false, code: 'E_IMPORT_STATE_CHANGED', error: 'The pet list changed. Review the import again.', preview,
  })
  const result = await importer.commit(preview.token, 'install', preview.expectedState)
  assert.deepEqual(result, { ok: true, id: 'fox', displayName: 'Fox' })
  assert.deepEqual(installedPet(root, 'fox'), {
    id: 'fox', displayName: 'Fox', description: 'Imported pet', spritesheetPath: 'spritesheet.webp',
    spriteVersionNumber: 2, kind: 'person', behaviorManifest: { walk: { row: 1 } },
  })
  assert.equal(readFileSync(join(root, 'custom', 'fox', 'spritesheet.webp')).length, V2.length)
  assert.deepEqual(stagingEntries(root), [])
  assert.equal(importer.previewDirectory(preview.token), null)
  assert.equal((await importer.commit(preview.token, 'install', preview.expectedState)).ok, false, 'a token is single-use')
})

test('a duplicate id is never overwritten silently: replace or keep both', async t => {
  const root = tempRoot(t)
  const importer = staging(root)
  const first = await importer.stage(parsed({ id: 'fox', displayName: 'Fox' }, { 'a.png': V1 }))
  assert.equal((await importer.commit(first.token, 'install', first.expectedState)).ok, true)

  const second = await importer.stage(parsed({ id: 'FOX', displayName: 'Fox' }))
  assert.deepEqual(second.conflict, { id: 'fox', builtIn: false, suggestedId: 'FOX-2', suggestedDisplayName: 'Fox (2)' })
  assert.equal((await importer.commit(second.token, 'install', second.expectedState)).ok, false, 'install is refused on conflict')
  const kept = await importer.commit(second.token, 'keep-both', second.expectedState)
  assert.deepEqual(kept, { ok: true, id: 'FOX-2', displayName: 'Fox (2)' })
  assert.equal(installedPet(root, 'fox').spriteVersionNumber, 1)
  assert.equal(installedPet(root, 'FOX-2').id, 'FOX-2')

  const third = await importer.stage(parsed({ id: 'fox', displayName: 'Fox v2' }))
  assert.equal(third.conflict?.suggestedId, 'fox-3')
  const replaced = await importer.commit(third.token, 'replace', third.expectedState)
  assert.deepEqual(replaced, { ok: true, id: 'fox', displayName: 'Fox v2' })
  assert.equal(installedPet(root, 'fox').spriteVersionNumber, 2)
  assert.deepEqual(stagingEntries(root), [], 'the backup is removed after a successful replace')
})

test('built-in ids can only be kept beside', async t => {
  const root = tempRoot(t)
  const importer = staging(root, ['aang-airbender'])
  const preview = await importer.stage(parsed({ id: 'aang-airbender', displayName: 'Aang' }))
  assert.equal(preview.conflict?.builtIn, true)
  assert.equal((await importer.commit(preview.token, 'replace', preview.expectedState)).ok, false)
  assert.equal((await importer.commit(preview.token, 'keep-both', preview.expectedState)).ok, true)
  assert.ok(existsSync(join(root, 'custom', 'aang-airbender-2')))
})

test('a destination that changes after the preview is re-checked (TOCTOU) and re-prompted', async t => {
  const root = tempRoot(t)
  const importer = staging(root)
  const preview = await importer.stage(parsed({ id: 'owl' }))
  mkdirSync(join(root, 'custom', 'owl'), { recursive: true })
  writeFileSync(join(root, 'custom', 'owl', 'pet.json'), '{"id":"owl","displayName":"Mine"}')
  const result = await importer.commit(preview.token, 'install', preview.expectedState)
  assert.equal(result.ok, false)
  assert.equal(!result.ok && result.code, 'E_IMPORT_STATE_CHANGED')
  const refreshed = !result.ok ? result.preview : undefined
  assert.equal(refreshed?.conflict?.id, 'owl')
  assert.equal(installedPet(root, 'owl').displayName, 'Mine', 'the user-owned pet is untouched')

  // The existing pet changes again between the second preview and the replace.
  writeFileSync(join(root, 'custom', 'owl', 'spritesheet.webp'), 'changed')
  const second = await importer.commit(preview.token, 'replace', refreshed!.expectedState)
  assert.equal(!second.ok && second.code, 'E_IMPORT_STATE_CHANGED')
  assert.equal(installedPet(root, 'owl').displayName, 'Mine')
  const final = await importer.commit(preview.token, 'replace', (!second.ok && second.preview?.expectedState) || '')
  assert.equal(final.ok, true)
  assert.equal(installedPet(root, 'owl').displayName, 'owl')
})

test('a failed replace restores the previous pet and leaves no partial folders', async t => {
  const root = tempRoot(t)
  let calls = 0
  const importer = new PetImportStaging({
    root,
    sanitizePetId: OPTIONS.sanitizePetId,
    builtinPetIds: async () => [],
    renameDirectory: async (from, to) => {
      calls += 1
      // Second rename is staging -> custom/<id>: fail it after the old pet was moved to the backup.
      if (calls === 2) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
      renameSync(from, to)
    },
  })
  const first = await importer.stage(parsed({ id: 'bee', displayName: 'Old' }))
  await importer.commit(first.token, 'install', first.expectedState)
  const second = await importer.stage(parsed({ id: 'bee', displayName: 'New' }))
  const result = await importer.commit(second.token, 'replace', second.expectedState)
  assert.deepEqual(result, { ok: false, code: 'E_IMPORT_FAILED', error: 'Could not install the imported pet' })
  assert.equal(calls, 2)
  assert.equal(installedPet(root, 'bee').displayName, 'Old')
  assert.deepEqual(stagingEntries(root), [])
  assert.deepEqual(readdirSync(join(root, 'custom')), ['bee'])
})

test('if rolling back a failed replace also fails, the backup survives and is restored later', async t => {
  const root = tempRoot(t)
  let calls = 0
  const options = { root, sanitizePetId, builtinPetIds: async () => [] as string[] }
  const importer = new PetImportStaging({
    ...options,
    renameDirectory: async (from, to) => {
      calls += 1
      if (calls === 2) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
      renameSync(from, to)
    },
    restoreDirectory: async () => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }) },
  })
  const first = await importer.stage(parsed({ id: 'moth', displayName: 'Old' }))
  await importer.commit(first.token, 'install', first.expectedState)
  const second = await importer.stage(parsed({ id: 'moth', displayName: 'New' }))
  const result = await importer.commit(second.token, 'replace', second.expectedState)
  // No re-preview: the folder looks free, but offering "Install" would bury the only copy.
  assert.deepEqual(result, { ok: false, code: 'E_IMPORT_FAILED', error: 'Could not install the imported pet' })
  assert.equal(existsSync(join(root, 'custom', 'moth')), false)
  assert.equal(stagingEntries(root).filter(name => name.startsWith('backup-')).length, 1)

  // Another import takes the id before the next start: the unverified backup is kept, not deleted.
  const third = await importer.stage(parsed({ id: 'moth', displayName: 'Third' }))
  assert.equal((await importer.commit(third.token, 'install', third.expectedState)).ok, true)
  assert.deepEqual(await new PetImportStaging(options).recoverStale(), { removed: 0, restored: 0, kept: 1 })
  rmSync(join(root, 'custom', 'moth'), { recursive: true })
  assert.deepEqual(await new PetImportStaging(options).recoverStale(), { removed: 0, restored: 1, kept: 0 })
  assert.equal(installedPet(root, 'moth').displayName, 'Old')
})

test('pet ids that are not portable folder names are rejected', () => {
  for (const value of ['.', 'pet.', 'CON', 'nul', 'com1', 'LPT9', 'aux.json', 'Con.backup', '..', 'a..b']) {
    assert.equal(sanitizePetId(value), null, value)
  }
  assert.equal(sanitizePetId('console'), 'console')
  assert.equal(sanitizePetId('.hidden-ok'), '.hidden-ok')
  assert.equal(sanitizePetId('fox v2!'), 'foxv2')
})

test('a staged directory that vanished fails cleanly', async t => {
  const root = tempRoot(t)
  const importer = staging(root)
  const preview = await importer.stage(parsed({ id: 'gnat' }))
  rmSync(importer.previewDirectory(preview.token)!, { recursive: true, force: true })
  assert.equal((await importer.commit(preview.token, 'install', preview.expectedState)).ok, false)
  assert.equal(existsSync(join(root, 'custom', 'gnat')), false)
})

test('cancel and a new import discard staged files', async t => {
  const root = tempRoot(t)
  const importer = staging(root)
  const first = await importer.stage(parsed({ id: 'a' }))
  const second = await importer.stage(parsed({ id: 'b' }))
  assert.equal(importer.previewDirectory(first.token), null, 'only one pending import is kept')
  assert.equal(stagingEntries(root).length, 1)
  assert.equal(await importer.cancel(second.token), true)
  assert.deepEqual(stagingEntries(root), [])
  assert.equal(await importer.cancel(second.token), false)
})

test('startup recovery restores interrupted replaces and removes only our own stale entries', async t => {
  const root = tempRoot(t)
  const stagingRoot = join(root, PET_IMPORT_STAGING_DIRNAME)
  const hex = 'a'.repeat(32)
  mkdirSync(join(stagingRoot, `stage-${hex}`), { recursive: true })
  writeFileSync(join(stagingRoot, `stage-${hex}`, 'spritesheet.webp'), 'partial')
  mkdirSync(join(stagingRoot, `backup-${'b'.repeat(32)}-lost`), { recursive: true })
  writeFileSync(join(stagingRoot, `backup-${'b'.repeat(32)}-lost`, 'pet.json'), '{"id":"lost"}')
  mkdirSync(join(root, 'custom', 'present'), { recursive: true })
  mkdirSync(join(stagingRoot, `backup-${'c'.repeat(32)}-present`), { recursive: true })
  mkdirSync(join(stagingRoot, 'unrelated'), { recursive: true })
  const outside = join(root, 'outside')
  mkdirSync(outside)
  writeFileSync(join(outside, 'keep.txt'), 'keep')
  symlinkSync(outside, join(stagingRoot, `stage-${'d'.repeat(32)}`))

  mkdirSync(join(stagingRoot, `backup-${'e'.repeat(32)}-done`), { recursive: true })
  writeFileSync(join(stagingRoot, `backup-${'e'.repeat(32)}-done`, '.replaced'), '')

  const result = await staging(root).recoverStale()
  assert.deepEqual(result, { removed: 2, restored: 1, kept: 1 })
  assert.equal(installedPet(root, 'lost').id, 'lost')
  // An unmarked backup whose folder is occupied is the only copy of that pet: kept, never deleted.
  assert.deepEqual(stagingEntries(root).sort(), [`backup-${'c'.repeat(32)}-present`, `stage-${'d'.repeat(32)}`, 'unrelated'])
  assert.equal(readFileSync(join(outside, 'keep.txt'), 'utf8'), 'keep', 'symlinks are never followed')
  assert.equal(lstatSync(join(stagingRoot, `stage-${'d'.repeat(32)}`)).isSymbolicLink(), true)
})

test('a symlinked staging root is refused', async t => {
  const root = tempRoot(t)
  const elsewhere = join(root, 'elsewhere')
  mkdirSync(elsewhere)
  symlinkSync(elsewhere, join(root, PET_IMPORT_STAGING_DIRNAME))
  await assert.rejects(staging(root).stage(parsed({ id: 'x' })))
  assert.deepEqual(readdirSync(elsewhere), [])
  assert.deepEqual(await staging(root).recoverStale(), { removed: 0, restored: 0, kept: 0 })
})
