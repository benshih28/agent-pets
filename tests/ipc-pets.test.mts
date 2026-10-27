import assert from 'node:assert/strict'
import test from 'node:test'
import { loadPets, registerPetsIpc, type PetLoadItem, type PetsIpcDependencies } from '../electron/ipc/pets.ts'

function makeDeps(): { deps: PetsIpcDependencies; files: Map<string, string> } {
  const files = new Map<string, string>([
    ['/pets.json', JSON.stringify([{ id: 'built-in', displayName: 'Built in' }])],
    ['/deploy/custom/custom-one/pet.json', JSON.stringify({ id: 'custom-one', displayName: 'Custom one' })],
  ])
  const contexts = new Map([
    ['skin-plugin', {
      enabled: true,
      manifest: {
        name: { 'zh-TW': '插件', 'en-US': 'Plugin' },
        contributes: {
          skins: [{
            id: 'blue-cat',
            displayName: { 'zh-TW': '藍貓', 'en-US': 'Blue Cat' },
            spritesheet: 'skins/blue cat.png',
            kind: 'animal' as const,
          }],
        },
      },
    }],
  ])
  const deps: PetsIpcDependencies = {
    ipcMain: { handle: () => undefined } as PetsIpcDependencies['ipcMain'],
    assertTrustedIpcSender: event => { assert.equal(event, 'trusted') },
    fs: {
      readFile: async (filePath: string) => {
        const value = files.get(filePath)
        if (value === undefined) throw new Error('missing file')
        return value
      },
      lstat: async filePath => {
        if (filePath === '/deploy/custom') return { isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false }
        if (files.has(filePath)) return { isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false }
        throw new Error('missing file')
      },
      readdir: async () => [{ name: 'custom-one', isDirectory: () => true }, { name: '../escape', isDirectory: () => true }],
    } as unknown as PetsIpcDependencies['fs'],
    path: { resolve: (...parts: string[]) => parts.join('/') } as PetsIpcDependencies['path'],
    builtinPetsPath: () => '/pets.json',
    customPetsPath: () => '/deploy',
    parseBehaviorManifest: () => undefined,
    sanitizePetId: value => /^[a-z-]+$/.test(value) ? value : null,
    safeJoin: (base, ...parts) => `${base}/${parts.join('/')}`,
    pluginsEnabled: () => true,
    pluginContexts: () => contexts,
    enabledPluginRoot: pluginId => pluginId === 'skin-plugin' ? '/plugin-root' : null,
    createPluginSkinPetId: (pluginId, skinId) => `plugin-skin:${pluginId}:${skinId}`,
    readRegularFileWithin: () => new Uint8Array([1, 2, 3]),
    rasterContentType: () => 'image/png',
    pluginSkinImageMaxBytes: 100,
    locale: () => 'en-US',
    pluginVersion: () => '1.2.3',
  }
  return { deps, files }
}

test('loadPets combines built-in, safe custom, and enabled plugin skins', async () => {
  const { deps } = makeDeps()
  const pets = await loadPets(deps)
  assert.deepEqual(pets.map(pet => pet.id), [
    'built-in',
    'custom-one',
    'plugin-skin:skin-plugin:blue-cat',
  ])
  assert.deepEqual(pets[2]?.pluginSkin, {
    pluginId: 'skin-plugin',
    pluginName: 'Plugin',
    spriteUrl: 'agent-pets://plugin/skin-plugin/skins/blue%20cat.png',
    cacheKey: 'skin-plugin:1.2.3:skins/blue cat.png',
    kind: 'animal',
  })
})

test('loadPets skips plugin skins without a readable supported image or enabled root', async () => {
  const { deps } = makeDeps()
  const pets = await loadPets({
    ...deps,
    readRegularFileWithin: () => null,
  })
  assert.deepEqual(pets.map(pet => pet.id), ['built-in', 'custom-one'])
})

test('pets IPC checks the trusted sender before reading pet data', async () => {
  const { deps } = makeDeps()
  let senderChecked = false
  let invoke = async (_event: unknown): Promise<unknown> => null
  const ipcMain = {
    handle: (_channel: string, callback: (event: unknown) => unknown) => { invoke = async event => await callback(event) },
  } as unknown as PetsIpcDependencies['ipcMain']
  registerPetsIpc({ ...deps, ipcMain, assertTrustedIpcSender: event => { senderChecked = event === 'trusted' } })
  const result = await invoke('trusted') as PetLoadItem[]
  assert.equal(senderChecked, true)
  assert.deepEqual(result.map(pet => pet.id), ['built-in', 'custom-one', 'plugin-skin:skin-plugin:blue-cat'])
})
