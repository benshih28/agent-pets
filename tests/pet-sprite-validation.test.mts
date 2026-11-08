import assert from 'node:assert/strict'
import test from 'node:test'
import { detectSpriteAtlas, readImageOrientation, readImageSize, validateSpriteSheet, SPRITE_MAX_HEIGHT, SPRITE_MAX_WIDTH } from '../electron/pet-sprite-validation.ts'

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  return bytes
}

function webpLossless(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(40)
  bytes.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c, 0, 0, 0, 0, 0x2f])
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14)
  new DataView(bytes.buffer).setUint32(21, bits, true)
  return bytes
}

function webpExtended(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(40)
  bytes.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58])
  const w = width - 1
  const h = height - 1
  bytes.set([w & 255, (w >> 8) & 255, (w >> 16) & 255], 24)
  bytes.set([h & 255, (h >> 8) & 255, (h >> 16) & 255], 27)
  return bytes
}

test('reads dimensions from PNG and WebP headers', () => {
  assert.deepEqual(readImageSize(png(1536, 1872)), { width: 1536, height: 1872 })
  assert.deepEqual(readImageSize(webpLossless(1536, 1872)), { width: 1536, height: 1872 })
  assert.deepEqual(readImageSize(webpExtended(1536, 1872)), { width: 1536, height: 1872 })
  assert.equal(readImageSize(new Uint8Array([1, 2, 3])), null)
})

test('accepts a v2 atlas and rejects off-grid or short sheets with a code', () => {
  assert.equal(validateSpriteSheet(png(1536, 1872)).ok, true)
  assert.deepEqual(validateSpriteSheet(png(1000, 1872)), { ok: false, code: 'E_SIZE' })
  assert.deepEqual(validateSpriteSheet(png(1536, 208 * 4)), { ok: false, code: 'E_ROWS' })
  assert.deepEqual(validateSpriteSheet(new Uint8Array(8)), { ok: false, code: 'E_TYPE' })
})

test('oversized spritesheet dimensions are rejected from the header alone', () => {
  assert.deepEqual(validateSpriteSheet(png(192, 208 * 9)).ok, true)
  assert.deepEqual(validateSpriteSheet(png(SPRITE_MAX_WIDTH + 192, 208 * 9)), { ok: false, code: 'E_SIZE' })
  assert.deepEqual(validateSpriteSheet(png(192, SPRITE_MAX_HEIGHT + 208)), { ok: false, code: 'E_SIZE' })
  assert.deepEqual(validateSpriteSheet(png(SPRITE_MAX_WIDTH, SPRITE_MAX_HEIGHT)), { ok: false, code: 'E_SIZE' })
})

test('a PNG whose first chunk is not IHDR is not trusted for dimensions', () => {
  const bytes = png(1536, 1872)
  bytes[12] = 0x58
  assert.equal(readImageSize(bytes), null)
})

test('detects the atlas version from rows, not from the declared version', () => {
  assert.deepEqual(detectSpriteAtlas({ width: 1536, height: 208 * 9 }), {
    version: 1, columns: 8, rows: 9, width: 1536, height: 1872, frameWidth: 192, frameHeight: 208, warnings: [],
  })
  assert.equal(detectSpriteAtlas({ width: 1536, height: 208 * 11 }).version, 2)
  assert.deepEqual(detectSpriteAtlas({ width: 1536, height: 208 * 11 }, 1).warnings, ['declared-version-mismatch'])
  assert.deepEqual(detectSpriteAtlas({ width: 192 * 6, height: 208 * 10 }).warnings, ['unexpected-row-count', 'unexpected-column-count'])
  assert.equal(detectSpriteAtlas({ width: 1536, height: 208 * 10 }).version, 1)
})

function sof(width: number, height: number): number[] {
  return [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]
}
const SOS = [0xff, 0xda, 0x00, 0x0c, 0x03, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]
const ENTROPY = [0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]
const EOI = [0xff, 0xd9]

