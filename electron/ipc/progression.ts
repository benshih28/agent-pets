import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import type { AchievementStore } from '../achievements'
import type { ProgressionStore } from '../progression'
import type { AchievementSnapshot } from '../../src/types/achievement'
import type { ProgressionSnapshot } from '../../src/types/progression'
import { IPC_CHANNELS } from './channels.ts'

export interface ProgressionIpcDependencies {
  ipcMain: Pick<IpcMain, 'handle'>
  assertTrustedIpcSender(event: IpcMainInvokeEvent, requiredWindow?: BrowserWindow | null): void
  isProgressionPetId(value: unknown): value is string
  setActiveProgressionPet(petId: string): ProgressionSnapshot | null
  getProgressionStore(): ProgressionStore | null
  getAchievementStore(): AchievementStore | null
}

export function registerProgressionIpc(deps: ProgressionIpcDependencies): void {
  deps.ipcMain.handle(IPC_CHANNELS.progressionInit, (event, petId?: unknown) => {
    deps.assertTrustedIpcSender(event)
    if (petId !== undefined && !deps.isProgressionPetId(petId)) return null
    return deps.setActiveProgressionPet(typeof petId === 'string' ? petId : 'aang-airbender')
  })

  deps.ipcMain.handle(IPC_CHANNELS.progressionSetPet, (event, petId: unknown) => {
    deps.assertTrustedIpcSender(event)
    if (!deps.isProgressionPetId(petId)) return null
    return deps.setActiveProgressionPet(petId)
  })

  deps.ipcMain.handle(IPC_CHANNELS.achievementsInit, (event, petId?: unknown): AchievementSnapshot | null => {
    deps.assertTrustedIpcSender(event)
    const achievementStore = deps.getAchievementStore()
    if (!achievementStore) return null
    const selectedPet = petId === undefined
      ? deps.getProgressionStore()?.getActivePetId() ?? 'aang-airbender'
      : deps.isProgressionPetId(petId) ? petId : null
    return selectedPet ? achievementStore.getSnapshot(selectedPet) : null
  })
}
