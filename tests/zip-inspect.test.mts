import assert from 'node:assert/strict'
import test from 'node:test'
import { zipSync, type Zippable } from 'fflate'
import { crc32, extractZipEntry, inspectZipArchive, type ZipInspectLimits } from '../electron/zip-inspect.ts'

const LIMITS: ZipInspectLimits = {
  maxEntries: 8,
  maxTotalUncompressedBytes: 4 * 1024 * 1024,
  maxCompressionRatio: 100,
  ratioCheckMinBytes: 1024 * 1024,
}

const text = (value: string) => new TextEncoder().encode(value)

function zip(files: Zippable): Uint8Array {
  return zipSync(files, { level: 0 })
}

/** Offsets of every central-directory record in an archive. */
function centralRecords(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const offsets: number[] = []
  for (let offset = 0; offset + 4 <= bytes.length; offset += 1) {
    if (view.getUint32(offset, true) === 0x02014b50) offsets.push(offset)
  }
  return offsets
}

function patch(bytes: Uint8Array, mutate: (view: DataView, records: number[]) => void): Uint8Array {
  const copy = bytes.slice()
  mutate(new DataView(copy.buffer), centralRecords(copy))
  return copy
}

test('accepts an ordinary sprite kit and lists its entries', () => {
  const result = inspectZipArchive(zip({ 'kit/pet.json': text('{"id":"a"}'), 'kit/spritesheet.webp': new Uint8Array(64) }), LIMITS)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.entries.map(entry => entry.name).sort(), ['kit/pet.json', 'kit/spritesheet.webp'])
  assert.equal(result.totalUncompressedBytes, 74)
})

test('rejects garbage, truncated and ZIP64 archives', () => {
  assert.deepEqual(inspectZipArchive(new Uint8Array(10), LIMITS), { ok: false, error: 'invalid_archive' })
  assert.deepEqual(inspectZipArchive(text('not a zip archive at all, just text padding'), LIMITS), { ok: false, error: 'invalid_archive' })
  const valid = zip({ 'pet.json': text('{}') })
  const zip64 = valid.slice()
  const eocd = zip64.length - 22
  new DataView(zip64.buffer).setUint32(eocd + 16, 0xffffffff, true)
  assert.deepEqual(inspectZipArchive(zip64, LIMITS), { ok: false, error: 'unsupported_archive' })
})

test('rejects symlink, reparse-point and encrypted entries', () => {
  const base = zip({ 'pet.json': text('{}'), 'link.png': text('../../etc/passwd') })
  const symlink = patch(base, (view, records) => {
    view.setUint8(records[1] + 5, 3)
    view.setUint32(records[1] + 38, (0o120777 << 16) >>> 0, true)
  })
  assert.deepEqual(inspectZipArchive(symlink, LIMITS), { ok: false, error: 'symlink_entry' })
  const reparse = patch(base, (view, records) => {
    view.setUint8(records[1] + 5, 0)
    view.setUint32(records[1] + 38, 0x400, true)
  })
  assert.deepEqual(inspectZipArchive(reparse, LIMITS), { ok: false, error: 'symlink_entry' })
  const encrypted = patch(base, (view, records) => view.setUint16(records[0] + 8, 1, true))
  assert.deepEqual(inspectZipArchive(encrypted, LIMITS), { ok: false, error: 'encrypted_entry' })
})

