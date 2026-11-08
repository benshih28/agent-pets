// Pure selection logic for the dashboard plugin tabs: which plugins get a tab,
// how a tab is identified, and how the remembered tab is restored.
import type { PluginNotificationRecord, PluginPanelPlugin, PluginPanelSnapshot } from '../types/plugin'

export const BUILT_IN_DASHBOARD_TABS = ['sessions', 'usage', 'history'] as const
export type BuiltInDashboardTab = typeof BUILT_IN_DASHBOARD_TABS[number]

export const PLUGIN_TAB_PREFIX = 'plugin:'
const PLUGIN_ID = /^(?!_host$|_shared$)[a-z0-9-]{3,48}$/

export function isBuiltInDashboardTab(value: unknown): value is BuiltInDashboardTab {
  return typeof value === 'string' && (BUILT_IN_DASHBOARD_TABS as readonly string[]).includes(value)
}

export function pluginTabValue(pluginId: string): string {
  return `${PLUGIN_TAB_PREFIX}${pluginId}`
}

/** The plugin id of a `plugin:<id>` tab value, or null for built-in / malformed values. */
export function pluginIdOfTab(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith(PLUGIN_TAB_PREFIX)) return null
  const id = value.slice(PLUGIN_TAB_PREFIX.length)
  return PLUGIN_ID.test(id) ? id : null
}

/**
 * Plugins that get a dashboard tab: installed and enabled, with a usable manifest,
 * while the global switch is on. A crashed or incompatible host never gets a tab.
 * The snapshot's own order (install order) is kept.
 */
export function visiblePluginTabPlugins(
  snapshot: Pick<PluginPanelSnapshot, 'preferences' | 'plugins'> | null | undefined,
): PluginPanelPlugin[] {
  if (!snapshot?.preferences.pluginsEnabled) return []
  return snapshot.plugins.filter(plugin => plugin.status !== 'disabled_crashed'
    && plugin.status !== 'incompatible'
    && plugin.preference.enabled
    && plugin.manifest !== null
    && PLUGIN_ID.test(plugin.id))
}

/** A requested tab if it still exists, otherwise Sessions. */
export function resolveDashboardTab(requested: string, pluginIds: readonly string[]): string {
  if (isBuiltInDashboardTab(requested)) return requested
  const id = pluginIdOfTab(requested)
  return id !== null && pluginIds.includes(id) ? requested : 'sessions'
}

/** Validates a stored value; plugin tabs are re-checked against live plugins by resolveDashboardTab. */
export function parseStoredDashboardTab(raw: unknown): string | null {
  if (isBuiltInDashboardTab(raw)) return raw
  return pluginIdOfTab(raw) === null ? null : (raw as string)
}

export function unreadCountByPlugin(records: readonly PluginNotificationRecord[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const record of records) {
    if (record.read) continue
    counts.set(record.item.pluginId, (counts.get(record.item.pluginId) ?? 0) + 1)
  }
  return counts
}

export const PLUGIN_TAB_BADGE_MAX = 99

/** Badge text for a count; capped so the tab stays narrow. Empty string means no badge. */
export function pluginTabBadgeText(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return ''
  return count > PLUGIN_TAB_BADGE_MAX ? `${PLUGIN_TAB_BADGE_MAX}+` : String(Math.floor(count))
}