function exifApp1(orientation: number): number[] {
  // "Exif\0\0" + little-endian TIFF with one IFD0 entry: Orientation (SHORT).
  const tiff = [0x49, 0x49, 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0, 0, 0, 0, 0]
  const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
  return [0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 255, ...body]
}

const jpeg = (...parts: number[][]) => new Uint8Array([0xff, 0xd8, ...parts.flat()])

test('reads the JPEG frame size from the only SOF before the first scan', () => {
  assert.deepEqual(readImageSize(jpeg(sof(1536, 1872), SOS, ENTROPY, EOI)), { width: 1536, height: 1872 })
  // Fill bytes before a marker are padding, not a marker with a length.
  assert.deepEqual(readImageSize(jpeg([0xff, 0xff], sof(1536, 1872), SOS, ENTROPY, EOI)), { width: 1536, height: 1872 })
})

test('JPEG pixel-cap bypasses are rejected (security review repro)', () => {
  const repro = new Uint8Array(60000)
  repro.set([0xff, 0xd8, 0xff, 0xff, 0xc0, 0x00, 0x11, 0x08, 0xff, 0xff, 0xff, 0xff, 0x03], 0)
  repro.set([0xff, 0xc0, 0x00, 0x11, 0x08, 0x07, 0x50, 0x06, 0x00, 0x03], 2 + 2 + 49152)
  assert.deepEqual(validateSpriteSheet(repro), { ok: false, code: 'E_TYPE' })
  assert.equal(readImageSize(jpeg(sof(1536, 1872), sof(1536, 1872), SOS, ENTROPY, EOI)), null, 'two SOFs')
  assert.equal(readImageSize(jpeg(SOS, ENTROPY, sof(1536, 1872), EOI)), null, 'SOF after SOS')
  assert.equal(readImageSize(jpeg(sof(1536, 1872), SOS, ENTROPY, sof(65535, 65535), EOI)), null, 'second SOF hidden after entropy data')
  assert.equal(readImageSize(jpeg([0xff, 0xe0, 0x40, 0x00, 1, 2])), null, 'segment past EOF')
  assert.equal(readImageSize(jpeg(sof(1536, 1872))), null, 'no scan')
})

test('EXIF orientation other than 1 is rejected for JPEG, PNG and WebP', () => {
  assert.equal(validateSpriteSheet(jpeg(exifApp1(1), sof(1536, 1872), SOS, ENTROPY, EOI)).ok, true)
  assert.deepEqual(validateSpriteSheet(jpeg(exifApp1(6), sof(1536, 1872), SOS, ENTROPY, EOI)), { ok: false, code: 'E_ORIENTATION' })
  assert.equal(readImageOrientation(jpeg(exifApp1(8), sof(1536, 1872), SOS, ENTROPY, EOI)), 8)

  const tiff = exifApp1(6).slice(10)
  const ihdr = png(1536, 1872).slice(0, 33)
  const exifChunk = new Uint8Array(12 + tiff.length)
  new DataView(exifChunk.buffer).setUint32(0, tiff.length)
  exifChunk.set([0x65, 0x58, 0x49, 0x66], 4)
  exifChunk.set(tiff, 8)
  const rotatedPng = new Uint8Array([...ihdr, ...exifChunk])
  assert.equal(readImageOrientation(rotatedPng), 6)
  assert.deepEqual(validateSpriteSheet(rotatedPng), { ok: false, code: 'E_ORIENTATION' })

  const webp = webpExtended(1536, 1872)
  new DataView(webp.buffer).setUint32(16, 10, true) // VP8X chunk size
  const webpExif = new Uint8Array(webp.length - 10 + 8 + tiff.length)
  webpExif.set(webp.subarray(0, 30), 0)
  webpExif.set([0x45, 0x58, 0x49, 0x46, tiff.length, 0, 0, 0], 30)
  webpExif.set(tiff, 38)
  assert.equal(readImageOrientation(webpExif), 6)
  assert.equal(readImageOrientation(webpExtended(1536, 1872)), 1)
})
