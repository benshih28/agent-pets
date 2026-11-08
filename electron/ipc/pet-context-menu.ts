import type { BrowserWindow, IpcMain, IpcMainEvent, MenuItemConstructorOptions } from 'electron'
import { buildPetContextMenuTemplate, type PetContextMenuActions, type PetContextMenuLabels } from '../pet-context-menu.ts'
import { IPC_CHANNELS } from './channels.ts'

export interface PetContextMenuIpcDependencies {
  ipcMain: Pick<IpcMain, 'on'>
  getPetWindow(): BrowserWindow | null
  isTrustedIpcSender(event: IpcMainEvent, requiredWindow?: BrowserWindow | null): boolean
  actions: PetContextMenuActions
  labels(): PetContextMenuLabels
  popup(template: MenuItemConstructorOptions[], window: BrowserWindow): void
}

export function registerPetContextMenuIpc(deps: PetContextMenuIpcDependencies): void {
  // The renderer only asks; what the menu contains and does is decided here.
  deps.ipcMain.on(IPC_CHANNELS.petContextMenu, event => {
    const petWindow = deps.getPetWindow()
    if (!petWindow || !deps.isTrustedIpcSender(event, petWindow)) return
    deps.popup(buildPetContextMenuTemplate(deps.actions, deps.labels()), petWindow)
  })
}
