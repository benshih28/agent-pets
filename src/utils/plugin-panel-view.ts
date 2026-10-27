import type { PluginPanelViewClosedEvent, PluginPanelViewCloseReason } from '../types/plugin'

export function isCurrentPluginPanelViewClose(
  event: PluginPanelViewClosedEvent,
  pluginId: string,
  openToken: number,
): boolean {
  return Boolean(event && event.pluginId === pluginId && event.openToken === openToken)
}

export function pluginPanelViewCloseError(reason: PluginPanelViewCloseReason): string {
  if (reason === 'hidden') return 'hidden'
  if (reason === 'load_failed') return 'panel_load_failed'
  if (reason === 'renderer_crashed') return 'panel_crashed'
  if (reason === 'renderer_unavailable') return 'panel_unavailable'
  if (reason === 'disabled') return 'disabled'
  return 'panel_closed'
}