test('rejects zip-slip names, non-UTF-8 names and case-insensitive duplicates', () => {
  for (const name of ['../pet.json', '/abs/pet.json', 'C:/pet.json', 'a/../../pet.json']) {
    // fflate writes the name as given, so the archive itself carries the hostile path.
    assert.deepEqual(inspectZipArchive(zip({ [name]: text('{}') }), LIMITS), { ok: false, error: 'unsafe_path' }, name)
  }
  const nonUtf8 = patch(zip({ 'pet.json': text('{}'), 'abcd.png': text('x') }), (view, records) => {
    view.setUint8(records[1] + 46, 0xff)
  })
  assert.deepEqual(inspectZipArchive(nonUtf8, LIMITS), { ok: false, error: 'invalid_name' })
  const duplicate = patch(zip({ 'pet.json': text('{}'), 'PET.JSON': text('{"x":1}') }), () => undefined)
  assert.deepEqual(inspectZipArchive(duplicate, LIMITS), { ok: false, error: 'duplicate_path' })
  const control = zip({ 'pet\u0001.json': text('{}') })
  assert.deepEqual(inspectZipArchive(control, LIMITS), { ok: false, error: 'invalid_name' })
})

test('accepts UTF-8 names written without the language-encoding flag (macOS Archive Utility)', () => {
  const archive = patch(zip({ '寵物/pet.json': text('{}') }), (view, records) => {
    const local = view.getUint32(records[0] + 42, true)
    view.setUint16(records[0] + 8, view.getUint16(records[0] + 8, true) & ~0x800, true)
    view.setUint16(local + 6, view.getUint16(local + 6, true) & ~0x800, true)
  })
  const result = inspectZipArchive(archive, LIMITS)
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.entries[0].name, '寵物/pet.json')
})

test('enforces entry count, total size and compression-ratio limits before inflating', () => {
  const many: Zippable = {}
  for (let index = 0; index < 9; index += 1) many[`f${index}.png`] = text('x')
  assert.deepEqual(inspectZipArchive(zip(many), LIMITS), { ok: false, error: 'file_limit_exceeded' })

  const bomb = zipSync({ 'zeros.png': new Uint8Array(3 * 1024 * 1024) }, { level: 9 })
  assert.deepEqual(inspectZipArchive(bomb, LIMITS), { ok: false, error: 'compression_ratio_exceeded' })

  const huge = patch(zip({ 'pet.json': text('{}') }), (view, records) => {
    view.setUint32(records[0] + 20, 1, true)
    view.setUint32(records[0] + 24, 64 * 1024 * 1024, true)
  })
  const result = inspectZipArchive(huge, LIMITS)
  assert.equal(result.ok, false)
  if (!result.ok) assert.ok(['total_size_exceeded', 'invalid_archive', 'compression_ratio_exceeded'].includes(result.error))
})

test('rejects entries whose data ranges overlap (overlapping-file zip bomb)', () => {
  const archive = patch(zip({ 'a.png': text('aaaa'), 'b.png': text('bbbb') }), (view, records) => {
    // Stretch a.png's data over b.png's local header and data.
    const eocd = view.byteLength - 22
    const centralOffset = view.getUint32(eocd + 16, true)
    const localA = view.getUint32(records[0] + 42, true)
    const size = centralOffset - (localA + 30 + view.getUint16(localA + 26, true) + view.getUint16(localA + 28, true))
    for (const offset of [records[0] + 20, records[0] + 24]) view.setUint32(offset, size, true)
    for (const offset of [localA + 18, localA + 22]) view.setUint32(offset, size, true)
  })
  assert.deepEqual(inspectZipArchive(archive, LIMITS), { ok: false, error: 'overlapping_entries' })
})

