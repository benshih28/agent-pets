import type { BrowserWindow, Display, Rectangle } from 'electron'
import type { PanelSizeStore } from '../panel-size-store.ts'
import { PROGRAMMATIC_PANEL_RESIZE_WINDOW_MS } from '../plugin-panel-window.ts'
import {
  PANEL_WIDTH,
  clampPanelSize,
  clampRectToWorkArea,
  computePanelPlacement,
  effectivePanelSize,
  panelMaxSize,
  panelMinSize,
  type PanelSize,
} from '../../src/utils/panel-layout.ts'
import { QUOTA_TOOLTIP_HEADROOM_H } from '../../src/utils/pet-window-size.ts'
import type { MainState } from './state.ts'

// 面板視窗的尺寸與定位：一份使用者自己的尺寸套用到所有頁面（儀表板、設定、plugin 分頁），
// 精靈／MCP 頁只能暫時提高最小值且不寫檔。
//
// 狀態仍放在 `mainState`（面板視窗、尺寸記錄、結算計時器都跨模組共用）；螢幕、尺寸檔工廠與
// 時鐘以參數傳入，測試可換成假螢幕與假儲存。plugin panel view 的 bounds 驗證與視窗建立
// 事件不在這裡，仍由 runtime.ts 處理。

const PANEL_SETTLE_DELAY_MS = 250

export type PanelGeometryState = Pick<MainState,
  | 'petWindow' | 'panelWindow' | 'petContentHeight'
  | 'panelUserSize' | 'panelMinimumSize' | 'panelSizeStore'
  | 'panelSettleTimer' | 'programmaticPluginPanelUntil'>

export interface PanelGeometryScreen {
  getDisplayMatching(rect: Rectangle): Display
  getPrimaryDisplay(): Display
}

export interface PanelGeometryDeps {
  state: PanelGeometryState
  screen: PanelGeometryScreen
  /** 第一次使用時才建立尺寸檔，並由呼叫端決定路徑與結束時的 flush。 */
  createSizeStore(): PanelSizeStore
  now?: () => number
}

export type PanelBounds = Rectangle

export interface PanelGeometry {
  computePanelBounds(height: number, width?: number): PanelBounds
  currentPanelSize(): PanelSize
  applyPanelWindowLimits(workArea?: Rectangle): void
  setPluginPanelWindowBounds(bounds: PanelBounds): void
  applyCurrentPanelSize(): void
  recordUserPanelSize(size: PanelSize): void
  requestPanelMinimum(size: PanelSize | null): void
  resetPanelSize(): void
  repositionVisiblePanel(): void
}

function liveWindow(window: BrowserWindow | null): window is BrowserWindow {
  return window !== null && !window.isDestroyed()
}

