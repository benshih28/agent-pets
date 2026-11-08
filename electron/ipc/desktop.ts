import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import type { DesktopPreferencesStore } from '../desktop-preferences'
import type { DesktopTrayController } from '../desktop-tray'
import type { DesktopPreferences } from '../../src/types/desktop'
import type { PetWindowMode, PetWindowModeState } from '../../src/types/pet-window'
import { IPC_CHANNELS } from './channels.ts'

export interface DesktopIpcDependencies {
  ipcMain: Pick<IpcMain, 'handle'>
  assertTrustedIpcSender(event: IpcMainInvokeEvent, requiredWindow?: BrowserWindow | null): void
  getPanelWindow(): BrowserWindow | null
  getDesktopPreferences(): DesktopPreferencesStore | null
  getDesktopTray(): DesktopTrayController | null
  broadcastDesktopPreferences(preferences: DesktopPreferences): void
  updateDesktopPreferences(patch: unknown): DesktopPreferences
  currentPowerSaveState(): boolean
  petModeState(): PetWindowModeState
  setPetWindowMode(mode: PetWindowMode): void
  /** Opens the fixed macOS Login Items settings pane. Returns false when unavailable. */
  openLoginItemsSettings(): Promise<boolean>
}

export function registerDesktopIpc(deps: DesktopIpcDependencies): void {
  deps.ipcMain.handle(IPC_CHANNELS.petWindowModeSet, (event, mode: unknown) => {
    deps.assertTrustedIpcSender(event)
    if (mode !== 'normal' && mode !== 'mini') return deps.petModeState()
    deps.setPetWindowMode(mode)
    return deps.petModeState()
  })

  deps.ipcMain.handle(IPC_CHANNELS.petWindowModeInit, (event) => {
    deps.assertTrustedIpcSender(event)
    return deps.petModeState()
  })

  deps.ipcMain.handle(IPC_CHANNELS.desktopPreferencesInit, (event, legacySoundEnabled?: unknown) => {
    deps.assertTrustedIpcSender(event)
    const preferencesStore = deps.getDesktopPreferences()
    if (!preferencesStore) throw new Error('Desktop preferences are not ready')
    const preferences = preferencesStore.initializeLegacySound(legacySoundEnabled === true)
    deps.getDesktopTray()?.rebuild()
    deps.broadcastDesktopPreferences(preferences)
    return preferences
  })

  deps.ipcMain.handle(IPC_CHANNELS.desktopPreferencesSet, (event, patch: unknown) => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    return deps.updateDesktopPreferences(patch)
  })

  // No payload: the target URL is a constant in main, so the renderer cannot
  // steer shell.openExternal.
  deps.ipcMain.handle(IPC_CHANNELS.desktopOpenLoginItemsSettings, async (event) => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    return deps.openLoginItemsSettings()
  })

  deps.ipcMain.handle(IPC_CHANNELS.powerSaveState, (event) => {
    deps.assertTrustedIpcSender(event)
    return deps.currentPowerSaveState()
  })
}
