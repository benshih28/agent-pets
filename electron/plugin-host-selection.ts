import type { PluginHostDescriptor } from './plugin-host-window.ts'

export interface PluginHostSelection {
  selected: PluginHostDescriptor[]
  skipped: PluginHostDescriptor[]
}

export function canEnablePluginWithinLimit(currentlyEnabled: boolean, enabledCount: number, maximum: number): boolean {
  if (currentlyEnabled) return true
  return Number.isSafeInteger(enabledCount) && enabledCount >= 0
    && Number.isSafeInteger(maximum) && maximum > 0 && enabledCount < maximum
}

/** Keeps the earliest enabled descriptors running if stored state exceeds its configured limit. */
export function selectEnabledPluginDescriptors(
  candidates: readonly PluginHostDescriptor[],
  maximum: number,
): PluginHostSelection {
  if (!Number.isSafeInteger(maximum) || maximum < 1) return { selected: [], skipped: [...candidates] }
  return {
    selected: candidates.slice(0, maximum).map(plugin => ({ ...plugin })),
    skipped: candidates.slice(maximum).map(plugin => ({ ...plugin })),
  }
}
