import { isPluginId } from '../types/id-patterns.ts'
const ICON_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.?\/)[^\\:]+\.(?:png|webp)$/i

export function resolvePluginIconUrl(
  pluginId: unknown,
  iconPath: unknown,
  pluginEnabled: boolean,
  pluginsEnabled: boolean,
  failedToLoad = false,
): string | null {
  if (!pluginEnabled || !pluginsEnabled || failedToLoad
    || !isPluginId(pluginId)
    || typeof iconPath !== 'string' || iconPath.length > 512 || !ICON_PATH.test(iconPath)) return null
  return `agent-pets://plugin/${pluginId}/${iconPath.split('/').map(encodeURIComponent).join('/')}`
}
