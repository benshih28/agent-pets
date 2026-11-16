import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import type { IntegrationTarget } from '../setup'
import { isAgentSource, type AgentSource } from '../../src/types/agent.ts'
import { IPC_CHANNELS } from './channels.ts'

// 每個來源都能送測試事件，清單就是來源 registry。
export type IntegrationTestSource = AgentSource

// 'claude' 是舊版面板送的安裝目標（跟 claudeCode 同義），setup.ts 仍接受，這裡不能拿掉。
const INTEGRATION_TARGETS: ReadonlySet<string> = new Set<IntegrationTarget>(['opencode', 'codex', 'claude', 'claudeCode'])

export function isIntegrationTarget(value: unknown): value is IntegrationTarget {
  return typeof value === 'string' && INTEGRATION_TARGETS.has(value)
}

export interface IntegrationIpcDependencies {
  ipcMain: Pick<IpcMain, 'handle'>
  assertTrustedIpcSender(event: IpcMainInvokeEvent, requiredWindow?: BrowserWindow | null): void
  getPanelWindow(): BrowserWindow | null
  sendIntegrationTestEvent(source: IntegrationTestSource, sessionId: string, state: 'thinking' | 'offline'): Promise<void>
  waitForIntegrationTestReceipt(sessionId: string): Promise<void>
  installIntegration(target?: IntegrationTarget): unknown
  uninstallIntegration(target?: IntegrationTarget | 'all'): unknown
  isIntegrationTarget(value: unknown): value is IntegrationTarget
  /** 等 agent 設定目錄解析完成（login shell 查詢）才改寫設定檔，避免先寫到預設位置。 */
  agentConfigReady?(): Promise<void>
}

export function registerIntegrationIpc(deps: IntegrationIpcDependencies): void {
  deps.ipcMain.handle(IPC_CHANNELS.testIntegration, async (event, source: unknown) => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    if (!isAgentSource(source)) {
      return { ok: false, error: 'Unsupported integration source' }
    }

    const sessionId = `agent-pets-test-${source}-${Date.now()}`
    try {
      const receipt = deps.waitForIntegrationTestReceipt(sessionId)
      await Promise.all([
        deps.sendIntegrationTestEvent(source, sessionId, 'thinking'),
        receipt,
      ])
      setTimeout(() => {
        void deps.sendIntegrationTestEvent(source, sessionId, 'offline').catch(() => {})
      }, 2_500)
      return { ok: true, verifiedAt: Date.now() }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  deps.ipcMain.handle(IPC_CHANNELS.installIntegrations, async (event, target?: unknown) => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    if (target !== undefined && !deps.isIntegrationTarget(target)) {
      return { ok: false, error: 'Unsupported integration target' }
    }
    try {
      await deps.agentConfigReady?.()
      await deps.installIntegration(target as IntegrationTarget | undefined)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  deps.ipcMain.handle(IPC_CHANNELS.uninstallIntegrations, async (event, target?: unknown) => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    // 'all' also removes tokens and bridge scripts (full cleanup before removing the app).
    if (target !== undefined && target !== 'all' && !deps.isIntegrationTarget(target)) {
      return { ok: false, error: 'Unsupported integration target' }
    }
    try {
      await deps.agentConfigReady?.()
      await deps.uninstallIntegration(target as IntegrationTarget | 'all' | undefined)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
}
