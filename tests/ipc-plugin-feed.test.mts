import assert from 'node:assert/strict'
import test from 'node:test'
import { IPC_CHANNELS } from '../electron/ipc/channels.ts'
import { registerPluginFeedIpc } from '../electron/ipc/plugin-feed.ts'

test('plugin feed IPC keeps pet and panel sender scopes and bounded payload checks', async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const trusted: Array<unknown> = []
  const panelWindow = { id: 'panel' }
  const petWindow = { id: 'pet' }
  const completed: string[] = []
  const opened: string[] = []
  const notifications: string[] = []
  const pendingFallbacks = new Map([['plugin-skin:plugin-a:blue-cat', {
    pluginId: 'plugin-a',
    pluginName: { 'zh-TW': '範例', 'en-US': 'Example' },
    skinName: { 'zh-TW': '藍貓', 'en-US': 'Blue Cat' },
  }]])
  const feed = {
    unreadCount: () => 3,
    complete: (id: string) => { completed.push(id); return true },
    listNotifications: () => [{ item: { id: 'feed-item-123', pluginId: 'plugin-a', link: 'https://example.test/report' } }],
    markRead: (id: string) => id === 'feed-item-123',
    markAllRead: (pluginId?: string) => pluginId === undefined ? 7 : 2,
    clear: (pluginId?: string) => pluginId === undefined ? 4 : 1,
  }
  const badges = { list: () => [{ id: 'badge' }] }
  const eventSource = { list: () => [{ id: 'source' }] }
  registerPluginFeedIpc({
    ipcMain: { handle: (channel, handler) => { handlers.set(channel, handler) } },
    assertTrustedIpcSender: (event, window) => trusted.push({ event, window }),
    assertPluginPanelSender: event => trusted.push({ event, panelApi: true }),
    getPetWindow: () => petWindow,
    getPanelWindow: () => panelWindow,
    getPluginFeedController: () => feed as never,
    getPluginBadgeController: () => badges as never,
    getPluginEventSourceController: () => eventSource as never,
    isPluginPanelPluginId: value => typeof value === 'string' && value === 'plugin-a',
    isPluginSkinPetId: value => typeof value === 'string' && value.startsWith('plugin-skin:'),
    getPendingSkinFallbacks: () => pendingFallbacks,
    getEnabledPluginSkinIds: () => new Set<string>(),
    fallbackCopy: () => ({ title: 'Fallback', body: 'Plugin skin changed' }),
    addSystemNotification: (pluginId, _pluginName, title, body) => {
      notifications.push(`${pluginId}:${title}:${body}`)
      return true
    },
    broadcastUnreadCount: () => notifications.push('unread:changed'),
    hasPluginContext: pluginId => pluginId === 'plugin-a',
    isPluginLinkHostAllowed: (pluginId, host) => pluginId === 'plugin-a' && host === 'example.test',
    openExternal: async url => { opened.push(url) },
  })
  const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)?.({}, ...args)

  assert.deepEqual([...handlers.keys()], [
    IPC_CHANNELS.pluginFeedUnreadCount,
    IPC_CHANNELS.pluginBadgesGet,
    IPC_CHANNELS.pluginEventSourceList,
    IPC_CHANNELS.pluginFeedComplete,
    IPC_CHANNELS.pluginNotificationsList,
    IPC_CHANNELS.pluginNotificationsRead,
    IPC_CHANNELS.pluginNotificationsReadAll,
    IPC_CHANNELS.pluginNotificationsClear,
    IPC_CHANNELS.pluginSkinFallbackNotify,
    IPC_CHANNELS.pluginFeedOpenLink,
  ])
  assert.equal(await invoke(IPC_CHANNELS.pluginFeedUnreadCount), 3)
  assert.deepEqual(await invoke(IPC_CHANNELS.pluginBadgesGet), [{ id: 'badge' }])
  assert.deepEqual(await invoke(IPC_CHANNELS.pluginEventSourceList), [{ id: 'source' }])
  assert.equal(await invoke(IPC_CHANNELS.pluginFeedComplete, 'short'), false)
  assert.equal(await invoke(IPC_CHANNELS.pluginFeedComplete, 'feed-item-123'), true)
  assert.deepEqual(completed, ['feed-item-123'])
  assert.deepEqual(await invoke(IPC_CHANNELS.pluginNotificationsList), {
    ok: true,
    value: [{ item: { id: 'feed-item-123', pluginId: 'plugin-a', link: 'https://example.test/report' } }],
  })
  assert.deepEqual(await invoke(IPC_CHANNELS.pluginNotificationsRead, 'feed-item-123'), { ok: true, value: { read: true } })
  assert.deepEqual(await invoke(IPC_CHANNELS.pluginNotificationsReadAll), { ok: true, value: { marked: 7 } })
  assert.deepEqual(await invoke(IPC_CHANNELS.pluginNotificationsReadAll, 'plugin-a'), { ok: true, value: { marked: 2 } })
  assert.deepEqual(await invoke(IPC_CHANNELS.pluginNotificationsReadAll, { bad: true }), { ok: false, error: 'invalid_request' })
  assert.deepEqual(await invoke(IPC_CHANNELS.pluginNotificationsClear), { ok: true, value: { removed: 4 } })
  assert.equal(await invoke(IPC_CHANNELS.pluginSkinFallbackNotify, ['plugin-skin:plugin-a:blue-cat']), 1)
  assert.deepEqual(notifications, [
    'plugin-a:Fallback:Plugin skin changed',
    'unread:changed',
  ])
  assert.equal(pendingFallbacks.size, 0)
  assert.equal(await invoke(IPC_CHANNELS.pluginFeedOpenLink, 'feed-item-123'), true)
  assert.deepEqual(opened, ['https://example.test/report'])
  assert.equal(await invoke(IPC_CHANNELS.pluginFeedOpenLink, 'bad'), false)
  assert.equal(trusted.length, 14)
  assert.deepEqual(trusted[1], { event: {}, window: petWindow })
  assert.deepEqual(trusted[2], { event: {}, window: panelWindow })
})

test('plugin badges can be read by the pet and by the panel (dashboard plugin tabs), nobody else', async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const panelContents = { id: 'panel-wc' }
  const petContents = { id: 'pet-wc' }
  const panelWindow = { webContents: panelContents }
  const petWindow = { webContents: petContents }
  registerPluginFeedIpc({
    ipcMain: { handle: (channel, handler) => { handlers.set(channel, handler) } },
    assertTrustedIpcSender: (event, window) => {
      if ((event as { sender: unknown }).sender !== (window as { webContents: unknown } | null)?.webContents) throw new Error('Unauthorized IPC sender')
    },
    getPetWindow: () => petWindow,
    getPanelWindow: () => panelWindow,
    getPluginBadgeController: () => ({ list: () => [{ id: 'badge' }] }) as never,
  } as never)
  const get = handlers.get(IPC_CHANNELS.pluginBadgesGet)!
  assert.deepEqual(await get({ sender: petContents }), [{ id: 'badge' }])
  assert.deepEqual(await get({ sender: panelContents }), [{ id: 'badge' }])
  assert.throws(() => get({ sender: { id: 'plugin-view' } }), /Unauthorized/)
})