export function createPanelGeometry(deps: PanelGeometryDeps): PanelGeometry {
  const { state, screen } = deps
  const now = deps.now ?? (() => Date.now())

  function sizeStore(): PanelSizeStore {
    if (!state.panelSizeStore) {
      const store = deps.createSizeStore()
      state.panelUserSize = store.load()
      state.panelSizeStore = store
    }
    return state.panelSizeStore
  }

  function computePanelBounds(height: number, width = PANEL_WIDTH): PanelBounds {
    if (!state.petWindow) {
      const { workArea } = screen.getPrimaryDisplay()
      return { x: workArea.x, y: workArea.y, ...clampPanelSize({ width, height }, workArea) }
    }
    const petBounds = state.petWindow.getBounds()
    // 視窗水平中心與可見精靈一致（留白只加在上方）。優先採 renderer 量到的內容高度：它同時
    // 取決於寵物尺寸與狀態列數量，固定留白常數表達不出來；常數只是後備。面板必須錨定可見的
    // 寵物而不是視窗外框，否則小尺寸時面板上方會懸著一大段空隙。
    return computePanelPlacement({
      petBounds,
      petContentHeight: state.petContentHeight,
      petHeadroom: QUOTA_TOOLTIP_HEADROOM_H,
      workArea: screen.getDisplayMatching(petBounds).workArea,
      width,
      height,
    })
  }

  function currentPanelSize(): PanelSize {
    sizeStore()
    return effectivePanelSize(state.panelUserSize, state.panelMinimumSize)
  }

  function panelWorkArea(bounds?: Rectangle): Rectangle {
    if (bounds) return screen.getDisplayMatching(bounds).workArea
    if (state.petWindow && !state.petWindow.isDestroyed()) return screen.getDisplayMatching(state.petWindow.getBounds()).workArea
    return screen.getPrimaryDisplay().workArea
  }

  // 最小／最大值跟著面板所在的螢幕：使用者最多拖到工作區減去間距，最小不低於可讀尺寸。
  function applyPanelWindowLimits(workArea = panelWorkArea()): void {
    const panel = state.panelWindow
    if (!liveWindow(panel)) return
    const min = panelMinSize(workArea)
    const max = panelMaxSize(workArea)
    panel.setResizable(true)
    panel.setMinimumSize(min.width, min.height)
    panel.setMaximumSize(max.width, max.height)
  }

  function setPluginPanelWindowBounds(bounds: PanelBounds): void {
    if (!liveWindow(state.panelWindow)) return
    applyPanelWindowLimits(panelWorkArea(bounds))
    state.programmaticPluginPanelUntil = now() + PROGRAMMATIC_PANEL_RESIZE_WINDOW_MS
    state.panelWindow.setBounds(bounds)
  }

  function applyCurrentPanelSize(): void {
    const { width, height } = currentPanelSize()
    setPluginPanelWindowBounds(computePanelBounds(height, width))
  }

  // 使用者拖曳：記住尺寸（磁碟端去抖）、丟掉精靈頁的最小值，拖曳停下後把視窗滑回工作區內。
  function recordUserPanelSize(size: PanelSize): void {
    const panel = state.panelWindow
    if (!liveWindow(panel)) return
    const clamped = clampPanelSize(size, panelWorkArea(panel.getBounds()))
    state.panelUserSize = clamped
    state.panelMinimumSize = null
    sizeStore().save(clamped)
    if (state.panelSettleTimer) clearTimeout(state.panelSettleTimer)
    state.panelSettleTimer = setTimeout(() => {
      state.panelSettleTimer = null
      const window = state.panelWindow
      if (!liveWindow(window) || !window.isVisible()) return
      const bounds = window.getBounds()
      const inside = clampRectToWorkArea(bounds, screen.getDisplayMatching(bounds).workArea)
      if (inside.x !== bounds.x || inside.y !== bounds.y || inside.width !== bounds.width || inside.height !== bounds.height) {
        setPluginPanelWindowBounds(inside)
      }
    }, PANEL_SETTLE_DELAY_MS)
  }

  // 精靈／MCP 頁請求最小尺寸（null 釋放），不會改動也不會持久化使用者自己的尺寸。
  function requestPanelMinimum(size: PanelSize | null): void {
    sizeStore()
    state.panelMinimumSize = size && size.height > 0 ? { width: size.width, height: size.height } : null
    if (state.panelWindow?.isVisible()) applyCurrentPanelSize()
  }

  function resetPanelSize(): void {
    sizeStore().save(null)
    state.panelUserSize = null
    state.panelMinimumSize = null
    if (state.panelWindow?.isVisible()) applyCurrentPanelSize()
  }

  function repositionVisiblePanel(): void {
    if (!state.panelWindow?.isVisible()) return
    applyCurrentPanelSize()
  }

  return {
    computePanelBounds,
    currentPanelSize,
    applyPanelWindowLimits,
    setPluginPanelWindowBounds,
    applyCurrentPanelSize,
    recordUserPanelSize,
    requestPanelMinimum,
    resetPanelSize,
    repositionVisiblePanel,
  }
}
