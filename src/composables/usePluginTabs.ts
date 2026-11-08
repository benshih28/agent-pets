import { computed, onMounted, onUnmounted, ref } from 'vue'
import { locale } from '@/i18n'
import { resolvePluginIconUrl } from '@/utils/plugin-icon'
import {
  pluginTabBadgeText,
  pluginTabValue,
  unreadCountByPlugin,
  visiblePluginTabPlugins,
} from '@/utils/plugin-tabs'
import type {
  PluginBadgeView,
  PluginNotificationRecord,
  PluginPanelPlugin,
  PluginPanelSnapshot,
} from '@/types/plugin'

export interface PluginDashboardTab {
  value: string
  pluginId: string
  label: string
  iconUrl: string | null
  badgeText: string
  plugin: PluginPanelPlugin
}

// Read-only view of the plugin list for the dashboard tab bar. It only reads the
// snapshot / feed IPC the plugin panel already uses; the plugin panel controller
// (settings, install, remove) stays the single writer, so this refreshes whenever
// the dashboard is shown again or gains focus (full snapshot); feed events refetch only notifications.
export function usePluginTabs() {
  const snapshot = ref<PluginPanelSnapshot | null>(null)
  const notifications = ref<PluginNotificationRecord[]>([])
  const liveBadges = ref<PluginBadgeView[]>([])
  const loading = ref(true)
  const failedIcons = ref(new Set<string>())
  let inFlight = false
  let queued = false
  let disposed = false
  const cleanups: Array<() => void> = []

  async function refresh(): Promise<void> {
    const api = window.electronAPI
    if (!api?.getPluginPanelSnapshot) { loading.value = false; return }
    if (inFlight) { queued = true; return }
    inFlight = true
    try {
      const result = await api.getPluginPanelSnapshot()
      if (disposed) return
      if (result?.ok) snapshot.value = result.value
      const feed = await api.listPluginNotifications?.()
      if (!disposed && feed?.ok) notifications.value = feed.value
    } catch {
      // Keep the last known list; the tab bar must never break the dashboard.
    } finally {
      inFlight = false
      loading.value = false
      if (queued && !disposed) { queued = false; void refresh() }
    }
  }

  // A notifications-changed event only changes the feed; skip the (heavier) plugin snapshot.
  let feedInFlight = false
  let feedQueued = false
  async function refreshNotifications(): Promise<void> {
    const api = window.electronAPI
    if (!api?.listPluginNotifications) return
    if (feedInFlight) { feedQueued = true; return }
    feedInFlight = true
    try {
      const feed = await api.listPluginNotifications()
      if (!disposed && feed?.ok) notifications.value = feed.value
    } catch {
      // Keep the last known feed.
    } finally {
      feedInFlight = false
      if (feedQueued && !disposed) { feedQueued = false; void refreshNotifications() }
    }
  }

  const unread = computed(() => unreadCountByPlugin(notifications.value))
  const badgeByPlugin = computed(() => {
    const map = new Map<string, string>()
    for (const badge of liveBadges.value) if (badge.text) map.set(badge.pluginId, badge.text)
    return map
  })
  const pluginsEnabled = computed(() => snapshot.value?.preferences.pluginsEnabled === true)

  const tabs = computed<PluginDashboardTab[]>(() => visiblePluginTabPlugins(snapshot.value).map(plugin => {
    const count = unread.value.get(plugin.id) ?? 0
    const liveText = badgeByPlugin.value.get(plugin.id) ?? ''
    return {
      value: pluginTabValue(plugin.id),
      pluginId: plugin.id,
      label: plugin.manifest?.name[locale.value] ?? plugin.id,
      iconUrl: resolvePluginIconUrl(
        plugin.id, plugin.manifest?.icon, plugin.preference.enabled, pluginsEnabled.value, failedIcons.value.has(plugin.id),
      ),
      badgeText: pluginTabBadgeText(count) || liveText.slice(0, 4),
      plugin,
    }
  }))

  function feedFor(pluginId: string): PluginNotificationRecord[] {
    return notifications.value.filter(record => record.item.pluginId === pluginId)
  }

  function hideIcon(pluginId: string): void {
    failedIcons.value = new Set([...failedIcons.value, pluginId])
  }

  onMounted(() => {
    void refresh()
    const api = window.electronAPI
    const off1 = api?.onPluginNotificationsChanged?.(() => { void refreshNotifications() })
    const off2 = api?.onPluginBadgesChanged?.(badges => { liveBadges.value = badges })
    if (off1) cleanups.push(off1)
    if (off2) cleanups.push(off2)
    void api?.getPluginBadges?.().then(badges => { liveBadges.value = badges }).catch(() => {})
    window.addEventListener('focus', onFocus)
  })

  function onFocus(): void { void refresh() }

  onUnmounted(() => {
    disposed = true
    window.removeEventListener('focus', onFocus)
    for (const cleanup of cleanups) cleanup()
  })

  return { tabs, loading, refresh, feedFor, hideIcon, notifications }
}
