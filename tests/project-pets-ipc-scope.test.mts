import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { IPC_CHANNELS } from '../electron/ipc/channels.ts'

// The Pinia store needs Vue, vue-i18n, the `@/` alias and a renderer
// `window`, so it cannot be loaded under node --test. These source checks
// guard the contract instead: project-pet IPC stays panel-only in main, and
// the pet window's startup path never calls it.

function read(relativePath: string): string {
  return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')
}

function functionBody(source: string, signature: string): string {
  const start = source.indexOf(signature)
  assert.ok(start >= 0, `missing ${signature}`)
  const open = source.indexOf('{', start + signature.length - 1)
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    else if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(open, index + 1)
    }
  }
  throw new Error(`unterminated ${signature}`)
}

test('project-pet IPC handlers only trust the panel window', () => {
  const registrar = read('electron/ipc/project-pets.ts')
  for (const channel of ['project-pets-list', 'project-pets-get-enabled']) {
    const key = Object.entries(IPC_CHANNELS).find(([, value]) => value === channel)?.[0]
    assert.ok(key, `missing ${channel} channel constant`)
    const start = registrar.indexOf(`IPC_CHANNELS.${key}`)
    assert.ok(start >= 0, `missing ${channel} handler`)
    assert.match(registrar, new RegExp(`handleTrusted\\(deps\\.ipcMain, IPC_CHANNELS\\.${key}, deps\\.getPanelWindow, deps\\.assertTrustedIpcSender`), channel)
  }
})

test('loadPets does not reach project-pet IPC, since the pet window calls it', () => {
  const body = functionBody(read('src/stores/agentStore.ts'), 'async function loadPets() {')
  assert.doesNotMatch(body, /refreshProjectPets|ProjectPets/)
})

test('the pet window does not request project-pet data', () => {
  const desktopPet = read('src/components/DesktopPet.vue')
  assert.match(desktopPet, /store\.loadPets\(\)/)
  assert.doesNotMatch(desktopPet, /projectPets|ProjectPets/)
})

test('the panel refreshes project pets wherever it reloads pets', () => {
  const panel = read('src/components/StatusPanel.vue')
  const loads = panel.match(/store\.loadPets\(\)/g)?.length ?? 0
  const refreshes = panel.match(/store\.refreshProjectPets\(\)/g)?.length ?? 0
  assert.ok(loads > 0)
  assert.equal(refreshes, loads)
})
