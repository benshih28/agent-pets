import assert from 'node:assert/strict'
import test from 'node:test'
import { strToU8, zipSync } from 'fflate'
import { guardArchive, type ArchiveGuardOptions } from '../electron/archive-guard.ts'

const DEFAULTS: ArchiveGuardOptions = {
  maxTotalBytes: 64,
  maxFileBytes: 32,
  maxFiles: 4,
  allowedExtensions: ['.js', '.json', '.png', '.webp', '.html', '.css'],
}

function makeZip(entries: Record<string, string | Uint8Array>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(entries).map(([path, data]) => [
    path,
    typeof data === 'string' ? strToU8(data) : data,
  ])))
}

test('archive guard returns safe files and ignores directory entries', () => {
  const result = guardArchive(makeZip({
    'plugin.json': '{"id":"sample"}',
    'dist/main.js': 'export default 1',
    'dist/': new Uint8Array(),
  }), DEFAULTS)
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.deepEqual([...result.files.keys()], ['plugin.json', 'dist/main.js'])
  }
})

test('archive guard rejects traversal, absolute, drive, and backslash paths', () => {
  for (const path of ['../evil.js', '/absolute.js', 'C:/drive.js', 'folder\\evil.js', 'safe/../evil.js']) {
    const result = guardArchive(makeZip({ [path]: 'x' }), DEFAULTS)
    assert.deepEqual(result, { ok: false, error: 'unsafe_path' }, path)
  }
})

test('archive guard enforces file count, per-file size, and total uncompressed size', () => {
  assert.deepEqual(
    guardArchive(makeZip({ 'a.js': '1', 'b.js': '2' }), { ...DEFAULTS, maxFiles: 1 }),
    { ok: false, error: 'file_limit_exceeded' },
  )
  assert.deepEqual(
    guardArchive(makeZip({ 'large.js': '12345' }), { ...DEFAULTS, maxFileBytes: 4 }),
    { ok: false, error: 'file_size_exceeded' },
  )
  assert.deepEqual(
    guardArchive(makeZip({ 'a.js': '1234', 'b.js': '5678' }), { ...DEFAULTS, maxTotalBytes: 7 }),
    { ok: false, error: 'total_size_exceeded' },
  )
})

test('archive guard rejects unsupported extensions in strict mode and skips them in compat mode', () => {
  assert.deepEqual(
    guardArchive(makeZip({ 'readme.txt': 'text' }), DEFAULTS),
    { ok: false, error: 'unsupported_extension' },
  )
  const skipped = guardArchive(makeZip({ 'main.js': 'code', 'readme.txt': 'text' }), {
    ...DEFAULTS,
    mode: 'compat',
  })
  assert.equal(skipped.ok, true)
  if (skipped.ok) assert.deepEqual([...skipped.files.keys()], ['main.js'])
})

test('compat mode skips unsafe, duplicate, and filtered pet archive files while counting limits', () => {
  const zip = makeZip({
    'pet.json': '{"id":"sample"}',
    'spritesheet.webp': 'image',
    'notes: v2.txt': 'note',
    'cat /x.png': 'unsafe path',
    '._spritesheet.webp': 'apple metadata',
    '__MACOSX/._a.webp': 'apple metadata',
    'DUPLICATE.png': 'first',
    'duplicate.PNG': 'second',
  })
  const result = guardArchive(zip, {
    maxTotalBytes: 256,
    maxFileBytes: 128,
    maxFiles: 12,
    allowedExtensions: ['.json', '.webp', '.png'],
    mode: 'compat',
    includePath: relativePath => !relativePath.split('/').includes('__MACOSX')
      && !relativePath.split('/').some(segment => segment.startsWith('._')),
  })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.deepEqual([...result.files.keys()], ['pet.json', 'spritesheet.webp', 'DUPLICATE.png'])
    assert.equal(new TextDecoder().decode(result.files.get('DUPLICATE.png')), 'first')
  }

  assert.deepEqual(guardArchive(zip, {
    maxTotalBytes: 256,
    maxFileBytes: 128,
    maxFiles: 12,
    allowedExtensions: ['.json', '.webp', '.png'],
    mode: 'strict',
  }), { ok: false, error: 'unsafe_path' })
  assert.deepEqual(guardArchive(makeZip({ 'notes: v2.txt': 'x', 'cat /x.png': 'y' }), {
    ...DEFAULTS,
    maxFiles: 1,
    mode: 'compat',
  }), { ok: false, error: 'file_limit_exceeded' })
  assert.deepEqual(guardArchive(makeZip({ 'cat /large.png': '12345' }), {
    ...DEFAULTS,
    maxFileBytes: 4,
    mode: 'compat',
  }), { ok: false, error: 'file_size_exceeded' })
  assert.deepEqual(guardArchive(makeZip({ 'notes: a.txt': '1234', 'cat /b.png': '5678' }), {
    ...DEFAULTS,
    maxTotalBytes: 7,
    maxFileBytes: 10,
    mode: 'compat',
  }), { ok: false, error: 'total_size_exceeded' })
})

test('archive guard rejects duplicate paths using case-insensitive comparison', () => {
  assert.deepEqual(
    guardArchive(makeZip({ 'plugin.js': 'one', 'PLUGIN.JS': 'two' }), DEFAULTS),
    { ok: false, error: 'duplicate_path' },
  )
})

test('archive guard filters only after validating limits and path safety', () => {
  const result = guardArchive(makeZip({
    'dist/main.js': 'code',
    'assets/icon.png': 'image',
  }), {
    ...DEFAULTS,
    includePath: path => path.endsWith('.js'),
  })
  assert.equal(result.ok, true)
  if (result.ok) assert.deepEqual([...result.files.keys()], ['dist/main.js'])
})

test('archive guard returns a stable error for malformed ZIP data and invalid limits', () => {
  assert.deepEqual(guardArchive(new Uint8Array([1, 2, 3]), DEFAULTS), { ok: false, error: 'invalid_archive' })
  assert.deepEqual(guardArchive(makeZip({ 'main.js': 'x' }), { ...DEFAULTS, maxFiles: 0 }), { ok: false, error: 'invalid_limits' })
})
