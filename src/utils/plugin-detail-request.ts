// Kept outside both components so remounting cannot replay the request.
import { ref } from 'vue'

export type PluginDetailRequestSection = 'overview' | 'settings' | 'commands' | 'themes' | 'diagnostics'

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
