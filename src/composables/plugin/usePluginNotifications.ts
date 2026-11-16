// 插件通知收件匣：清單、已讀、開啟連結，以及可復原的「延遲提交」清除。
//
// 契約：
// - 讀：插件查找（顯示來源名稱）；錯誤與可復原的 Toast 走控制器傳入的 feedback。
// - refresh：同一時間的重複刷新合併成一次在途請求加一次結尾刷新，較舊的清單不會蓋過較新的。
// - 監聽與清理：掛載時訂閱 onPluginNotificationsChanged；卸載時取消訂閱，並先提交尚未提交的清除
//   （清掉復原計時器，不留下計時器）。
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { locale, t, tPlural } from '@/i18n'
import type { PluginNotificationRecord, PluginPanelPlugin } from '@/types/plugin'
import { formatDateTime } from '@/utils/intl-format'
import { createCoalescedRefresh, type PluginPanelFeedback } from '@/composables/plugin/panel-deps'

export interface PluginNotificationsDeps {
  pluginById(pluginId: string): PluginPanelPlugin | null
  feedback: Pick<PluginPanelFeedback, 'notify' | 'setError'>
}

// 清除通知採「延遲提交」：先從畫面隱藏並顯示可復原的 Toast，5 秒後才真正呼叫主行程清除；
// 復原即取消提交。離開頁面或再次清除時，會先提交前一批。
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
    // 整批只送一次 IPC（主程序也只廣播一次變更），而不是每筆各送一次。
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
