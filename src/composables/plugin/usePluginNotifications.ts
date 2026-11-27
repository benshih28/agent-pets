import { computed, onMounted, onUnmounted, ref } from 'vue'
import { locale, t, tPlural } from '@/i18n'
import type { PluginNotificationRecord, PluginPanelPlugin } from '@/types/plugin'
import { formatDateTime } from '@/utils/intl-format'
import { createCoalescedRefresh, type PluginPanelFeedback } from '@/composables/plugin/panel-deps'

export interface PluginNotificationsDeps {
  pluginById(pluginId: string): PluginPanelPlugin | null
  feedback: Pick<PluginPanelFeedback, 'notify' | 'setError'>
}

// 延遲提交：復原視窗內只隱藏；離開頁面或再次清除時先提交前一批。
const CLEAR_UNDO_MS = 5000

export function usePluginNotifications(deps: PluginNotificationsDeps) {
  const { pluginById } = deps
  const { notify, setError } = deps.feedback

  const notifications = ref<PluginNotificationRecord[]>([])
  const hiddenNotificationIds = ref(new Set<string>())
  const visibleNotifications = computed(() => notifications.value.filter(record => !hiddenNotificationIds.value.has(record.item.id)))
  let pendingClear: { ids: Set<string>; pluginId?: string; timer: ReturnType<typeof setTimeout> } | null = null
  let removeNotificationsListener: (() => void) | null = null

  const refreshNotifications = createCoalescedRefresh(async () => {
    try {
      const result = await window.electronAPI?.listPluginNotifications()
      if (result?.ok) notifications.value = result.value
      else if (result && !result.ok) setError(result.error)
    } catch {
      setError('plugin_action_failed')
    }
  })

  async function markNotificationRead(itemId: string): Promise<void> {
    try {
      const result = await window.electronAPI?.markPluginNotificationRead(itemId)
      if (!result?.ok) {
        if (result && !result.ok) setError(result.error)
        return
      }
      await refreshNotifications()
    } catch {
      setError('plugin_action_failed')
    }
  }

  async function openNotificationLink(itemId: string): Promise<void> {
    try {
      const opened = await window.electronAPI?.openPluginFeedLink(itemId)
      if (!opened) setError('plugin_action_failed')
    } catch {
      setError('plugin_action_failed')
    }
  }

  async function commitPendingClear(): Promise<void> {
    const pending = pendingClear
    if (!pending) return
    pendingClear = null
    clearTimeout(pending.timer)
    try {
      const result = await window.electronAPI?.clearPluginNotifications(pending.pluginId)
      if (result && !result.ok) setError(result.error)
    } catch {
      setError('plugin_action_failed')
    } finally {
      hiddenNotificationIds.value = new Set()
      await refreshNotifications()
    }
  }

  async function clearNotifications(pluginId?: string): Promise<void> {
    await commitPendingClear()
    const ids = new Set(notifications.value.filter(record => !pluginId || record.item.pluginId === pluginId).map(record => record.item.id))
    if (ids.size === 0) return
    hiddenNotificationIds.value = ids
    pendingClear = { ids, pluginId, timer: setTimeout(() => void commitPendingClear(), CLEAR_UNDO_MS) }
    notify({
      tone: 'success',
      text: tPlural('plugins.notificationsCleared', ids.size),
      durationMs: CLEAR_UNDO_MS,
      action: {
        label: t('plugins.undo'),
        run: () => {
          if (pendingClear) clearTimeout(pendingClear.timer)
          pendingClear = null
          hiddenNotificationIds.value = new Set()
        },
      },
    })
  }

  async function markAllNotificationsRead(pluginId?: string): Promise<void> {
    const hasUnread = visibleNotifications.value.some(record => !record.read && (!pluginId || record.item.pluginId === pluginId))
    if (!hasUnread) return
    await window.electronAPI?.markAllPluginNotificationsRead(pluginId)
    await refreshNotifications()
  }

  function notificationSource(item: PluginNotificationRecord): string {
    return pluginById(item.item.pluginId)?.manifest?.name[locale.value] ?? item.item.pluginName[locale.value]
  }

  function notificationTime(timestamp: number): string {
    return formatDateTime(timestamp, locale.value)
  }

  onMounted(() => {
    removeNotificationsListener = window.electronAPI?.onPluginNotificationsChanged(() => {
      void refreshNotifications()
    }) ?? null
  })

  onUnmounted(() => {
    void commitPendingClear()
    removeNotificationsListener?.()
    removeNotificationsListener = null
  })

  return {
    notifications,
    visibleNotifications,
    refreshNotifications,
    markNotificationRead,
    openNotificationLink,
    clearNotifications,
    markAllNotificationsRead,
    notificationSource,
    notificationTime,
  }
}
