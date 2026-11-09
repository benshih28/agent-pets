import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import test from 'node:test'
import {
  deleteUserImage,
  prepareUserImage,
  readUserImageSource,
  removePluginImages,
  storeUserImage,
  sweepOrphanUserImages,
} from '../electron/panel-theme-images.ts'
import { readImageAnimated } from '../electron/pet-sprite-validation.ts'
import { jpeg, png, webp } from './support/panel-theme-fixtures.mts'
import { SKIP_WITHOUT_FILE_SYMLINKS } from './support/fs-capabilities.mts'

async function withDirectory(run: (directory: string) => Promise<void> | void): Promise<void> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-panel-theme-images-'))
  try { await run(fs.realpathSync(directory)) } finally { fs.rmSync(directory, { recursive: true, force: true }) }
}

test('readImageAnimated detects APNG and animated WebP from headers only', () => {
  assert.equal(readImageAnimated(png(64, 64)), false)
  assert.equal(readImageAnimated(png(64, 64, { animated: true })), true)
  assert.equal(readImageAnimated(webp(64, 64)), false)
  assert.equal(readImageAnimated(webp(64, 64, { animated: true })), true)
  assert.equal(readImageAnimated(jpeg(64, 64)), false)
  assert.equal(readImageAnimated(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), false)
})

test('user image source is read once from a regular file and capped by size', async () => {
  await withDirectory(async directory => {
    const file = path.join(directory, 'photo.jpg')
    fs.writeFileSync(file, jpeg(640, 480, { orientation: 6 }))
    const read = await readUserImageSource(file)
    assert.equal(read.ok, true)
    assert.deepEqual(await readUserImageSource(directory), { ok: false, error: 'image_invalid' })
    assert.deepEqual(await readUserImageSource('relative.png'), { ok: false, error: 'image_invalid' })
    const large = path.join(directory, 'large.png')
    fs.writeFileSync(large, Buffer.alloc(20 * 1024 * 1024 + 1))
    assert.deepEqual(await readUserImageSource(large), { ok: false, error: 'image_too_large' })
  })
})

test('a symlinked source image is refused', { skip: SKIP_WITHOUT_FILE_SYMLINKS }, async () => {
  await withDirectory(async directory => {
    const target = path.join(directory, 'real.png')
    fs.writeFileSync(target, png(128, 128))
    fs.symlinkSync(target, path.join(directory, 'link.png'))
    assert.deepEqual(await readUserImageSource(path.join(directory, 'link.png')), { ok: false, error: 'image_invalid' })
  })
})

test('prepareUserImage validates in memory and names the copy by sha256', () => {
  const bytes = jpeg(4032, 3024, { orientation: 6 })
  const prepared = prepareUserImage(bytes)
  assert.equal(prepared.ok, true)
  if (!prepared.ok) return
  assert.equal(prepared.file, `${createHash('sha256').update(bytes).digest('hex')}.jpg`)
  assert.deepEqual(prepareUserImage(png(256, 256, { animated: true })), { ok: false, error: 'image_invalid', reason: 'animated' })
  assert.deepEqual(prepareUserImage(png(9000, 64)), { ok: false, error: 'image_too_large' })
  assert.deepEqual(prepareUserImage(png(5000, 5000)), { ok: false, error: 'image_too_large' })
  assert.deepEqual(prepareUserImage(new TextEncoder().encode('GIF89a......')), { ok: false, error: 'image_invalid' })
  assert.deepEqual(prepareUserImage(jpeg(128, 128, { secondSof: true })), { ok: false, error: 'image_invalid' })
})

test('stored images live in a 0o700 per-plugin directory and are cleaned up', async () => {
  await withDirectory(directory => {
    const prepared = prepareUserImage(png(128, 128))
    assert.ok(prepared.ok)
    if (!prepared.ok) return
    storeUserImage(directory, 'theme-pack', prepared)
    storeUserImage(directory, 'theme-pack', prepared)
    const pluginDirectory = path.join(directory, 'panel-theme-images', 'theme-pack')
    assert.deepEqual(fs.readdirSync(pluginDirectory), [prepared.file])
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(pluginDirectory).mode & 0o777, 0o700)
      assert.equal(fs.statSync(path.join(pluginDirectory, prepared.file)).mode & 0o777, 0o600)
    }
    assert.throws(() => storeUserImage(directory, '_host', prepared))
    deleteUserImage(directory, 'theme-pack', '../registry.json')
    deleteUserImage(directory, 'theme-pack', prepared.file)
    assert.deepEqual(fs.readdirSync(pluginDirectory), [])
    storeUserImage(directory, 'theme-pack', prepared)
    removePluginImages(directory, 'theme-pack')
    assert.equal(fs.existsSync(pluginDirectory), false)
  })
})

test('a symlinked plugin image directory is never followed', { skip: SKIP_WITHOUT_FILE_SYMLINKS }, async () => {
  await withDirectory(directory => {
    const outside = path.join(directory, 'outside')
    fs.mkdirSync(outside)
    fs.writeFileSync(path.join(outside, 'keep.txt'), 'keep')
    fs.mkdirSync(path.join(directory, 'panel-theme-images'), { mode: 0o700 })
    fs.symlinkSync(outside, path.join(directory, 'panel-theme-images', 'theme-pack'))
    const prepared = prepareUserImage(png(128, 128))
    assert.ok(prepared.ok)
    if (prepared.ok) assert.throws(() => storeUserImage(directory, 'theme-pack', prepared))
    removePluginImages(directory, 'theme-pack')
    assert.equal(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'keep')
  })
})

test('the startup sweep deletes unreferenced files and stays bounded', async () => {
  await withDirectory(directory => {
    const root = path.join(directory, 'panel-theme-images', 'theme-pack')
    fs.mkdirSync(root, { recursive: true })
    const keep = `${'a'.repeat(64)}.png`
    const orphan = `${'b'.repeat(64)}.png`
    for (const name of [keep, orphan, '.tmp-leftover', 'notes.txt']) fs.writeFileSync(path.join(root, name), 'x')
    assert.equal(sweepOrphanUserImages(directory, new Set([`theme-pack/${keep}`])), 3)
    assert.deepEqual(fs.readdirSync(root), [keep])
    for (let index = 0; index < 300; index += 1) fs.writeFileSync(path.join(root, `${index.toString(16).padStart(64, '0')}.png`), 'x')
    assert.ok(sweepOrphanUserImages(directory, new Set(), 256) < 256)
  })
})
