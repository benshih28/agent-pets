import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import type { IntegrationTarget } from '../setup'
import { IPC_CHANNELS } from './channels.ts'

const INTEGRATION_TEST_SOURCES = [
  'opencode-cli',
  'opencode-desktop',
  'codex',
  'codex-desktop',
  'claude',
  'claude-desktop',
] as const

export type IntegrationTestSource = typeof INTEGRATION_TEST_SOURCES[number]

export function isIntegrationTarget(value: unknown): value is IntegrationTarget {
  return value === 'opencode' || value === 'codex' || value === 'claude' || value === 'claudeCode'
}

export interface IntegrationIpcDependencies {
  ipcMain: Pick<IpcMain, 'handle'>
  assertTrustedIpcSender(event: IpcMainInvokeEvent, requiredWindow?: BrowserWindow | null): void
  getPanelWindow(): BrowserWindow | null
  sendIntegrationTestEvent(source: IntegrationTestSource, sessionId: string, state: 'thinking' | 'offline'): Promise<void>
  waitForIntegrationTestReceipt(sessionId: string): Promise<void>
  installIntegration(target?: IntegrationTarget): void
  uninstallIntegration(target?: IntegrationTarget): void
  isIntegrationTarget(value: unknown): value is IntegrationTarget
}

export function registerIntegrationIpc(deps: IntegrationIpcDependencies): void {
  deps.ipcMain.handle(IPC_CHANNELS.testIntegration, async (event, source: unknown) => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    if (typeof source !== 'string' || !INTEGRATION_TEST_SOURCES.includes(source as IntegrationTestSource)) {
      return { ok: false, error: 'Unsupported integration source' }
    }

    const sessionId = `agent-pets-test-${source}-${Date.now()}`
    try {
      const receipt = deps.waitForIntegrationTestReceipt(sessionId)
      await Promise.all([
        deps.sendIntegrationTestEvent(source as IntegrationTestSource, sessionId, 'thinking'),
        receipt,
      ])
      setTimeout(() => {
        void deps.sendIntegrationTestEvent(source as IntegrationTestSource, sessionId, 'offline').catch(() => {})
      }, 2_500)
      return { ok: true, verifiedAt: Date.now() }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  deps.ipcMain.handle(IPC_CHANNELS.installIntegrations, (event, target?: unknown) => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    if (target !== undefined && !deps.isIntegrationTarget(target)) {
      return { ok: false, error: 'Unsupported integration target' }
    }
    try {
      deps.installIntegration(target as IntegrationTarget | undefined)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  deps.ipcMain.handle(IPC_CHANNELS.uninstallIntegrations, (event, target?: unknown) => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    if (target !== undefined && !deps.isIntegrationTarget(target)) {
      return { ok: false, error: 'Unsupported integration target' }
    }
    try {
      deps.uninstallIntegration(target as IntegrationTarget | undefined)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
}
