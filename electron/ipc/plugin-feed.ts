import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import type { PluginBadgeController } from '../plugin-badges.ts'
import type { PluginFeedController } from '../plugin-feed.ts'
import type { PluginEventSourceController } from '../plugin-event-source.ts'
import { isPluginPanelNotificationId } from '../plugin-panel-validation.ts'
import { IPC_CHANNELS } from './channels.ts'

export interface PluginFeedIpcDependencies {
  ipcMain: Pick<IpcMain, 'handle'>
  assertTrustedIpcSender(event: IpcMainInvokeEvent, requiredWindow?: BrowserWindow | null): void
  assertPluginPanelSender(event: IpcMainInvokeEvent): void
  getPetWindow(): BrowserWindow | null
  getPanelWindow(): BrowserWindow | null
  getPluginFeedController(): PluginFeedController | null
  getPluginBadgeController(): PluginBadgeController | null
  getPluginEventSourceController(): PluginEventSourceController | null
  isPluginPanelPluginId(value: unknown): value is string
  isPluginSkinPetId(value: unknown): value is string
  getPendingSkinFallbacks(): Map<string, {
    pluginId: string
    pluginName: { 'zh-TW': string; 'en-US': string }
    skinName: { 'zh-TW': string; 'en-US': string }
  }>
  getEnabledPluginSkinIds(): Set<string>
  fallbackCopy(info: { pluginName: { 'zh-TW': string; 'en-US': string }; skinName: { 'zh-TW': string; 'en-US': string } }): { title: string; body: string }
  addSystemNotification(pluginId: string, pluginName: { 'zh-TW': string; 'en-US': string }, title: string, body: string): boolean
  broadcastUnreadCount(): void
  hasPluginContext(pluginId: string): boolean
  isPluginLinkHostAllowed(pluginId: string, host: string): boolean
  openExternal(url: string): Promise<void>
}

export function registerPluginFeedIpc(deps: PluginFeedIpcDependencies): void {
  deps.ipcMain.handle(IPC_CHANNELS.pluginFeedUnreadCount, event => {
    deps.assertTrustedIpcSender(event)
    return deps.getPluginFeedController()?.unreadCount() ?? 0
  })
  deps.ipcMain.handle(IPC_CHANNELS.pluginBadgesGet, event => {
    deps.assertTrustedIpcSender(event, deps.getPetWindow())
    return deps.getPluginBadgeController()?.list() ?? []
  })
  deps.ipcMain.handle(IPC_CHANNELS.pluginEventSourceList, event => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    return deps.getPluginEventSourceController()?.list() ?? []
  })
  deps.ipcMain.handle(IPC_CHANNELS.pluginFeedComplete, (event, itemId: unknown) => {
    deps.assertTrustedIpcSender(event, deps.getPetWindow())
    if (typeof itemId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(itemId)) return false
    return deps.getPluginFeedController()?.complete(itemId) ?? false
  })
  deps.ipcMain.handle(IPC_CHANNELS.pluginNotificationsList, event => {
    deps.assertPluginPanelSender(event)
    return { ok: true, value: deps.getPluginFeedController()?.listNotifications() ?? [] }
  })
  deps.ipcMain.handle(IPC_CHANNELS.pluginNotificationsRead, (event, itemId: unknown) => {
    deps.assertPluginPanelSender(event)
    if (!isPluginPanelNotificationId(itemId)) return { ok: false, error: 'invalid_request' }
    return { ok: true, value: { read: deps.getPluginFeedController()?.markRead(itemId) ?? false } }
  })
  deps.ipcMain.handle(IPC_CHANNELS.pluginNotificationsClear, (event, pluginId: unknown) => {
    deps.assertPluginPanelSender(event)
    if (pluginId !== undefined && !deps.isPluginPanelPluginId(pluginId)) return { ok: false, error: 'invalid_request' }
    return { ok: true, value: { removed: deps.getPluginFeedController()?.clear(pluginId) ?? 0 } }
  })
  deps.ipcMain.handle(IPC_CHANNELS.pluginSkinFallbackNotify, (event, petIds: unknown) => {
    deps.assertTrustedIpcSender(event)
    if (!Array.isArray(petIds) || petIds.length > 250 || petIds.some(petId => !deps.isPluginSkinPetId(petId))) return 0
    const currentlyEnabled = deps.getEnabledPluginSkinIds()
    const pendingFallbacks = deps.getPendingSkinFallbacks()
    let added = 0
    for (const petId of new Set(petIds as string[])) {
      const info = pendingFallbacks.get(petId)
      if (!info) continue
      if (currentlyEnabled.has(petId)) {
        pendingFallbacks.delete(petId)
        continue
      }
      pendingFallbacks.delete(petId)
      const copy = deps.fallbackCopy(info)
      if (deps.addSystemNotification(info.pluginId, info.pluginName, copy.title, copy.body)) added += 1
    }
    if (added > 0) deps.broadcastUnreadCount()
    return added
  })
  deps.ipcMain.handle(IPC_CHANNELS.pluginFeedOpenLink, async (event, itemId: unknown) => {
    deps.assertTrustedIpcSender(event)
    if (typeof itemId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(itemId)) return false
    const item = deps.getPluginFeedController()?.listNotifications().find(record => record.item.id === itemId)?.item
    if (!item?.link || !deps.hasPluginContext(item.pluginId)) return false
    let url: URL
    try { url = new URL(item.link) } catch { return false }
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !deps.isPluginLinkHostAllowed(item.pluginId, url.hostname.toLowerCase())) return false
    try {
      await deps.openExternal(url.href)
      return true
    } catch {
      return false
    }
  })
}
