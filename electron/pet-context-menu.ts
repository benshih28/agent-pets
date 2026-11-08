import type { MenuItemConstructorOptions } from 'electron'
import type { PetWindowMode } from '../src/types/pet-window'

export interface PetContextMenuActions {
  isDndEnabled(): boolean
  setDnd(enabled: boolean): void
  getPetMode(): PetWindowMode
  toggleMiniMode(): void
  openPanel(): void
  openSettings(): void
  hidePet(): void
  quit(): void
}

export interface PetContextMenuLabels {
  dnd: string
  miniMode: string
  openPanel: string
  openSettings: string
  hidePet: string
  quit: string
}

/** The pet's right-click menu; kept free of Electron runtime so it is testable. */
export function buildPetContextMenuTemplate(
  actions: PetContextMenuActions,
  labels: PetContextMenuLabels,
): MenuItemConstructorOptions[] {
  return [
    { label: labels.openPanel, click: () => actions.openPanel() },
    { label: labels.openSettings, click: () => actions.openSettings() },
    { type: 'separator' },
    {
      label: labels.dnd,
      type: 'checkbox',
      checked: actions.isDndEnabled(),
      click: item => actions.setDnd(item.checked),
    },
    {
      label: labels.miniMode,
      type: 'checkbox',
      checked: actions.getPetMode() === 'mini',
      click: () => actions.toggleMiniMode(),
    },
    { type: 'separator' },
    { label: labels.hidePet, click: () => actions.hidePet() },
    { label: labels.quit, click: () => actions.quit() },
  ]
}
