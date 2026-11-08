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

// 放大時把控制面板視窗加大到螢幕可用範圍（扣掉四周間距），讓插件區寬到足以切換成雙欄版面；
// 這只是暫時的最小尺寸，不會覆寫使用者自己調整的面板大小，且不會比目前更小。
export const PLUGIN_PANEL_MAXIMIZE_GAP = 6

export function maximizedPluginPanelWindowSize(current: PluginPanelWindowSize, available: PluginPanelWindowSize): PluginPanelWindowSize {
  const fit = (limit: number, current: number) => Math.round(Math.max(current, limit))
  return {
    width: fit(available.width - PLUGIN_PANEL_MAXIMIZE_GAP * 2, current.width),
    height: fit(available.height - PLUGIN_PANEL_MAXIMIZE_GAP * 2, current.height),
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
