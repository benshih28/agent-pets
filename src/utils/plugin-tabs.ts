// Pure selection logic for the dashboard plugin tabs: which plugins get a tab,
// how a tab is identified, and how the remembered tab is restored.
import type { PluginManifest, PluginNotificationRecord, PluginPanelPlugin, PluginPanelSnapshot } from '../types/plugin'
import { isPluginId } from '../types/id-patterns.ts'

export const BUILT_IN_DASHBOARD_TABS = ['sessions', 'usage', 'history'] as const
export type BuiltInDashboardTab = typeof BUILT_IN_DASHBOARD_TABS[number]

export const PLUGIN_TAB_PREFIX = 'plugin:'

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
  return isPluginId(id) ? id : null
}

/** 分頁裡會出現的區塊；每一項都對應插件真的有宣告的能力，沒有能力就不顯示空殼。 */
export interface PluginTabSections {
  panelView: boolean
  panelThemes: boolean
  /** 只有宣告 `contributes.feed` 的插件能送通知，才顯示通知區。 */
  feed: boolean
  commands: boolean
  settings: boolean
}

export function pluginTabSections(manifest: Pick<PluginManifest, 'contributes'> | null | undefined): PluginTabSections {
  const contributes = manifest?.contributes
  return {
    panelView: Boolean(contributes?.panelView),
    panelThemes: (contributes?.panelThemes?.length ?? 0) > 0,
    feed: contributes?.feed === true,
    commands: (contributes?.commands?.length ?? 0) > 0,
    settings: Object.keys(contributes?.settings?.properties ?? {}).length > 0,
  }
}

/** 沒有任何可顯示的區塊（例如只提供寵物外觀）就不給分頁。 */
export function hasPluginTabContent(sections: PluginTabSections): boolean {
  return sections.panelView || sections.panelThemes || sections.feed || sections.commands || sections.settings
}

/**
 * Plugins that get a dashboard tab: installed and enabled, with a usable manifest and at
 * least one section to show, while the global switch is on. A crashed or incompatible host
 * never gets a tab. The snapshot's own order (install order) is kept.
 */
export function visiblePluginTabPlugins(
  snapshot: Pick<PluginPanelSnapshot, 'preferences' | 'plugins'> | null | undefined,
): PluginPanelPlugin[] {
  if (!snapshot?.preferences.pluginsEnabled) return []
  return snapshot.plugins.filter(plugin => plugin.status !== 'disabled_crashed'
    && plugin.status !== 'incompatible'
    && plugin.preference.enabled
    && plugin.manifest !== null
    && isPluginId(plugin.id)
    && hasPluginTabContent(pluginTabSections(plugin.manifest)))
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