/** Repro from the security review: a fake EOCD hidden in the real EOCD's comment. */
function hiddenEocdArchive(): Uint8Array {
  const hidden = zip({ 'evil.json': text('{"hidden":true}') })
  const visible = zip({ 'pet.json': text('{"id":"ok"}') })
  const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const hiddenEocd = hidden.length - 22
  const visibleEocd = visible.length - 22
  const visibleCentral = view(visible).getUint32(visibleEocd + 16, true)
  const visibleCentralSize = view(visible).getUint32(visibleEocd + 12, true)
  const hiddenBody = hidden.subarray(0, hiddenEocd)
  const visibleBody = visible.slice(0, visibleEocd)
  const shift = hiddenBody.length
  for (let cursor = visibleCentral; cursor < visibleCentral + visibleCentralSize;) {
    const v = view(visibleBody)
    v.setUint32(cursor + 42, v.getUint32(cursor + 42, true) + shift, true)
    cursor += 46 + v.getUint16(cursor + 28, true) + v.getUint16(cursor + 30, true) + v.getUint16(cursor + 32, true)
  }
  const fake = hidden.slice(hiddenEocd)
  view(fake).setUint16(20, 5, true)
  const real = visible.slice(visibleEocd)
  view(real).setUint32(16, visibleCentral + shift, true)
  view(real).setUint16(20, fake.length, true)
  const out = new Uint8Array(hiddenBody.length + visibleBody.length + real.length + fake.length)
  out.set(hiddenBody, 0)
  out.set(visibleBody, hiddenBody.length)
  out.set(real, hiddenBody.length + visibleBody.length)
  out.set(fake, hiddenBody.length + visibleBody.length + real.length)
  return out
}

test('rejects an archive whose EOCD comment hides a second EOCD (parser differential)', () => {
  assert.equal(inspectZipArchive(hiddenEocdArchive(), LIMITS).ok, false)
})

test('rejects a ZIP64 locator, a gap before the EOCD, and trailing EOCD signatures', () => {
  const base = zip({ 'pet.json': text('{}') })
  const eocd = base.length - 22
  const locator = new Uint8Array(base.length + 20)
  locator.set(base.subarray(0, eocd), 0)
  new DataView(locator.buffer).setUint32(eocd, 0x07064b50, true)
  locator.set(base.subarray(eocd), eocd + 20)
  // The central directory now ends 20 bytes before the EOCD and a locator sits at eocd-20.
  assert.deepEqual(inspectZipArchive(locator, LIMITS), { ok: false, error: 'unsupported_archive' })

  const gap = new Uint8Array(base.length + 4)
  gap.set(base.subarray(0, eocd), 0)
  gap.set(base.subarray(eocd), eocd + 4)
  assert.deepEqual(inspectZipArchive(gap, LIMITS), { ok: false, error: 'invalid_archive' })
})

test('rejects local headers that disagree with the central directory', () => {
  const base = zip({ 'pet.json': text('{}') })
  const mismatches: Array<(view: DataView, local: number) => void> = [
    (view, local) => view.setUint8(local + 30, 0x50), // name byte
    (view, local) => view.setUint16(local + 8, 8, true), // method
    (view, local) => view.setUint32(local + 14, 1, true), // crc
    (view, local) => view.setUint32(local + 22, 99, true), // uncompressed size
  ]
  for (const mutate of mismatches) {
    const archive = patch(base, (view, records) => mutate(view, view.getUint32(records[0] + 42, true)))
    assert.deepEqual(inspectZipArchive(archive, LIMITS), { ok: false, error: 'invalid_archive' })
  }
})

test('extracts only inspected entries and verifies length and CRC-32', () => {
  const payload = text('{"id":"ok"}'.repeat(50))
  for (const level of [0, 9] as const) {
    const archive = zipSync({ 'pet.json': payload }, { level })
    const inspected = inspectZipArchive(archive, LIMITS)
    assert.equal(inspected.ok, true)
    if (!inspected.ok) continue
    const extracted = extractZipEntry(archive, inspected.entries[0])
    assert.equal(extracted.ok && new TextDecoder().decode(extracted.data), new TextDecoder().decode(payload))
    assert.equal(crc32(payload), inspected.entries[0].crc32)
    assert.deepEqual(extractZipEntry(archive, { ...inspected.entries[0], crc32: inspected.entries[0].crc32 ^ 1 }), { ok: false, error: 'checksum_mismatch' })
    // A stream that inflates past its declared size is refused instead of truncated.
    assert.deepEqual(extractZipEntry(archive, { ...inspected.entries[0], uncompressedSize: payload.length - 1 }), { ok: false, error: 'invalid_archive' })
  }
  assert.equal(crc32(text('123456789')), 0xcbf43926)
})
