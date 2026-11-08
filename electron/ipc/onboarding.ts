import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { OnboardingStore } from '../onboarding-state.ts'
import { isOnboardingAction, type OnboardingState } from '../../src/types/onboarding.ts'
import { IPC_CHANNELS } from './channels.ts'

export interface OnboardingIpcDependencies {
  ipcMain: Pick<IpcMain, 'handle'>
  assertTrustedIpcSender(event: IpcMainInvokeEvent): void
  getStore(): OnboardingStore | null
}

export function registerOnboardingIpc(deps: OnboardingIpcDependencies): void {
  deps.ipcMain.handle(IPC_CHANNELS.onboardingGet, (event): OnboardingState | null => {
    deps.assertTrustedIpcSender(event)
    return deps.getStore()?.get() ?? null
  })

  deps.ipcMain.handle(IPC_CHANNELS.onboardingUpdate, (event, action: unknown): OnboardingState | null => {
    deps.assertTrustedIpcSender(event)
    if (!isOnboardingAction(action)) return null
    try {
      return deps.getStore()?.update(action) ?? null
    } catch {
      return null
    }
  })
}
