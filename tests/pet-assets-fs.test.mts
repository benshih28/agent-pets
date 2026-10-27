import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureDirectoryWithin, writeFileWithin } from '../electron/ipc/pet-assets-fs.ts'

test('pet asset directory and file writes reject symlinks and escape paths', async t => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'agent-pets-pet-assets-'))
  t.after(async () => rm(temporaryRoot, { recursive: true, force: true }))
  const root = join(temporaryRoot, 'custom-pets')
  const outside = join(temporaryRoot, 'outside')
  await mkdir(outside)

  try {
    await symlink(outside, root)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EPERM' || code === 'EACCES' || code === 'ENOSYS') {
      t.skip('The current platform does not permit creating symlinks for this test')
      return
    }
    throw error
  }

  await assert.rejects(ensureDirectoryWithin(root, join(root, 'custom', 'pet')))
  await rm(root)

  const regularRoot = join(temporaryRoot, 'regular-root')
  const linkedDirectory = join(regularRoot, 'custom')
  await mkdir(regularRoot)
  await symlink(outside, linkedDirectory)
  await assert.rejects(ensureDirectoryWithin(regularRoot, join(linkedDirectory, 'pet')))

  const allowedRoot = join(temporaryRoot, 'allowed-root')
  await ensureDirectoryWithin(allowedRoot, allowedRoot)
  const protectedFile = join(outside, 'pet.json')
  await writeFile(protectedFile, 'preserved')
  const linkedFile = join(allowedRoot, 'pet.json')
  await symlink(protectedFile, linkedFile)
  await assert.rejects(writeFileWithin(allowedRoot, linkedFile, 'overwrite'))
  assert.equal(await readFile(protectedFile, 'utf8'), 'preserved')

  await assert.rejects(ensureDirectoryWithin(allowedRoot, temporaryRoot))
  await assert.rejects(writeFileWithin(allowedRoot, join(temporaryRoot, 'escape.txt'), 'escape'))
})
