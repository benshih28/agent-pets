import type { PluginManifest } from '../types/plugin'

export type PluginCapability = 'panel' | 'commands' | 'tray' | 'badge' | 'skins' | 'panelThemes' | 'eventSource' | 'schedule' | 'feed' | 'reaction'

/** 卡片上的「提供：…」標籤來源：manifest 的貢獻點與排程權限，順序固定。 */
export function pluginCapabilities(manifest: Pick<PluginManifest, 'contributes' | 'permissions'> | null | undefined): PluginCapability[] {
  if (!manifest) return []
  const c = manifest.contributes
  const result: PluginCapability[] = []
  if (c.panelView) result.push('panel')
  if (c.commands?.length) result.push('commands')
  if (c.tray?.commands.length) result.push('tray')
  if (c.badge) result.push('badge')
  if (c.skins?.length) result.push('skins')
  if (c.panelThemes?.length) result.push('panelThemes')
  if (c.eventSource) result.push('eventSource')
  if (c.feed) result.push('feed')
  if (c.reaction) result.push('reaction')
  if (manifest.permissions.schedule) result.push('schedule')
  return result
}
