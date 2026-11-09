// One-shot hand-off from the dashboard plugin tab to Settings -> Plugins: the tab
// records which plugin detail to open, and the plugin panel consumes it once it
// has loaded its list. Kept outside both components so remounting cannot replay it.
import { ref } from 'vue'

export type PluginDetailRequestSection = 'overview' | 'settings' | 'commands' | 'themes' | 'diagnostics'

/** 每次請求都會遞增，讓已掛載的插件面板也能處理它。 */
export const pluginDetailRequestNonce = ref(0)

let pending: { pluginId: string; section: PluginDetailRequestSection } | null = null

export function requestPluginDetail(pluginId: string, section: PluginDetailRequestSection = 'overview'): void {
  pending = { pluginId, section }
  pluginDetailRequestNonce.value += 1
}

export function takePluginDetailRequest(): { pluginId: string; section: PluginDetailRequestSection } | null {
  const request = pending
  pending = null
  return request
}
