import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

function isWithin(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate)
  return relativePath === '' || (!relativePath.startsWith(`..${sep}`) && relativePath !== '..' && !isAbsolute(relativePath))
}

async function regularDirectory(path: string): Promise<void> {
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Expected a regular directory')
}

/** Create a directory one segment at a time and reject symlinks below the trusted root. */
export async function ensureDirectoryWithin(rootPath: string, directoryPath: string): Promise<void> {
  const root = resolve(rootPath)
  const directory = resolve(directoryPath)
  if (!isWithin(root, directory)) throw new Error('Directory escapes its root')

  await mkdir(root, { recursive: true })
  await regularDirectory(root)
  const realRoot = await realpath(root)
  const parts = relative(root, directory).split(sep).filter(Boolean)
  let current = root
  for (const part of parts) {
    current = join(current, part)
    try { await mkdir(current) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    await regularDirectory(current)
    const realCurrent = await realpath(current)
    if (!isWithin(realRoot, realCurrent)) throw new Error('Directory resolves outside its root')
  }
}

/** Write only beneath the validated root and refuse a symlink at the destination. */
export async function writeFileWithin(rootPath: string, filePath: string, contents: string | Uint8Array): Promise<void> {
  const root = resolve(rootPath)
  const target = resolve(filePath)
  if (!isWithin(root, target) || target === root) throw new Error('File escapes its root')
  const parent = dirname(target)
  await ensureDirectoryWithin(root, parent)
  try {
    const existing = await lstat(target)
    if (!existing.isFile() || existing.isSymbolicLink()) throw new Error('Expected a regular file')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  const noFollow = (constants as typeof constants & { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | noFollow
  const handle = await open(target, flags, 0o600)
  try {
    const info = await handle.stat()
    if (!info.isFile()) throw new Error('Expected a regular file')
    await handle.writeFile(typeof contents === 'string' ? contents : Buffer.from(contents))
  } finally {
    await handle.close()
  }
}
