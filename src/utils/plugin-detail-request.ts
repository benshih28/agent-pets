// One-shot hand-off from the dashboard plugin tab to Settings -> Plugins: the tab
// records which plugin detail to open, and the plugin panel consumes it once it
// has loaded its list. Kept outside both components so remounting cannot replay it.
export type PluginDetailRequestSection = 'overview' | 'settings' | 'commands' | 'diagnostics'

let pending: { pluginId: string; section: PluginDetailRequestSection } | null = null

export function requestPluginDetail(pluginId: string, section: PluginDetailRequestSection = 'overview'): void {
  pending = { pluginId, section }
}

export function takePluginDetailRequest(): { pluginId: string; section: PluginDetailRequestSection } | null {
  const request = pending
  pending = null
  return request
}
