import assert from 'node:assert/strict'
import test from 'node:test'
import { createNodeResolver, parseNodeMajor, type NodeResolverDeps } from '../electron/node-resolver.ts'

function deps(overrides: Partial<NodeResolverDeps> & { files?: Set<string> } = {}): NodeResolverDeps & { calls: string[] } {
  const files = overrides.files ?? new Set<string>()
  const calls: string[] = []
  let clock = 0
  return {
    platform: 'darwin',
    env: { SHELL: '/bin/zsh' },
    exists: target => files.has(target),
    runSync: (file, args) => { calls.push(`sync:${file} ${args.join(' ')}`); throw new Error('no shell') },
    run: async (file, args) => { calls.push(`async:${file} ${args.join(' ')}`); throw new Error('no shell') },
    now: () => clock++,
    calls,
    ...overrides,
  }
}

test('prefers a non-interactive login shell, then falls back to the interactive one', async () => {
  const files = new Set(['/home/u/.nvm/node'])
  const d = deps({
    files,
    run: async (file, args) => {
      if (args[0] === '--version') return 'v22.1.0\n'
      if (args[0] === '-ilc') return 'noise from rc file\n/home/u/.nvm/node\n'
      throw new Error('login shell failed')
    },
  })
  const info = await createNodeResolver(d).resolve()
  assert.deepEqual(info, { path: '/home/u/.nvm/node', version: 'v22.1.0', supported: true })
})

test('returns null instead of a bare "node" when nothing is found', async () => {
  const resolver = createNodeResolver(deps())
  assert.equal(await resolver.resolve(), null)
  assert.equal(resolver.resolveSync(), null)
})

test('flags unsupported versions and revalidates a removed binary', async () => {
  const files = new Set(['/opt/homebrew/bin/node'])
  const d = deps({ files, run: async (_file, args) => { if (args[0] === '--version') return 'v16.0.0'; throw new Error('x') } })
  const resolver = createNodeResolver(d)
  const info = await resolver.resolve()
  assert.equal(info?.supported, false)
  assert.equal(resolver.peek()?.path, '/opt/homebrew/bin/node')
  files.delete('/opt/homebrew/bin/node')
  assert.equal(resolver.peek(), null, 'cache is dropped when the file disappears (nvm switch / uninstall)')
})

test('windows uses where.exe and standard locations', async () => {
  const files = new Set(['C:\\Program Files\\nodejs\\node.exe'])
  const d = deps({
    platform: 'win32',
    env: { ProgramFiles: 'C:\\Program Files' },
    files,
    run: async (file) => { if (file.endsWith('where.exe')) throw new Error('missing'); return 'v20.0.0' },
  })
  const info = await createNodeResolver(d).resolve()
  assert.ok(info?.path.includes('nodejs'))
})

test('windows runs where.exe from the system directory and ignores cwd/downloads candidates', async () => {
  const calls: Array<{ file: string, cwd?: string }> = []
  const files = new Set([
    'C:\\Work\\evil\\node.exe',
    'C:\\Users\\u\\Downloads\\app\\node.exe',
    'D:\\tools\\node\\node.exe',
  ])
  const d = deps({
    platform: 'win32',
    env: { SystemRoot: 'C:\\Windows' },
    files,
    cwd: () => 'C:\\Work\\evil',
    run: async (file, args, _timeout, cwd) => {
      if (args[0] === '--version') return 'v22.0.0'
      calls.push({ file, cwd })
      return 'C:\\Work\\evil\\node.exe\r\nC:\\Users\\u\\Downloads\\app\\node.exe\r\nD:\\tools\\node\\node.exe\r\n'
    },
  })
  const info = await createNodeResolver(d).resolve()
  assert.equal(info?.path, 'D:\\tools\\node\\node.exe')
  assert.deepEqual(calls, [{ file: 'C:\\Windows\\System32\\where.exe', cwd: 'C:\\Windows\\System32' }])
})

test('parseNodeMajor', () => {
  assert.equal(parseNodeMajor('v22.3.1'), 22)
  assert.equal(parseNodeMajor(null), null)
  assert.equal(parseNodeMajor('garbage'), null)
})
