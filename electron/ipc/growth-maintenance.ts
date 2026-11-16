import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import {
  GROWTH_RESET_TOKEN_TTL_MS,
  type DbMaintenanceResult,
  type GrowthResetArmResult,
  type GrowthResetResult,
} from '../../src/types/growth-maintenance.ts'
import { IPC_CHANNELS } from './channels.ts'
import { handleTrusted } from './trusted.ts'

// 這兩個操作都是破壞性或長時間的，所以：只允許設定面板視窗、固定間隔內只受理一次。
export const GROWTH_RESET_MIN_INTERVAL_MS = 5_000
export const GROWTH_RESET_ARM_MIN_INTERVAL_MS = 1_000
export const DB_MAINTENANCE_MIN_INTERVAL_MS = 10_000

export interface GrowthMaintenanceIpcDependencies {
  ipcMain: Pick<IpcMain, 'handle'>
  assertTrustedIpcSender(event: IpcMainInvokeEvent, requiredWindow?: BrowserWindow | null): void
  getPanelWindow(): BrowserWindow | null
  resetGrowth(): GrowthResetResult
  runDbMaintenance(): Promise<DbMaintenanceResult>
  now?: () => number
  /** 可注入以便測試的 token 產生器；預設 32 bytes 的 crypto 隨機值。 */
  generateToken?: () => string
}

export function registerGrowthMaintenanceIpc(deps: GrowthMaintenanceIpcDependencies): void {
  const now = deps.now ?? (() => Date.now())
  const generateToken = deps.generateToken ?? (() => randomBytes(32).toString('hex'))
  // 只保留最新一個 token；破壞性重設必須先在確認對話框按下確認才會被 arm，
  // 這樣主程序才能分辨「使用者真的確認過」與「任意呼叫 resetGrowth」。
  let armed: { token: Buffer, expiresAt: number } | null = null
  let lastArmAt = Number.NEGATIVE_INFINITY
  let lastResetAt = Number.NEGATIVE_INFINITY
  let lastMaintenanceAt = Number.NEGATIVE_INFINITY

  handleTrusted(deps.ipcMain, IPC_CHANNELS.growthResetArm, deps.getPanelWindow, deps.assertTrustedIpcSender, (): GrowthResetArmResult => {
    const at = now()
    if (at - lastArmAt < GROWTH_RESET_ARM_MIN_INTERVAL_MS) return { ok: false, error: 'rate_limited' }
    lastArmAt = at
    const token = generateToken()
    armed = { token: Buffer.from(token, 'utf8'), expiresAt: at + GROWTH_RESET_TOKEN_TTL_MS }
    return { ok: true, token }
  })

  handleTrusted(deps.ipcMain, IPC_CHANNELS.growthReset, deps.getPanelWindow, deps.assertTrustedIpcSender, (_event, token?: unknown): GrowthResetResult => {
    // 取出即失效：不論之後驗證、頻率限制或重設本身成功與否，同一個 token 都只能用一次。
    const current = armed
    armed = null
    if (!current || typeof token !== 'string') return { ok: false, error: 'invalid_request' }
    const at = now()
    const candidate = Buffer.from(token, 'utf8')
    const matches = candidate.length === current.token.length && timingSafeEqual(candidate, current.token)
    if (!matches || at > current.expiresAt) return { ok: false, error: 'invalid_request' }
    if (at - lastResetAt < GROWTH_RESET_MIN_INTERVAL_MS) return { ok: false, error: 'rate_limited' }
    lastResetAt = at
    return deps.resetGrowth()
  })

  handleTrusted(deps.ipcMain, IPC_CHANNELS.dbMaintenanceRun, deps.getPanelWindow, deps.assertTrustedIpcSender, async (): Promise<DbMaintenanceResult> => {
    const at = now()
    if (at - lastMaintenanceAt < DB_MAINTENANCE_MIN_INTERVAL_MS) return { ok: false, error: 'rate_limited' }
    lastMaintenanceAt = at
    return deps.runDbMaintenance()
  })
}
