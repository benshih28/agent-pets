import type { MenuItemConstructorOptions } from 'electron'
import type { PluginLocalizedText } from '../src/types/plugin.ts'

export interface PluginTrayCommandItem {
  pluginId: string
  pluginName: PluginLocalizedText
  commandId: string
  title: PluginLocalizedText
}

export interface PluginTrayMenuBuildResult {
  menu: MenuItemConstructorOptions | null
  omittedPluginIds: string[]
  /** Number of commands dropped by the cap, so the Tray can say so. */
  omittedCount: number
}

const MAX_PLUGIN_TRAY_COMMANDS = 30
const MAX_TRAY_LABEL_CHARACTERS = 32

function truncateLabel(value: string): string {
  const characters = Array.from(value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim())
  if (characters.length <= MAX_TRAY_LABEL_CHARACTERS) return characters.join('')
  return `${characters.slice(0, MAX_TRAY_LABEL_CHARACTERS - 1).join('')}…`
}

/** Builds a bounded text-only submenu; callbacks remain owned by the host. */
export function buildPluginTrayMenu(
  items: readonly PluginTrayCommandItem[],
  locale: 'zh-TW' | 'en-US',
  label: string,
  onInvoke: (pluginId: string, commandId: string) => void,
): PluginTrayMenuBuildResult {
  const limited = items.slice(0, MAX_PLUGIN_TRAY_COMMANDS)
  const omittedCount = Math.max(0, items.length - MAX_PLUGIN_TRAY_COMMANDS)
  const omittedPluginIds = [...new Set(items.slice(MAX_PLUGIN_TRAY_COMMANDS).map(item => item.pluginId))]
  const grouped = new Map<string, { name: string; commands: PluginTrayCommandItem[] }>()
  for (const item of limited) {
    let plugin = grouped.get(item.pluginId)
    if (!plugin) {
      plugin = { name: item.pluginName[locale], commands: [] }
      grouped.set(item.pluginId, plugin)
    }
    plugin.commands.push(item)
  }
  if (grouped.size === 0) return { menu: null, omittedPluginIds, omittedCount }

  const submenu = [...grouped.entries()].map(([pluginId, plugin]) => {
    // Truncation can make two different commands read the same; name the
    // plugin on the later ones so they stay distinguishable.
    const seen = new Set<string>()
    return {
      label: truncateLabel(plugin.name),
      submenu: plugin.commands.map(command => {
        let label = truncateLabel(command.title[locale])
        if (seen.has(label)) label = truncateLabel(`${command.title[locale]} (${command.commandId})`)
        seen.add(label)
        return { label, click: () => onInvoke(pluginId, command.commandId) }
      }),
    }
  })
  return { menu: { label: truncateLabel(label), submenu }, omittedPluginIds, omittedCount }
}
