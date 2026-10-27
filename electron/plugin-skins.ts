import { createPluginSkinPetId } from '../src/utils/pet-id.ts'

export interface PluginSkinAvailabilitySource {
  pluginId: string
  enabled: boolean
  skinIds: readonly string[]
}

/** Returns skin pet ids only when both the global switch and plugin are enabled. */
export function availablePluginSkinPetIds(
  plugins: readonly PluginSkinAvailabilitySource[],
  pluginsEnabled: boolean,
): Set<string> {
  const petIds = new Set<string>()
  if (!pluginsEnabled) return petIds
  for (const plugin of plugins) {
    if (!plugin.enabled) continue
    for (const skinId of plugin.skinIds) {
      const petId = createPluginSkinPetId(plugin.pluginId, skinId)
      if (petId) petIds.add(petId)
    }
  }
  return petIds
}
