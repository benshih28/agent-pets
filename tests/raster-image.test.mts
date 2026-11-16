import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import test from 'node:test'
import { strToU8, zipSync } from 'fflate'
import { parsePetBehaviorManifest } from '../electron/pet-behavior-manifest.ts'
import { sanitizePetId } from '../electron/pet-id.ts'
import { parsePetZip, type ParsePetZipOptions } from '../electron/pet-import.ts'
import { isSupportedRasterImage, rasterContentType, readImageAnimated, readImageOrientation, readImageSize, validateSpriteSheet } from '../electron/pet-sprite-validation.ts'
import { checkPanelThemePackagedImage, checkPanelThemeUserImage } from '../electron/plugin-panel-themes.ts'
import { PluginRegistry } from '../electron/plugin-registry.ts'
import { rasterImageTypeIn, sniffRasterImageType } from '../electron/raster-image.ts'
import { jpeg, png, webp } from './support/panel-theme-fixtures.mts'
import { removeTempTree } from './support/temp-dir.mts'

// 固定每個入口「依檔頭接受哪些圖片格式」。各入口的白名單刻意不同，
// 共用的格式辨識不得改變任何一個入口的結果。

type RasterType = 'image/png' | 'image/jpeg' | 'image/webp'

const ascii = (value: string) => [...value].map(character => character.charCodeAt(0))
const bytes = (...parts: number[][]) => new Uint8Array(parts.flat())

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_SOI = [0xff, 0xd8, 0xff]
const WEBP_HEADER = [...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP')]

/** 只有檔頭的樣本：辨識格式用，沒有可讀的尺寸。 */
const HEADER_SAMPLES = {
  pngSignature: bytes(PNG_SIGNATURE),
  jpegSoi: bytes(JPEG_SOI),
  webpHeader: bytes(WEBP_HEADER),
  pngTruncated: bytes(PNG_SIGNATURE.slice(0, 7)),
  jpegTruncated: bytes(JPEG_SOI.slice(0, 2)),
  webpTruncated: bytes(WEBP_HEADER.slice(0, 11)),
  pngWrongFirstByte: bytes([0x88], PNG_SIGNATURE.slice(1)),
  pngWrongLastByte: bytes(PNG_SIGNATURE.slice(0, 7), [0x0b]),
  pngPrefixOnly: bytes([0x89, 0x50], new Array(22).fill(0)),
  jpegWrongThirdByte: bytes([0xff, 0xd8, 0xfe]),
  webpWrongFourcc: bytes(ascii('RIFF'), [0, 0, 0, 0], ascii('WEBQ')),
  riffWave: bytes(ascii('RIFF'), [0, 0, 0, 0], ascii('WAVE')),
  rifxWebp: bytes(ascii('RIFX'), [0, 0, 0, 0], ascii('WEBP')),
  gif87a: bytes(ascii('GIF87a'), [1, 0, 1, 0]),
  gif89a: bytes(ascii('GIF89a'), [1, 0, 1, 0]),
  bmp: bytes(ascii('BM'), new Array(24).fill(0)),
  ico: bytes([0, 0, 1, 0, 1, 0], new Array(16).fill(0)),
  avif: bytes([0, 0, 0, 0x20], ascii('ftypavif'), new Array(8).fill(0)),
  svg: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
  empty: new Uint8Array(),
} satisfies Record<string, Uint8Array>

type HeaderSample = keyof typeof HEADER_SAMPLES

/** 寵物 spritesheet（匯入、自訂寵物、插件 skin 的讀取與 agent-pets:// 回應）：PNG、JPEG、WebP。 */
const PET_SPRITE_EXPECTED: Record<HeaderSample, RasterType | null> = {
  pngSignature: 'image/png',
  jpegSoi: 'image/jpeg',
  webpHeader: 'image/webp',
  pngTruncated: null,
  jpegTruncated: null,
  webpTruncated: null,
  pngWrongFirstByte: null,
  pngWrongLastByte: null,
  pngPrefixOnly: null,
  jpegWrongThirdByte: null,
  webpWrongFourcc: null,
  riffWave: null,
  rifxWebp: null,
  gif87a: null,
  gif89a: null,
  bmp: null,
  ico: null,
  avif: null,
  svg: null,
  empty: null,
}

/** 插件套件內的 icon 與 skin spritesheet：只接受 PNG、WebP。 */
const PLUGIN_ARCHIVE_ACCEPTS: Record<HeaderSample, boolean> = {
  ...Object.fromEntries(Object.keys(HEADER_SAMPLES).map(name => [name, false])) as Record<HeaderSample, boolean>,
  pngSignature: true,
  webpHeader: true,
}

function embedded(data: Uint8Array): Uint8Array {
  // 以帶 byteOffset 的 view 傳入，確認辨識不是讀整個底層 ArrayBuffer。
  const backing = new Uint8Array(data.length + 6).fill(0x89)
  backing.set(data, 3)
  return backing.subarray(3, 3 + data.length)
}

test('pet spritesheet entry: PNG, JPEG and WebP by signature; truncated, altered and other formats are rejected', () => {
  for (const [name, data] of Object.entries(HEADER_SAMPLES) as [HeaderSample, Uint8Array][]) {
    const expected = PET_SPRITE_EXPECTED[name]
    assert.equal(rasterContentType(data), expected, name)
    assert.equal(isSupportedRasterImage(data), expected !== null, name)
    assert.equal(rasterContentType(embedded(data)), expected, `${name} (offset view)`)
  }
  assert.equal(rasterContentType(png(64, 64)), 'image/png')
  assert.equal(rasterContentType(jpeg(64, 64)), 'image/jpeg')
  assert.equal(rasterContentType(webp(64, 64)), 'image/webp')
})

const PET_IMPORT_OPTIONS: ParsePetZipOptions = {
  limits: { maxZipBytes: 10 * 1024 * 1024, maxEntries: 64, maxUncompressedBytes: 25 * 1024 * 1024, maxJsonBytes: 256 * 1024, maxImageBytes: 20 * 1024 * 1024 },
  sanitizePetId,
  parsePetBehaviorManifest,
  isSupportedRasterImage,
  now: () => 1,
}

function importSprite(name: string, sprite: Uint8Array) {
  return parsePetZip(zipSync({ 'pet.json': strToU8(JSON.stringify({ id: 'fox' })), [name]: sprite }), PET_IMPORT_OPTIONS)
}

test('pet import decides by content, not by the file extension', () => {
  const height = 208 * 9
  for (const sprite of [png(1536, height), jpeg(1536, height), webp(1536, height)]) {
    for (const name of ['spritesheet.webp', 'spritesheet.png', 'spritesheet.jpg']) {
      const result = importSprite(name, sprite)
      assert.equal(result.ok, true, `${name}: ${JSON.stringify(result)}`)
    }
  }
  const valid = png(1536, height)
  const altered = new Uint8Array(valid)
  altered[7] = 0x0b
  const gif = new Uint8Array(valid.length)
  gif.set(ascii('GIF89a'))
  for (const sprite of [altered, gif, valid.subarray(0, 7)]) {
    assert.deepEqual(importSprite('spritesheet.png', sprite), { ok: false, error: 'Spritesheet content is not a valid PNG, JPEG, or WebP image' })
  }
})

function withUserData(run: (directory: string) => void): void {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-raster-image-'))
  try { run(directory) } finally { removeTempTree(directory) }
}

const PLUGIN_BASE = { id: 'sample-plugin', name: { 'zh-TW': '測試', 'en-US': 'Test' }, version: '1.0.0', apiVersion: '1', author: 'Test', permissions: {} }

function iconArchive(iconPath: string, icon: Uint8Array): Uint8Array {
  return zipSync({
    'plugin.json': strToU8(JSON.stringify({ ...PLUGIN_BASE, entry: 'dist/main.js', icon: iconPath, contributes: {} })),
    'dist/main.js': strToU8('export default {}'),
    [iconPath]: icon,
  })
}

function skinArchive(spritesheet: string, sprite: Uint8Array): Uint8Array {
  return zipSync({
    'plugin.json': strToU8(JSON.stringify({ ...PLUGIN_BASE, contributes: { skins: [{ id: 'fox', displayName: { 'zh-TW': '狐狸', 'en-US': 'Fox' }, spritesheet, kind: 'animal' }] } })),
    [spritesheet]: sprite,
  })
}

test('plugin archive icon and skin entries: PNG and WebP only, by content, whatever the extension', () => {
  withUserData(userData => {
    const registry = new PluginRegistry(userData)
    for (const [name, data] of Object.entries(HEADER_SAMPLES) as [HeaderSample, Uint8Array][]) {
      const accepted = PLUGIN_ARCHIVE_ACCEPTS[name]
      for (const iconPath of ['icon.png', 'icon.webp']) {
        const result = registry.planInstall(iconArchive(iconPath, data))
        assert.equal(result.ok ? 'ok' : result.error, accepted ? 'ok' : 'invalid_icon', `${name} as ${iconPath}`)
      }
      for (const spritesheet of ['skins/fox.png', 'skins/fox.webp']) {
        const result = registry.planInstall(skinArchive(spritesheet, data))
        assert.equal(result.ok ? 'ok' : result.error, accepted ? 'ok' : 'invalid_manifest', `${name} as ${spritesheet}`)
      }
    }
    for (const [label, data, accepted] of [['png', png(64, 64), true], ['webp', webp(64, 64), true], ['jpeg', jpeg(64, 64), false]] as const) {
      const icon = registry.planInstall(iconArchive('icon.png', data))
      assert.equal(icon.ok ? 'ok' : icon.error, accepted ? 'ok' : 'invalid_icon', `${label} icon`)
      const skin = registry.planInstall(skinArchive('skins/fox.webp', data))
      assert.equal(skin.ok ? 'ok' : skin.error, accepted ? 'ok' : 'invalid_manifest', `${label} skin`)
    }
  })
})

test('panel theme images: packaged PNG and WebP, user PNG, JPEG and WebP; malformed headers are image_invalid', () => {
  assert.equal(checkPanelThemePackagedImage(png(512, 256)).ok, true)
  assert.equal(checkPanelThemePackagedImage(webp(512, 256)).ok, true)
  assert.deepEqual(checkPanelThemePackagedImage(jpeg(512, 256)), { ok: false, error: 'image_invalid' })
  assert.deepEqual(checkPanelThemeUserImage(png(512, 256)), { ok: true, type: 'image/png', width: 512, height: 256 })
  assert.deepEqual(checkPanelThemeUserImage(jpeg(512, 256)), { ok: true, type: 'image/jpeg', width: 512, height: 256 })
  assert.deepEqual(checkPanelThemeUserImage(webp(512, 256)), { ok: true, type: 'image/webp', width: 512, height: 256 })
  for (const data of Object.values(HEADER_SAMPLES)) {
    assert.deepEqual(checkPanelThemePackagedImage(data), { ok: false, error: 'image_invalid' })
    assert.deepEqual(checkPanelThemeUserImage(data), { ok: false, error: 'image_invalid' })
  }
  // 尺寸正確但 signature 錯一個位元組：由格式辨識擋下，不靠尺寸解析。
  for (const valid of [png(512, 256), webp(512, 256), jpeg(512, 256)]) {
    for (const index of valid[0] === 0xff ? [0, 1, 2] : valid[0] === 0x89 ? [0, 3, 7] : [0, 3, 8, 11]) {
      const altered = new Uint8Array(valid)
      altered[index] ^= 0x01
      assert.deepEqual(checkPanelThemeUserImage(altered), { ok: false, error: 'image_invalid' }, `byte ${index} of ${valid[0]}`)
      assert.deepEqual(checkPanelThemePackagedImage(altered), { ok: false, error: 'image_invalid' })
    }
  }
})

test('the shared sniffer only names a format; each entry keeps its own whitelist', () => {
  assert.equal(sniffRasterImageType(HEADER_SAMPLES.jpegSoi), 'image/jpeg')
  assert.equal(rasterImageTypeIn(HEADER_SAMPLES.jpegSoi, new Set(['image/png', 'image/webp'])), null)
  assert.equal(rasterImageTypeIn(HEADER_SAMPLES.webpHeader, new Set(['image/png', 'image/webp'])), 'image/webp')
  assert.equal(rasterImageTypeIn(HEADER_SAMPLES.gif89a, new Set(['image/png', 'image/jpeg', 'image/webp'])), null)
  for (const [name, data] of Object.entries(HEADER_SAMPLES) as [HeaderSample, Uint8Array][]) {
    assert.equal(sniffRasterImageType(data), PET_SPRITE_EXPECTED[name], name)
  }
})

test('header readers dispatch on the full signature, not on the first two bytes', () => {
  // 1.12.5 的讀取函式只看 89 50（或 FF D8、52 49 … 57）就分派，單獨呼叫時會從
  // 這種檔頭讀出尺寸。所有正式入口都先做完整 signature 檢查，所以入口結果不變。
  const prefixOnly = new Uint8Array(64)
  prefixOnly.set([0x89, 0x50, 0, 0, 0, 0, 0, 0, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(prefixOnly.buffer).setUint32(16, 1536)
  new DataView(prefixOnly.buffer).setUint32(20, 208 * 9)
  assert.equal(readImageSize(prefixOnly), null)
  assert.deepEqual(validateSpriteSheet(prefixOnly), { ok: false, code: 'E_TYPE' })
  const fixed = new Uint8Array(prefixOnly)
  fixed.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  assert.equal(validateSpriteSheet(fixed).ok, true)

  const webpPrefix = new Uint8Array(webp(64, 64))
  webpPrefix[2] = 0
  assert.equal(readImageSize(webpPrefix), null)
  assert.equal(readImageAnimated(new Uint8Array(webp(64, 64, { animated: true })).fill(0, 2, 3)), false)
  const rotated = new Uint8Array(jpeg(64, 64, { orientation: 6 }))
  assert.equal(readImageOrientation(rotated), 6)
  rotated[2] = 0xfe
  assert.equal(readImageOrientation(rotated), 1)
})
