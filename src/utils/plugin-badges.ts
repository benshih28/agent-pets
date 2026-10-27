import type { PluginBadgeView } from '../types/plugin.ts'

export const PLUGIN_BADGE_MAX_CODE_POINTS = 6
export const PLUGIN_BADGE_MAX_PER_PET = 2

export interface PluginPetBadgeSummary {
  badges: PluginBadgeView[]
  hiddenCount: number
}

/** Selects at most two badges for one visible pet and reports the remaining count. */
export function summarizePluginBadgesForPet(
  badges: readonly PluginBadgeView[],
  petId: string,
  defaultPetId: string,
): PluginPetBadgeSummary {
  const matching = badges.filter(badge => (badge.targetPetId ?? defaultPetId) === petId)
  return {
    badges: matching.slice(0, PLUGIN_BADGE_MAX_PER_PET).map(badge => ({ ...badge, pluginName: { ...badge.pluginName } })),
    hiddenCount: Math.max(0, matching.length - PLUGIN_BADGE_MAX_PER_PET),
  }
}
