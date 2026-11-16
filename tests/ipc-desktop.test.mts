import assert from 'node:assert/strict'
import test from 'node:test'
import { IPC_CHANNELS } from '../electron/ipc/channels.ts'
import { registerDesktopIpc } from '../electron/ipc/desktop.ts'
import type { DesktopPreferencesStore } from '../electron/desktop-preferences.ts'
import type { DesktopTrayController } from '../electron/desktop-tray.ts'
import type { DesktopPreferences } from '../src/types/desktop.ts'
import type { PetWindowModeState } from '../src/types/pet-window.ts'
import { UNSUPPORTED_DESKTOP_VISIBILITY_CAPABILITIES } from '../src/types/desktop-visibility.ts'
import { SOUND_DEFAULTS } from '../src/types/sound.ts'
import { fakeBrowserWindow, fakeIpcMainInvokeEvent } from './support/fake-electron.mts'
import { fakeService } from './support/fake-service.mts'
import { createFakeIpcMain } from './support/fake-ipc.mts'

const basePreferences: DesktopPreferences = {
  dndEnabled: false,
  dndUntil: null,
  notificationsEnabled: true,
  permissionBubbleEnabled: true,
  claudePermissionRespondEnabled: false,
  claudePermissionWaitSeconds: 30,
  presentationMcpEnabled: true,
  achievementsEnabled: true,
  edgeModeEnabled: false,
  shimejiEnabled: false,
  captureExclusionEnabled: false,
  fullscreenAutoHideEnabled: false,
  rightClickHideEnabled: false,
  completionMarkersEnabled: true,
  sessionJumpEnabled: true,
  sessionJumpSwitchAppEnabled: true,
  ...SOUND_DEFAULTS,
  launchAtStartup: false,
  launchAtStartupSupported: false,
  launchAtStartupStatus: 'unsupported',
  locale: 'zh-TW',
  visibilityCapabilities: UNSUPPORTED_DESKTOP_VISIBILITY_CAPABILITIES,
}

test('desktop IPC uses injected stores and keeps mode and preference contracts', async () => {
  const { ipcMain, handlers } = createFakeIpcMain()
  const trusted: Array<{ event: unknown; requiredWindow: unknown }> = []
  const setModes: string[] = []
  const legacyFlags: boolean[] = []
  const broadcasts: unknown[] = []
  const updates: unknown[] = []
  const panelWindow = fakeBrowserWindow()
  // store 與 tray 的完整實作會牽動檔案系統與 Electron Tray；受測的 IPC 層只呼叫下面這兩個方法。
  const preferencesStore = { initializeLegacySound: (enabled: boolean): DesktopPreferences => { legacyFlags.push(enabled); return { ...basePreferences, soundEnabled: enabled } } } satisfies Pick<DesktopPreferencesStore, 'initializeLegacySound'>
  const tray = { rebuild: () => undefined } satisfies Pick<DesktopTrayController, 'rebuild'>
  const updatedPreferences: DesktopPreferences = { ...basePreferences, soundEnabled: false }
  const mode: PetWindowModeState = { mode: 'normal' }
  const opened: string[] = []

  registerDesktopIpc({
    ipcMain,
    assertTrustedIpcSender: (event: unknown, requiredWindow: unknown) => { trusted.push({ event, requiredWindow }) },
    getPanelWindow: () => panelWindow,
    getDesktopPreferences: () => fakeService<DesktopPreferencesStore>(preferencesStore),
    getDesktopTray: () => fakeService<DesktopTrayController>(tray),
    broadcastDesktopPreferences: value => broadcasts.push(value),
    updateDesktopPreferences: patch => { updates.push(patch); return updatedPreferences },
    currentPowerSaveState: () => true,
    petModeState: () => mode,
    setPetWindowMode: value => setModes.push(value),
    openLoginItemsSettings: async () => { opened.push('x'); return true },
  })
  const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)?.(fakeIpcMainInvokeEvent(), ...args)

  assert.deepEqual([...handlers.keys()], [
    IPC_CHANNELS.petWindowModeSet,
    IPC_CHANNELS.petWindowModeInit,
    IPC_CHANNELS.desktopPreferencesInit,
    IPC_CHANNELS.desktopPreferencesSet,
    IPC_CHANNELS.desktopOpenLoginItemsSettings,
    IPC_CHANNELS.powerSaveState,
  ])
  assert.equal(await invoke(IPC_CHANNELS.petWindowModeSet, 'unknown'), mode)
  assert.equal(await invoke(IPC_CHANNELS.petWindowModeSet, 'mini'), mode)
  assert.deepEqual(setModes, ['mini'])
  assert.deepEqual(await invoke(IPC_CHANNELS.petWindowModeInit), mode)
  assert.deepEqual(await invoke(IPC_CHANNELS.desktopPreferencesInit, true), { ...basePreferences, soundEnabled: true })
  assert.deepEqual(legacyFlags, [true])
  assert.deepEqual(broadcasts, [{ ...basePreferences, soundEnabled: true }])
  assert.deepEqual(await invoke(IPC_CHANNELS.desktopPreferencesSet, { soundEnabled: false }), updatedPreferences)
  assert.deepEqual(updates, [{ soundEnabled: false }])
  assert.equal(await invoke(IPC_CHANNELS.desktopOpenLoginItemsSettings, 'https://evil.example'), true)
  assert.deepEqual(opened, ['x'])
  assert.equal(await invoke(IPC_CHANNELS.powerSaveState), true)
  assert.equal(trusted.filter(item => item.requiredWindow === panelWindow).length, 2)
  assert.equal(trusted.length, 7)
})
