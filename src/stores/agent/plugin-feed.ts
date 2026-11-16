// 插件送到寵物旁的單則短訊（plugin feed）。佇列、速率與保存期限都在主程序；
// renderer 只重新驗證形狀、顯示目前這一則，到期或被點掉時回報主程序。
//
// - 事件輸入：`handlePluginFeedItem()`（主程序推來的新項目）、`setPluginFeedUnreadCount()`、
//   使用者點開連結（`openPluginFeedLink`）或關掉（`completePluginFeed`）。
// - 計時器：一個，指向目前項目的 `expiresAt`；換新項目或完成時清掉，store 的 effect scope 結束時也會清掉。
// - storage：無。
// - 跨視窗同步：無；只有寵物視窗顯示 feed。
import { onScopeDispose, ref, shallowRef } from 'vue'
import type { PluginFeedItem } from '@/types/plugin'
import { isPluginId, isSafeItemId } from '@/types/id-patterns'
import { isValidPetId } from '@/utils/pet-id'

/** 主程序給的到期時間最多比現在晚這麼久；更遠的一律當成不合法。 */
const MAX_FEED_LIFETIME_MS = 15_000
const MAX_UNREAD_COUNT = 1_000_000

function isLocalizedName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 48
}

/** 插件圖示只能是這個插件自己的 `agent-pets://plugin/<id>/...` 資源。 */
function safeIconUrl(value: string, pluginId: string): string | null {
  try {
    const icon = new URL(value)
    if (icon.protocol !== 'agent-pets:' || icon.hostname !== 'plugin' || icon.username || icon.password
      || icon.port || icon.search || icon.hash || !icon.pathname.startsWith(`/${pluginId}/`)) return null
    return icon.href
  } catch {
    return null
  }
}

function safeLink(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
    return url.href
  } catch {
    return null
  }
}

export function normalizePluginFeedItem(value: unknown, now = Date.now()): PluginFeedItem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (!isSafeItemId(raw.id)
    || !isPluginId(raw.pluginId)
    || !raw.pluginName || typeof raw.pluginName !== 'object' || Array.isArray(raw.pluginName)
    || typeof raw.title !== 'string' || raw.title.length === 0 || raw.title.length > 60
    || typeof raw.body !== 'string' || raw.body.length === 0 || raw.body.length > 240
    || (raw.priority !== 'low' && raw.priority !== 'normal')
    || typeof raw.createdAt !== 'number' || !Number.isSafeInteger(raw.createdAt)
    || typeof raw.expiresAt !== 'number' || !Number.isSafeInteger(raw.expiresAt)
    || raw.expiresAt <= now || raw.expiresAt > now + MAX_FEED_LIFETIME_MS) return null
  const name = raw.pluginName as Record<string, unknown>
  const zhName = name['zh-TW']
  const enName = name['en-US']
  if (!isLocalizedName(zhName) || !isLocalizedName(enName)) return null

  let targetPetId: string | undefined
  if (raw.targetPetId !== undefined) {
    if (!isValidPetId(raw.targetPetId, 64)) return null
    targetPetId = raw.targetPetId
  }

  let iconUrl: string | undefined
  if (raw.iconUrl !== undefined) {
    if (typeof raw.iconUrl !== 'string') return null
    const safe = safeIconUrl(raw.iconUrl, raw.pluginId)
    if (!safe) return null
    iconUrl = safe
  }

  let link: string | undefined
  if (raw.link !== undefined) {
    if (typeof raw.link !== 'string') return null
    const safe = safeLink(raw.link)
    if (!safe) return null
    link = safe
  }
  return {
    id: raw.id,
    pluginId: raw.pluginId,
    ...(targetPetId ? { targetPetId } : {}),
    pluginName: { 'zh-TW': zhName, 'en-US': enName },
    ...(iconUrl ? { iconUrl } : {}),
    title: raw.title,
    body: raw.body,
    ...(link ? { link } : {}),
    priority: raw.priority,
    createdAt: raw.createdAt,
    expiresAt: raw.expiresAt,
    ...(raw.panelViewAvailable === true ? { panelViewAvailable: true } : {}),
  }
}

export function usePluginFeed() {
  const pluginFeedItem = shallowRef<PluginFeedItem | null>(null)
  const pluginFeedUnreadCount = ref(0)
  let pluginFeedTimer: ReturnType<typeof setTimeout> | null = null

  function clearFeedTimer() {
    if (pluginFeedTimer) clearTimeout(pluginFeedTimer)
    pluginFeedTimer = null
  }

  function handlePluginFeedItem(value: unknown): void {
    const item = normalizePluginFeedItem(value)
    if (!item) return
    clearFeedTimer()
    pluginFeedItem.value = item
    pluginFeedTimer = setTimeout(() => completePluginFeed(item.id), Math.max(1, item.expiresAt - Date.now()))
  }

  function completePluginFeed(itemId: unknown): void {
    const item = pluginFeedItem.value
    if (!item || item.id !== itemId) return
    clearFeedTimer()
    pluginFeedItem.value = null
    void window.electronAPI?.completePluginFeed(item.id).catch(() => {})
  }

  function setPluginFeedUnreadCount(value: unknown): void {
    pluginFeedUnreadCount.value = typeof value === 'number' && Number.isSafeInteger(value)
      ? Math.max(0, Math.min(MAX_UNREAD_COUNT, value))
      : 0
  }

  function openPluginFeedLink(itemId: string): void {
    void window.electronAPI?.openPluginFeedLink(itemId)
  }

  onScopeDispose(clearFeedTimer)

  return {
    pluginFeedItem,
    pluginFeedUnreadCount,
    handlePluginFeedItem,
    completePluginFeed,
    setPluginFeedUnreadCount,
    openPluginFeedLink,
  }
}
