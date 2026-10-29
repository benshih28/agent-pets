import type { BrowserWindow, IpcMain, IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron'
import type { PluginPanelResult, PluginPanelSnapshot } from '../../src/types/plugin'
import { pluginPanelViewInsets, type PluginPanelInsets, type PluginPanelRect, type PluginPanelSize } from '../plugin-panel-window.ts'
import { handleWithSenderGuard, onWithSenderGuard } from './trusted.ts'
import { IPC_CHANNELS } from './channels.ts'

const MAX_VIEWPORT_SIZE = 16_384

type PanelBounds = { x: number; y: number; width: number; height: number }
type PanelWindowPort = Pick<BrowserWindow, 'isDestroyed' | 'isVisible' | 'getContentBounds'>
type PanelViewControllerPort = {
  onPanelWindowHidden(): void
  close(reason: 'closed' | 'renderer_unavailable', openToken?: number): void
  setLayout(openToken: number, insets: PluginPanelInsets, windowSize: PluginPanelSize): boolean
  handleApiRequest(sender: WebContents, method: unknown, args: unknown): unknown
}
type PluginPanelContextPort = {
  pluginsEnabled: boolean
  enabled: boolean
  manifest: { contributes: { panelView?: unknown } }
}

export interface PluginPanelUiIpcDependencies {
  ipcMain: Pick<IpcMain, 'handle' | 'on'>
  assertPluginPanelSender(event: IpcMainInvokeEvent | IpcMainEvent): void
  isTrustedIpcSender(event: IpcMainInvokeEvent | IpcMainEvent, requiredWindow?: BrowserWindow | null): boolean
  isPluginPanelPluginId(value: unknown): value is string
  getPluginPanelSnapshot(): PluginPanelResult<PluginPanelSnapshot> | Promise<PluginPanelResult<PluginPanelSnapshot>>
  invokePluginCommand(pluginId: unknown, commandId: unknown): unknown
  openSequence: { value: number }
  openPluginPanelView(pluginId: string, openToken: number, frame: unknown, content: unknown): Promise<unknown>
  getPetWindow(): BrowserWindow | null
  getPluginPanelContext(pluginId: string): PluginPanelContextPort | null
  enabledPluginRoot(pluginId: string): string | null
  showPanelWindow(view: 'settings', pluginViewPluginId: string): void
  getPanelWindow(): PanelWindowPort | null
  getPluginPanelViewController(): PanelViewControllerPort | null
  finiteNumber(value: unknown): number | null
  readPluginPanelRect(value: unknown): PluginPanelRect | null
  validateBounds(
    frame: PanelBounds,
    content: PanelBounds,
    size: { width: number; height: number },
  ): PluginPanelRect | null
}

export function registerPluginPanelUiIpc(deps: PluginPanelUiIpcDependencies): void {
  handleWithSenderGuard(deps.ipcMain, IPC_CHANNELS.pluginPanelSnapshot, deps.assertPluginPanelSender, () => {
    return deps.getPluginPanelSnapshot()
  })
  handleWithSenderGuard(deps.ipcMain, IPC_CHANNELS.pluginCommandInvoke, deps.assertPluginPanelSender, (_event, pluginId: unknown, commandId: unknown) => {
    return deps.invokePluginCommand(pluginId, commandId) ?? { ok: false, error: 'disabled' }
  })
  handleWithSenderGuard(deps.ipcMain, IPC_CHANNELS.pluginPanelViewOpen, deps.assertPluginPanelSender, async (_event, pluginId: unknown, payload: unknown) => {
    if (!deps.isPluginPanelPluginId(pluginId) || !payload || typeof payload !== 'object' || Array.isArray(payload)
      || deps.openSequence.value >= Number.MAX_SAFE_INTEGER) return { ok: false, error: 'invalid_request' }
    const bounds = payload as Record<string, unknown>
    const openToken = ++deps.openSequence.value
    return deps.openPluginPanelView(pluginId, openToken, bounds.frame, bounds.content)
  })
  deps.ipcMain.handle(IPC_CHANNELS.pluginPanelViewOpenFromPet, (event, pluginId: unknown) => {
    const petWindow = deps.getPetWindow()
    if (!deps.isTrustedIpcSender(event, petWindow) || !deps.isPluginPanelPluginId(pluginId)) return false
    const context = deps.getPluginPanelContext(pluginId)
    if (!context?.pluginsEnabled || !context.enabled || !context.manifest.contributes.panelView
      || !deps.enabledPluginRoot(pluginId)) return false
    deps.showPanelWindow('settings', pluginId)
    return true
  })
  onWithSenderGuard(deps.ipcMain, IPC_CHANNELS.pluginPanelViewBounds, deps.assertPluginPanelSender, (_event, payload: unknown) => {
    const panelWindow = deps.getPanelWindow()
    const controller = deps.getPluginPanelViewController()
    if (!panelWindow || panelWindow.isDestroyed() || !controller) return
    const data = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : {}
    const openToken = deps.finiteNumber(data.openToken)
    if (openToken === null || !Number.isSafeInteger(openToken)) return
    if (!panelWindow.isVisible()) {
      controller.onPanelWindowHidden()
      return
    }
    // 以 renderer 量測當下的 viewport 驗證，避免縮放途中與主行程視窗尺寸不同步而誤關插件；
    // 實際邊界一律由主行程依目前視窗尺寸重新計算，插件內容仍不會超出視窗。
    const viewportData = data.viewport && typeof data.viewport === 'object' ? data.viewport as Record<string, unknown> : {}
    const viewportWidth = deps.finiteNumber(viewportData.width)
    const viewportHeight = deps.finiteNumber(viewportData.height)
    if (viewportWidth === null || viewportHeight === null || viewportWidth < 1 || viewportHeight < 1
      || viewportWidth > MAX_VIEWPORT_SIZE || viewportHeight > MAX_VIEWPORT_SIZE) return
    const viewport = { width: viewportWidth, height: viewportHeight }
    const bounds = deps.validateBounds(
      deps.readPluginPanelRect(data.frame) ?? { x: -1, y: -1, width: 0, height: 0 },
      deps.readPluginPanelRect(data.content) ?? { x: -1, y: -1, width: 0, height: 0 },
      viewport,
    )
    if (!bounds) return
    const contentBounds = panelWindow.getContentBounds()
    controller.setLayout(openToken, pluginPanelViewInsets(bounds, viewport), {
      width: contentBounds.width,
      height: contentBounds.height,
    })
  })
  onWithSenderGuard(deps.ipcMain, IPC_CHANNELS.pluginPanelViewClose, deps.assertPluginPanelSender, (_event, openToken: unknown) => {
    if (typeof openToken === 'number' && Number.isSafeInteger(openToken)) {
      deps.getPluginPanelViewController()?.close('closed', openToken)
    }
  })
  deps.ipcMain.handle(IPC_CHANNELS.pluginPanelApi, (event, method: unknown, args: unknown) => {
    if (event.senderFrame !== event.sender.mainFrame) return { ok: false, error: 'not_permitted' }
    return deps.getPluginPanelViewController()?.handleApiRequest(event.sender, method, args)
      ?? Promise.resolve({ ok: false, error: 'disabled' })
  })
}
