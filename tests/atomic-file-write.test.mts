import assert from 'node:assert/strict'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { pidTimestampTemporaryPath, writeFileAtomicSync } from '../electron/atomic-file-write.ts'
import { POSIX_FILE_MODES, SKIP_WITHOUT_FILE_SYMLINKS } from './support/fs-capabilities.mts'
import { removeTempTree } from './support/temp-dir.mts'

function withDirectory(run: (directory: string) => void): void {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-atomic-write-'))
  try { run(directory) } finally { removeTempTree(directory) }
}

function withFsPatch<K extends 'renameSync' | 'fsyncSync'>(name: K, replacement: (original: typeof fs[K]) => typeof fs[K], run: () => void): void {
  const original = fs[name]
  fs[name] = replacement(original)
  syncBuiltinESMExports()
  try { run() } finally {
    fs[name] = original
    syncBuiltinESMExports()
  }
}

test('pidTimestampTemporaryPath keeps the shared .<name>.<pid>.<ms>.tmp format next to the target', () => {
  const target = path.join(os.tmpdir(), 'dir', 'settings.json')
  const temporary = pidTimestampTemporaryPath(target)
  assert.equal(path.dirname(temporary), path.dirname(target))
  assert.match(path.basename(temporary), new RegExp(`^\\.settings\\.json\\.${process.pid}\\.\\d+\\.tmp$`))
})

test('writes text and bytes, replacing an existing target', () => {
  withDirectory(directory => {
    const target = path.join(directory, 'a.json')
    fs.writeFileSync(target, 'old')
    writeFileAtomicSync(target, '{"新":1}', { temporaryPath: path.join(directory, '.a.tmp') })
    assert.equal(fs.readFileSync(target, 'utf8'), '{"新":1}')
    const bytes = Uint8Array.from([0, 1, 2, 255])
    writeFileAtomicSync(target, bytes, { temporaryPath: path.join(directory, '.b.tmp') })
    assert.deepEqual(new Uint8Array(fs.readFileSync(target)), bytes)
    assert.deepEqual(fs.readdirSync(directory), ['a.json'])
  })
})

test('refuses a temporary file outside the target directory before touching the disk', () => {
  withDirectory(directory => {
    fs.mkdirSync(path.join(directory, 'other'))
    const temporaryPath = path.join(directory, 'other', '.a.tmp')
    assert.throws(() => writeFileAtomicSync(path.join(directory, 'a.json'), 'x', { temporaryPath }), TypeError)
    assert.equal(fs.existsSync(temporaryPath), false)
  })
})

test('an existing file with the temporary name is neither overwritten nor removed', () => {
  withDirectory(directory => {
    const target = path.join(directory, 'a.json')
    const temporaryPath = path.join(directory, '.a.tmp')
    fs.writeFileSync(temporaryPath, 'someone else')
    assert.throws(() => writeFileAtomicSync(target, 'x', { temporaryPath }), { code: 'EEXIST' })
    assert.equal(fs.readFileSync(temporaryPath, 'utf8'), 'someone else')
    assert.equal(fs.existsSync(target), false)
  })
})

test('fsync runs on the temporary file before rename only when asked', () => {
  withDirectory(directory => {
    const target = path.join(directory, 'a.json')
    const order: string[] = []
    withFsPatch('fsyncSync', original => ((descriptor: number) => { order.push('fsync'); original(descriptor) }) as typeof fs.fsyncSync, () => {
      withFsPatch('renameSync', original => ((from: fs.PathLike, to: fs.PathLike) => { order.push('rename'); original(from, to) }) as typeof fs.renameSync, () => {
        writeFileAtomicSync(target, 'x', { temporaryPath: path.join(directory, '.a.tmp'), fsync: true })
        writeFileAtomicSync(target, 'y', { temporaryPath: path.join(directory, '.b.tmp') })
      })
    })
    assert.deepEqual(order, ['fsync', 'rename', 'rename'])
  })
})

test('a failed fsync removes the temporary file and keeps the target', () => {
  withDirectory(directory => {
    const target = path.join(directory, 'a.json')
    fs.writeFileSync(target, 'old')
    withFsPatch('fsyncSync', () => (() => { throw Object.assign(new Error('EIO'), { code: 'EIO' }) }) as typeof fs.fsyncSync, () => {
      assert.throws(() => writeFileAtomicSync(target, 'new', { temporaryPath: path.join(directory, '.a.tmp'), fsync: true }), { code: 'EIO' })
    })
    assert.deepEqual(fs.readdirSync(directory), ['a.json'])
    assert.equal(fs.readFileSync(target, 'utf8'), 'old')
  })
})

test('mode is applied at creation and re-applied after rename only with enforceMode', { skip: !POSIX_FILE_MODES && 'POSIX modes only' }, () => {
  withDirectory(directory => {
    const previous = process.umask(0o077)
    try {
      const loose = path.join(directory, 'loose')
      writeFileAtomicSync(loose, 'x', { temporaryPath: path.join(directory, '.loose.tmp'), mode: 0o644 })
      assert.equal(fs.statSync(loose).mode & 0o777, 0o600, 'umask masks the creation mode')
      const enforced = path.join(directory, 'enforced')
      writeFileAtomicSync(enforced, 'x', { temporaryPath: path.join(directory, '.enforced.tmp'), mode: 0o644, enforceMode: true })
      assert.equal(fs.statSync(enforced).mode & 0o777, 0o644)
    } finally {
      process.umask(previous)
    }
  })
})

test('a symlinked target is replaced, never written through: symlink policy belongs to the caller', { skip: SKIP_WITHOUT_FILE_SYMLINKS }, () => {
  withDirectory(directory => {
    const real = path.join(directory, 'real')
    const link = path.join(directory, 'link')
    fs.writeFileSync(real, 'real')
    fs.symlinkSync(real, link)
    writeFileAtomicSync(link, 'new', { temporaryPath: path.join(directory, '.link.tmp') })
    assert.equal(fs.lstatSync(link).isSymbolicLink(), false)
    assert.equal(fs.readFileSync(real, 'utf8'), 'real')
  })
})
