import assert from 'node:assert/strict'
import test from 'node:test'
import { IPC_CHANNELS } from '../electron/ipc/channels.ts'
import { registerDesktopIpc } from '../electron/ipc/desktop.ts'

test('desktop IPC uses injected stores and keeps mode and preference contracts', async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const trusted: Array<{ event: unknown; requiredWindow: unknown }> = []
  const setModes: string[] = []
  const legacyFlags: boolean[] = []
  const broadcasts: unknown[] = []
  const updates: unknown[] = []
  const panelWindow = { id: 'panel' }
  const preferencesStore = { initializeLegacySound: (enabled: boolean) => { legacyFlags.push(enabled); return { soundEnabled: enabled } } }
  const tray = { rebuild: () => undefined }
  const mode = { mode: 'normal' }

  registerDesktopIpc({
    ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler) },
    assertTrustedIpcSender: (event: unknown, requiredWindow: unknown) => { trusted.push({ event, requiredWindow }) },
    getPanelWindow: () => panelWindow,
    getDesktopPreferences: () => preferencesStore,
    getDesktopTray: () => tray,
    broadcastDesktopPreferences: value => broadcasts.push(value),
    updateDesktopPreferences: patch => { updates.push(patch); return { changed: true } },
    currentPowerSaveState: () => true,
    petModeState: () => mode,
    setPetWindowMode: value => setModes.push(value),
  })
  const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)?.({}, ...args)

  assert.deepEqual([...handlers.keys()], [
    IPC_CHANNELS.petWindowModeSet,
    IPC_CHANNELS.petWindowModeInit,
    IPC_CHANNELS.desktopPreferencesInit,
    IPC_CHANNELS.desktopPreferencesSet,
    IPC_CHANNELS.powerSaveState,
  ])
  assert.equal(await invoke(IPC_CHANNELS.petWindowModeSet, 'unknown'), mode)
  assert.equal(await invoke(IPC_CHANNELS.petWindowModeSet, 'mini'), mode)
  assert.deepEqual(setModes, ['mini'])
  assert.deepEqual(await invoke(IPC_CHANNELS.petWindowModeInit), mode)
  assert.deepEqual(await invoke(IPC_CHANNELS.desktopPreferencesInit, true), { soundEnabled: true })
  assert.deepEqual(legacyFlags, [true])
  assert.deepEqual(broadcasts, [{ soundEnabled: true }])
  assert.deepEqual(await invoke(IPC_CHANNELS.desktopPreferencesSet, { soundEnabled: false }), { changed: true })
  assert.deepEqual(updates, [{ soundEnabled: false }])
  assert.equal(await invoke(IPC_CHANNELS.powerSaveState), true)
  assert.equal(trusted.filter(item => item.requiredWindow === panelWindow).length, 1)
  assert.equal(trusted.length, 6)
})
