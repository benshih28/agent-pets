import assert from 'node:assert/strict'
import test from 'node:test'
import { IPC_CHANNELS } from '../electron/ipc/channels.ts'
import { registerPetContextMenuIpc } from '../electron/ipc/pet-context-menu.ts'
import { buildPetContextMenuTemplate } from '../electron/pet-context-menu.ts'
import { fakeBrowserWindow, fakeIpcMainEvent } from './support/fake-electron.mts'
import { createFakeIpcMain } from './support/fake-ipc.mts'

const labels = { dnd: 'DND', miniMode: 'Mini', openPanel: 'Panel', openSettings: 'Settings', hidePet: 'Hide', quit: 'Quit' }

function fixture(mode: 'normal' | 'mini' = 'normal') {
  const calls: string[] = []
  const actions = {
    isDndEnabled: () => true,
    setDnd: (value: boolean) => calls.push(`dnd:${value}`),
    getPetMode: () => mode,
    toggleMiniMode: () => calls.push('mini'),
    openPanel: () => calls.push('panel'),
    openSettings: () => calls.push('settings'),
    hidePet: () => calls.push('hide'),
    quit: () => calls.push('quit'),
  }
  return { calls, actions }
}

test('menu reflects DND and mini state and routes every action', () => {
  const { calls, actions } = fixture('mini')
  const template = buildPetContextMenuTemplate(actions, labels)
  const byLabel = new Map(template.filter(item => item.label).map(item => [item.label, item]))
  assert.equal(byLabel.get('DND')?.checked, true)
  assert.equal(byLabel.get('Mini')?.checked, true)
  for (const label of ['Panel', 'Settings', 'Mini', 'Hide', 'Quit']) (byLabel.get(label)?.click as () => void)()
  ;(byLabel.get('DND')?.click as (item: { checked: boolean }) => void)({ checked: false })
  assert.deepEqual(calls, ['panel', 'settings', 'mini', 'hide', 'quit', 'dnd:false'])
})

test('only the trusted pet window can open the menu', () => {
  const { actions } = fixture()
  const { ipcMain, listeners } = createFakeIpcMain()
  const popups: unknown[] = []
  const petWindow = fakeBrowserWindow()
  const petEvent = fakeIpcMainEvent()
  registerPetContextMenuIpc({
    ipcMain,
    getPetWindow: () => petWindow,
    isTrustedIpcSender: event => event === petEvent,
    actions,
    labels: () => labels,
    popup: (template, window) => popups.push({ size: template.length, window }),
  })
  listeners.get(IPC_CHANNELS.petContextMenu)?.(fakeIpcMainEvent())
  assert.equal(popups.length, 0)
  listeners.get(IPC_CHANNELS.petContextMenu)?.(petEvent)
  assert.equal(popups.length, 1)
})
