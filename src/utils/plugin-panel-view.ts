import type { PluginPanelViewClosedEvent, PluginPanelViewCloseReason } from '../types/plugin'

export function isCurrentPluginPanelViewClose(
  event: PluginPanelViewClosedEvent,
  pluginId: string,
  openToken: number,
): boolean {
  return Boolean(event && event.pluginId === pluginId && event.openToken === openToken)
}

export function shouldResetPluginPanelMaximized(previousPluginId: string, nextPluginId: string): boolean {
  return previousPluginId !== nextPluginId || !nextPluginId
}

export interface PluginPanelWindowSize { width: number; height: number }

// 放大時把控制面板視窗加大到插件頁允許的上限（960×800，與主行程 setMaximumSize 一致），
// 讓插件區寬到足以切換成雙欄版面；螢幕較小時以可用範圍為準，且不會比目前更小。
export const PLUGIN_PANEL_MAXIMIZED_SIZE: PluginPanelWindowSize = Object.freeze({ width: 960, height: 800 })

export function maximizedPluginPanelWindowSize(current: PluginPanelWindowSize, available: PluginPanelWindowSize): PluginPanelWindowSize {
  const fit = (value: number, limit: number, floor: number) => Math.round(Math.max(floor, Math.min(value, limit)))
  return {
    width: fit(PLUGIN_PANEL_MAXIMIZED_SIZE.width, available.width, Math.min(current.width, available.width)),
    height: fit(PLUGIN_PANEL_MAXIMIZED_SIZE.height, available.height, Math.min(current.height, available.height)),
  }
}

export function pluginPanelViewCloseError(reason: PluginPanelViewCloseReason): string {
  if (reason === 'hidden') return 'hidden'
  if (reason === 'load_failed') return 'panel_load_failed'
  if (reason === 'renderer_crashed') return 'panel_crashed'
  if (reason === 'renderer_unavailable') return 'panel_unavailable'
  if (reason === 'disabled') return 'disabled'
  return 'panel_closed'
}
