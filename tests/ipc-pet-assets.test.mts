import assert from 'node:assert/strict'
import test from 'node:test'
import { IPC_CHANNELS } from '../electron/ipc/channels.ts'
import { registerPetAssetIpc, type PetAssetIpcDependencies } from '../electron/ipc/pet-assets.ts'

test('pet asset IPC uses injected paths, archive helpers, and renderer sender checks', async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const trusted: Array<unknown> = []
  const createdDirectories: string[] = []
  const writtenFiles: Array<{ path: string; contents: string }> = []
  const removedDirectories: string[] = []
  const panelWindow = { isDestroyed: () => false }
  const fakeFs = {
    lstat: async (path: string) => ({
      isFile: () => !path.endsWith('/custom/safe-pet'),
      isDirectory: () => path.endsWith('/custom/safe-pet'),
      isSymbolicLink: () => false,
      size: 10,
    }),
    readFile: async () => '{"id":"safe-pet"}',
    writeFile: async () => undefined,
    rm: async (path: string) => { removedDirectories.push(path) },
  }
  const deps: PetAssetIpcDependencies = {
    ipcMain: { handle: (channel, handler) => { handlers.set(channel, handler) } },
    assertTrustedIpcSender: (event, window) => trusted.push({ event, window }),
    getPanelWindow: () => panelWindow,
    getPetWindow: () => null,
    setDialogOpen: () => undefined,
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    customPetsRoot: () => 'test-pets-root',
    safeJoin: (base, ...parts) => base.includes('..') || parts.some(part => part.includes('..'))
      ? null
      : [base, ...parts].join('/'),
    sanitizePetId: value => /^[a-z0-9-]{1,64}$/.test(value) ? value : null,
    ensureDir: path => createdDirectories.push(path),
    writeFileEnsured: (path, contents) => writtenFiles.push({ path, contents }),
    parsePetBehaviorManifest: () => undefined,
    isSupportedRasterImage: () => false,
    guardArchive: () => ({ ok: false, error: 'invalid_archive' }),
    fs: fakeFs as never,
    path: {
      basename: value => value.split('/').at(-1) ?? '',
      join: (...parts) => parts.join('/'),
    },
    customPetDescription: () => 'Custom pet',
    maxPetZipBytes: 10,
    maxPetZipEntries: 10,
    maxPetUncompressedBytes: 10,
    maxPetJsonBytes: 10,
    maxPetImageBytes: 10,
  }

  registerPetAssetIpc(deps)
  const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)?.({}, ...args)
  assert.deepEqual([...handlers.keys()], [
    IPC_CHANNELS.addCustomPet,
    IPC_CHANNELS.renameCustomPet,
    IPC_CHANNELS.removeCustomPet,
    IPC_CHANNELS.getCustomPetSprite,
    IPC_CHANNELS.importPetZip,
    IPC_CHANNELS.importPetSprite,
  ])

  assert.equal(await invoke(IPC_CHANNELS.addCustomPet, { id: '../escape' }), false)
  assert.equal(await invoke(IPC_CHANNELS.addCustomPet, { id: 'safe-pet', displayName: 'Sample' }), true)
  assert.deepEqual(createdDirectories, ['test-pets-root/custom/safe-pet'])
  assert.deepEqual(writtenFiles, [{
    path: 'test-pets-root/custom/safe-pet/pet.json',
    contents: JSON.stringify({
      id: 'safe-pet',
      displayName: 'Sample',
      description: 'Custom pet',
      spritesheetPath: 'spritesheet.webp',
      spriteVersionNumber: 2,
      kind: 'person',
    }, null, 2),
  }])
  assert.equal(await invoke(IPC_CHANNELS.getCustomPetSprite, 'safe-pet'), 'agent-pets://custom/safe-pet/spritesheet.webp')
  assert.equal(await invoke(IPC_CHANNELS.removeCustomPet, 'safe-pet'), true)
  assert.deepEqual(removedDirectories, ['test-pets-root/custom/safe-pet'])
  assert.ok(trusted.every(entry => (entry as { window?: unknown }).window === panelWindow || (entry as { window?: unknown }).window === undefined))
})
