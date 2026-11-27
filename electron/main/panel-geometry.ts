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
    // 優先採 renderer 量到的內容高度（同時取決於寵物尺寸與狀態列數量，常數只是後備）；面板必須錨定可見的寵物而不是視窗外框，否則小尺寸時上方會懸著空隙。
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

  // 精靈／MCP 頁只能暫時提高最小值（null 釋放），不改動也不持久化使用者自己的尺寸。
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
