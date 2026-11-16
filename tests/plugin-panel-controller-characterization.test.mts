// 階段 10 拆分 usePluginPanelController 前先固定的行為：在 Node 掛載真的控制器（假 IPC、假 DOM、
// 假計時器），拆分前後同一組斷言都要通過。全部用假計時器，不依賴真實時間。
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { isProxy, isRef } from 'vue'
import {
  FakeHTMLElement,
  FakeResizeObserver,
  deferred,
  fail,
  mountPluginPanel,
  ok,
  plugin,
  snapshotOf,
  unmountLeftover,
  type PluginPanelHarness,
} from './support/plugin-panel-harness.mts'
import { t, tPlural, type TranslationKey } from '../src/i18n.ts'
import type { PluginCatalogPanelItem } from '../src/types/plugin-catalog.ts'
import type { PluginErrorCode } from '../src/types/plugin.ts'

afterEach(() => unmountLeftover())

const SECRET = 'sk-test-0123456789'

function toastTexts(harness: PluginPanelHarness): string {
  return JSON.stringify(harness.controller.toasts.value)
}

function frameElements(harness: PluginPanelHarness) {
  const scroll = new FakeHTMLElement('settings-content')
  scroll.scrollTop = 240
  const frame = new FakeHTMLElement('frame', { left: 10, top: 20, width: 400, height: 500 }, scroll)
  const content = new FakeHTMLElement('content', { left: 12, top: 60, width: 396, height: 450 })
  harness.controller.panelViewFrame.value = frame as unknown as HTMLElement
  harness.controller.panelViewContent.value = content as unknown as HTMLElement
  return { scroll, frame, content }
}

async function openDetailWithSettings(harness: PluginPanelHarness, pluginId = 'alpha'): Promise<void> {
  harness.controller.openPluginDetail(pluginId, 'settings')
  await harness.flush()
}

// --- 對外 API -----------------------------------------------------------------

const EXPECTED_API: Record<string, string> = {
  busy: 'ref', catalogCheckComplete: 'ref', catalogError: 'ref', catalogItemFor: 'function', catalogItems: 'ref',
  catalogLoadedAt: 'ref', catalogSearch: 'ref', catalogUrlDraft: 'ref', clearNotifications: 'function',
  closePluginDetail: 'function', closePluginPanelView: 'function', commandTitle: 'function',
  confirmDiscardSettings: 'function', confirmInstall: 'function', confirmRemove: 'function', confirmReport: 'function',
  confirmSecretConsent: 'function', dailyUpdateCheck: 'ref', detailPlugin: 'ref', detailPluginId: 'ref',
  detailSection: 'ref', diagnosticCodeLabel: 'function', diagnosticTechnical: 'function', diagnosticTime: 'function',
  diagnostics: 'ref', dismissToast: 'function', displayFingerprint: 'function', enabledGlobally: 'ref',
  ensureCatalogLoaded: 'function', eventSourceStatuses: 'ref', failedPluginIconIds: 'ref', filteredCatalogItems: 'ref',
  filteredPlugins: 'ref', handlePluginPanelViewClosed: 'function', hasCompatiblePlan: 'ref', hidePluginIcon: 'function',
  installAcknowledgements: 'ref', installCatalogPlugin: 'function', installedFilter: 'ref', installedSearch: 'ref',
  invokePluginCommand: 'function', invokingCommandId: 'ref', isBusy: 'function', keepData: 'ref', liveBadges: 'ref',
  loadPetOptions: 'function', loadPluginCatalog: 'function', loading: 'ref', localizedError: 'function', logs: 'ref',
  markAllNotificationsRead: 'function', markNotificationRead: 'function', notificationSource: 'function',
  notificationTime: 'function', notifications: 'ref', notify: 'function', onlineCatalogEnabled: 'ref',
  openNotificationLink: 'function', openPluginDetail: 'function', openPluginDetailFromPanel: 'function',
  openPluginPanelView: 'function', panelViewBoundsObserver: 'null', panelViewContent: 'ref', panelViewError: 'ref',
  panelViewFrame: 'ref', panelViewMaximized: 'ref', panelViewOpenToken: 'ref', panelViewPlugin: 'ref',
  panelViewPluginId: 'ref', panelViewRequestSequence: 'number', pendingLeave: 'ref', pendingPermissionSections: 'ref',
  pendingPlan: 'ref', pendingPluginName: 'ref', pendingRemove: 'ref', pendingReportPluginId: 'ref',
  pendingSecretConsentKey: 'ref', pendingSecretRemoveKey: 'ref', permissionHint: 'function', permissionLabel: 'function',
  petOptions: 'ref', planKindLabel: 'function', pluginBusy: 'function', pluginIconUrl: 'function', pluginName: 'function',
  pluginSettings: 'ref', pluginStatusLabel: 'function', pluginStatusTone: 'function', plugins: 'ref',
  readPluginPanelViewBounds: 'function', refreshDiagnostics: 'function', refreshNotifications: 'function',
  refreshPanel: 'function', refreshPluginSettings: 'function', reloadPluginPanelView: 'function',
  removeNotificationsListener: 'null', removePanelClosedListener: 'null', removePluginSecret: 'function',
  reportPluginIssue: 'function', requestRemove: 'function', requestReport: 'function', resetSettingsDraft: 'function',
  resetSettingsToDefaults: 'function', resourceBoundText: 'function', resourceFields: 'array',
  resourceInputValue: 'function', restoreCatalogUrl: 'function', revokeGrantedHost: 'function',
  runToastAction: 'function', saveCatalogUrl: 'function', savePluginSecret: 'function', savePluginSettings: 'function',
  secretDrafts: 'ref', selectArchive: 'function', selectDeveloperFolder: 'function', selectedPlugin: 'ref',
  selectedPluginId: 'ref', sendPluginPanelViewBounds: 'function', setError: 'function', setStatus: 'function',
  settingTitle: 'function', settingValue: 'function', settingsDirty: 'ref', settingsDraft: 'ref', settingsErrors: 'ref',
  snapshot: 'ref', toasts: 'ref', togglePluginPanelViewMaximized: 'function', updateAllCatalogPlugins: 'function',
  updateGlobalPreferences: 'function', updatePluginPreference: 'function', updatePluginRate: 'function',
  updatePluginTarget: 'function', updateQueue: 'ref', updateResourceLimit: 'function', updateSetting: 'function',
  visibleNotifications: 'ref',
}

test('the controller exposes exactly the same members with the same kinds', async () => {
  const harness = await mountPluginPanel()
  const controller = harness.controller as unknown as Record<string, unknown>
  const kinds = Object.fromEntries(Object.keys(controller).sort().map(key => {
    const value = controller[key]
    const kind = isRef(value) ? 'ref' : typeof value === 'function' ? 'function' : value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
    return [key, kind]
  }))
  assert.deepEqual(kinds, EXPECTED_API)
  // 這四個欄位一直是回傳當下的初始值（不是 ref），元件不讀它們；保留原樣。
  assert.equal(controller.removeNotificationsListener, null)
  assert.equal(controller.removePanelClosedListener, null)
  assert.equal(controller.panelViewBoundsObserver, null)
  assert.equal(controller.panelViewRequestSequence, 0)
  assert.deepEqual(harness.controller.resourceFields.map(field => field.key), [
    'maxEnabledPlugins', 'memoryMbPerPlugin', 'netMaxResponseBytes', 'netTimeoutSeconds',
    'netRequestsPerMinute', 'storageBytesPerPlugin', 'globalFeedPer10Min', 'scheduleMinIntervalSeconds',
  ])
})

// --- 掛載與事件訂閱清理 ---------------------------------------------------------

test('mounting loads the panel once and subscribes; unmounting removes every listener', async () => {
  const harness = await mountPluginPanel()
  assert.equal(harness.callsOf('getPluginPanelSnapshot').length, 1)
  assert.equal(harness.callsOf('listPluginNotifications').length, 1)
  assert.equal(harness.callsOf('loadPets').length, 1)
  assert.equal(harness.liveSubscriptions(), 4)
  assert.deepEqual(
    harness.calls.filter(call => call.name.startsWith('on')).map(call => call.name).sort(),
    ['onPluginBadgesChanged', 'onPluginEventSourceChanged', 'onPluginNotificationsChanged', 'onPluginPanelViewClosed'],
  )
  assert.equal(harness.window.count('keydown'), 1)
  assert.equal(harness.controller.loading.value, false)
  harness.unmount()
  assert.equal(harness.liveSubscriptions(), 0)
  assert.equal(harness.window.count('keydown'), 0)
})

test('unmounting with an open panel view closes it and stops watching its bounds', async () => {
  const harness = await mountPluginPanel({ api: { openPluginPanelView: () => Promise.resolve(ok({ openToken: 42 })) } })
  frameElements(harness)
  await harness.controller.openPluginPanelView('alpha')
  await harness.flush()
  assert.equal(harness.controller.panelViewOpenToken.value, 42)
  assert.equal(harness.window.count('resize'), 1)
  assert.equal(harness.window.count('scroll'), 1)
  const observer = FakeResizeObserver.instances.at(-1)
  assert.ok(observer && !observer.disconnected)
  harness.unmount()
  assert.deepEqual(harness.callsOf('closePluginPanelView').map(call => call.args), [[42]])
  assert.equal(observer.disconnected, true)
  assert.equal(harness.window.count('resize'), 0)
  assert.equal(harness.window.count('scroll'), 0)
})

test('pushed badge, event-source and notification changes update the panel', async () => {
  let notifications: unknown[] = []
  const harness = await mountPluginPanel({ api: { listPluginNotifications: () => Promise.resolve(ok(notifications)) } })
  harness.emit('onPluginBadgesChanged', [{ pluginId: 'alpha', text: '3' }])
  harness.emit('onPluginEventSourceChanged', [{ pluginId: 'alpha', state: 'working' }])
  assert.deepEqual(harness.controller.liveBadges.value, [{ pluginId: 'alpha', text: '3' }])
  assert.deepEqual(harness.controller.eventSourceStatuses.value, [{ pluginId: 'alpha', state: 'working' }])
  notifications = [notification('n1', 'alpha')]
  harness.emit('onPluginNotificationsChanged')
  await harness.flush()
  assert.deepEqual(harness.controller.notifications.value.map(record => record.item.id), ['n1'])
})

// --- 未儲存設定的離開確認 -------------------------------------------------------

test('leaving a dirty settings form waits for confirmation, then discards the draft', async () => {
  const harness = await mountPluginPanel()
  const { controller } = harness
  await openDetailWithSettings(harness)
  assert.equal(controller.detailPluginId.value, 'alpha')
  assert.deepEqual(harness.callsOf('getPluginSettings').map(call => call.args), [['alpha']])
  assert.deepEqual(controller.settingsDraft.value, { city: 'Tainan', count: 2 })
  assert.equal(controller.settingsDirty.value, false)

  controller.updateSetting('city', 'string', 'Kaohsiung')
  assert.equal(controller.settingsDirty.value, true)
  controller.openPluginDetail('beta')
  assert.notEqual(controller.pendingLeave.value, null)
  assert.equal(controller.detailPluginId.value, 'alpha')
  assert.equal(controller.selectedPluginId.value, 'alpha')

  // 取消：元件直接把 pendingLeave 設回 null。
  controller.pendingLeave.value = null
  assert.equal(controller.detailPluginId.value, 'alpha')
  assert.equal(controller.settingsDraft.value.city, 'Kaohsiung')

  controller.closePluginDetail()
  assert.notEqual(controller.pendingLeave.value, null)
  controller.confirmDiscardSettings()
  assert.equal(controller.pendingLeave.value, null)
  assert.equal(controller.detailPluginId.value, '')
  assert.equal(controller.settingsDraft.value.city, 'Tainan')
})

test('switching plugins after confirming discard opens the other plugin and reloads its settings', async () => {
  const harness = await mountPluginPanel()
  const { controller } = harness
  await openDetailWithSettings(harness)
  controller.secretDrafts.value = { token: SECRET }
  assert.equal(controller.settingsDirty.value, true)
  controller.openPluginDetail('beta', 'diagnostics')
  controller.confirmDiscardSettings()
  await harness.flush()
  assert.equal(controller.detailPluginId.value, 'beta')
  assert.equal(controller.detailSection.value, 'diagnostics')
  assert.equal(controller.selectedPluginId.value, 'beta')
  assert.deepEqual(harness.callsOf('getPluginSettings').map(call => call.args), [['alpha'], ['beta']])
  assert.deepEqual(harness.callsOf('getPluginDiagnostics').map(call => call.args), [['alpha'], ['beta']])
  assert.deepEqual(controller.secretDrafts.value, { token: '' })
})

test('changing section on the same plugin never asks, even with unsaved edits', async () => {
  const harness = await mountPluginPanel()
  const { controller } = harness
  await openDetailWithSettings(harness)
  controller.updateSetting('count', 'number', '4')
  assert.equal(controller.settingsDraft.value.count, 4)
  controller.openPluginDetail('alpha', 'commands')
  assert.equal(controller.pendingLeave.value, null)
  assert.equal(controller.detailSection.value, 'commands')
  assert.equal(controller.settingsDraft.value.count, 4)
  controller.openPluginDetail('missing')
  assert.equal(controller.detailPluginId.value, 'alpha')
})

test('saving validates first, then adopts the values the main process returns', async () => {
  const harness = await mountPluginPanel({
    api: { setPluginSettings: (_id: string, values: Record<string, unknown>) => Promise.resolve(ok({ ...values, city: 'Hsinchu' })) },
  })
  const { controller } = harness
  await openDetailWithSettings(harness)
  controller.updateSetting('count', 'number', '9')
  await controller.savePluginSettings()
  assert.equal(controller.settingsErrors.value.count, 'range')
  assert.equal(harness.callsOf('setPluginSettings').length, 0)
  controller.updateSetting('count', 'number', '3')
  assert.equal(controller.settingsErrors.value.count, undefined)
  await controller.savePluginSettings()
  assert.deepEqual(harness.callsOf('setPluginSettings').map(call => call.args), [['alpha', { city: 'Tainan', count: 3 }]])
  assert.deepEqual(controller.settingsDraft.value, { city: 'Hsinchu', count: 3 })
  assert.deepEqual(controller.pluginSettings.value?.values, { city: 'Hsinchu', count: 3 })
  assert.equal(controller.settingsDirty.value, false)
  assert.equal(controller.pluginBusy('alpha'), false)
  assert.ok(controller.toasts.value.some(toast => toast.text === t('pluginSettingsSaved')))
  controller.resetSettingsToDefaults()
  assert.deepEqual(controller.settingsDraft.value, { city: 'Taipei', count: 1 })
})

// --- Secret 與 secret consent --------------------------------------------------

test('a first secret save asks for consent and sends nothing until it is accepted', async () => {
  let consented = false
  const harness = await mountPluginPanel({
    api: {
      getPluginSecretConsent: () => Promise.resolve(ok(consented)),
      acceptPluginSecretConsent: () => { consented = true; return Promise.resolve(ok(true)) },
      setPluginSecret: () => Promise.resolve(ok({ configured: true })),
    },
  })
  const { controller } = harness
  await openDetailWithSettings(harness)
  controller.secretDrafts.value = { token: SECRET }
  await controller.savePluginSecret('token')
  assert.equal(controller.pendingSecretConsentKey.value, 'token')
  assert.equal(harness.callsOf('setPluginSecret').length, 0)

  await controller.confirmSecretConsent()
  assert.equal(controller.pendingSecretConsentKey.value, '')
  assert.equal(harness.callsOf('acceptPluginSecretConsent').length, 1)
  assert.deepEqual(harness.callsOf('setPluginSecret').map(call => call.args), [['alpha', 'token', SECRET]])
  assert.deepEqual(controller.secretDrafts.value, { token: '' })
  assert.equal(controller.pluginSettings.value?.secrets.token, true)
  assert.ok(controller.toasts.value.some(toast => toast.text === t('pluginSecretSaved')))
  assert.ok(!toastTexts(harness).includes(SECRET))
})

test('a failed consent keeps the request pending and never sends the secret', async () => {
  const harness = await mountPluginPanel({
    api: {
      getPluginSecretConsent: () => Promise.resolve(ok(false)),
      acceptPluginSecretConsent: () => Promise.resolve(fail('plugin_service_unavailable')),
      setPluginSecret: () => Promise.resolve(ok({ configured: true })),
    },
  })
  const { controller } = harness
  await openDetailWithSettings(harness)
  controller.secretDrafts.value = { token: SECRET }
  await controller.savePluginSecret('token')
  await controller.confirmSecretConsent()
  assert.equal(controller.pendingSecretConsentKey.value, 'token')
  assert.equal(harness.callsOf('setPluginSecret').length, 0)
  assert.ok(controller.toasts.value.some(toast => toast.tone === 'error' && toast.text === t('pluginServiceUnavailable')))
  assert.ok(!toastTexts(harness).includes(SECRET))
  // 元件以 pendingSecretConsentKey = '' 取消對話框。
  controller.pendingSecretConsentKey.value = ''
  await controller.confirmSecretConsent()
  assert.equal(harness.callsOf('acceptPluginSecretConsent').length, 1)
})

test('with consent already given the secret is saved directly, and a save error never echoes it', async () => {
  const harness = await mountPluginPanel({
    api: {
      getPluginSecretConsent: () => Promise.resolve(ok(true)),
      setPluginSecret: () => Promise.resolve(fail('secret_unavailable')),
    },
  })
  const { controller } = harness
  await openDetailWithSettings(harness)
  controller.secretDrafts.value = { token: SECRET }
  await controller.savePluginSecret('token')
  assert.equal(controller.pendingSecretConsentKey.value, '')
  assert.deepEqual(harness.callsOf('setPluginSecret').map(call => call.args), [['alpha', 'token', SECRET]])
  // 失敗時保留草稿讓使用者重試，但錯誤訊息只有錯誤碼。
  assert.equal(controller.secretDrafts.value.token, SECRET)
  const error = controller.toasts.value.find(toast => toast.tone === 'error')
  assert.equal(error?.text, t('pluginSecretUnavailable'))
  assert.equal(error?.detail, 'secret_unavailable')
  assert.ok(!toastTexts(harness).includes(SECRET))
})

test('an empty secret save skips the consent check; removing a secret clears it after confirmation', async () => {
  const harness = await mountPluginPanel({
    api: { setPluginSecret: () => Promise.resolve(ok({ configured: false })) },
  })
  const { controller } = harness
  await openDetailWithSettings(harness)
  await controller.savePluginSecret('token')
  assert.equal(harness.callsOf('getPluginSecretConsent').length, 0)
  controller.pendingSecretRemoveKey.value = 'token'
  await controller.removePluginSecret('token')
  assert.equal(controller.pendingSecretRemoveKey.value, '')
  assert.deepEqual(harness.callsOf('setPluginSecret').map(call => call.args), [['alpha', 'token', ''], ['alpha', 'token', '']])
  assert.equal(controller.pluginSettings.value?.secrets.token, false)
  assert.ok(controller.toasts.value.some(toast => toast.text === t('plugins.secretRemoved')))
})

test('a busy plugin scope drops a second save instead of sending it twice', async () => {
  const pending = deferred<ReturnType<typeof ok<Record<string, string | number>>>>()
  const harness = await mountPluginPanel({ api: { setPluginSettings: () => pending.promise } })
  const { controller } = harness
  await openDetailWithSettings(harness)
  const first = controller.savePluginSettings()
  assert.equal(controller.pluginBusy('alpha'), true)
  assert.equal(controller.busy.value, false)
  await controller.savePluginSettings()
  assert.equal(harness.callsOf('setPluginSettings').length, 1)
  pending.resolve(ok({ city: 'Tainan', count: 2 }))
  await first
  assert.equal(controller.pluginBusy('alpha'), false)
})

// --- 非同步回應競態 -------------------------------------------------------------

test('a stale panel-view open result is closed instead of replacing the newer panel', async () => {
  const opens = new Map<string, ReturnType<typeof deferred<ReturnType<typeof ok<{ openToken: number }>>>>>()
  const harness = await mountPluginPanel({
    api: {
      openPluginPanelView: (pluginId: string) => {
        const pending = deferred<ReturnType<typeof ok<{ openToken: number }>>>()
        opens.set(pluginId, pending)
        return pending.promise
      },
    },
  })
  const { controller } = harness
  frameElements(harness)
  const first = controller.openPluginPanelView('alpha')
  await harness.flush()
  const second = controller.openPluginPanelView('beta')
  await harness.flush()
  opens.get('beta')?.resolve(ok({ openToken: 8 }))
  await second
  opens.get('alpha')?.resolve(ok({ openToken: 7 }))
  await first
  assert.equal(controller.panelViewPluginId.value, 'beta')
  assert.equal(controller.panelViewOpenToken.value, 8)
  assert.deepEqual(harness.callsOf('closePluginPanelView').map(call => call.args), [[7]])
})

test('a close event for an older panel token is ignored', async () => {
  const harness = await mountPluginPanel({ api: { openPluginPanelView: () => Promise.resolve(ok({ openToken: 5 })) } })
  const { controller } = harness
  frameElements(harness)
  await controller.openPluginPanelView('alpha')
  harness.emit('onPluginPanelViewClosed', { pluginId: 'alpha', openToken: 4, reason: 'renderer_crashed' })
  assert.equal(controller.panelViewOpenToken.value, 5)
  assert.equal(controller.panelViewError.value, '')
  harness.emit('onPluginPanelViewClosed', { pluginId: 'alpha', openToken: 5, reason: 'renderer_crashed' })
  assert.equal(controller.panelViewOpenToken.value, 0)
  assert.equal(controller.panelViewPluginId.value, 'alpha')
  assert.equal(controller.panelViewError.value, 'panel_crashed')
})

test('an older settings response cannot overwrite the plugin that is now selected', async () => {
  const loads = new Map<string, ReturnType<typeof deferred<unknown>>>()
  const harness = await mountPluginPanel({
    api: {
      getPluginSettings: (pluginId: string) => {
        const pending = deferred<unknown>()
        loads.set(pluginId, pending)
        return pending.promise
      },
    },
  })
  const { controller } = harness
  controller.openPluginDetail('alpha', 'settings')
  await harness.flush()
  controller.openPluginDetail('beta', 'settings')
  await harness.flush()
  loads.get('beta')?.resolve(ok({ values: { city: 'Beta City', count: 3 }, secrets: { token: true } }))
  await harness.flush()
  loads.get('alpha')?.resolve(ok({ values: { city: 'Alpha City', count: 1 }, secrets: { token: false } }))
  await harness.flush()
  assert.equal(controller.selectedPluginId.value, 'beta')
  assert.deepEqual(controller.settingsDraft.value, { city: 'Beta City', count: 3 })
  assert.deepEqual(controller.pluginSettings.value?.secrets, { token: true })
})

test('an older diagnostics response cannot overwrite the plugin that is now selected', async () => {
  const loads = new Map<string, ReturnType<typeof deferred<unknown>>>()
  const harness = await mountPluginPanel({
    api: {
      getPluginDiagnostics: (pluginId: string) => {
        const pending = deferred<unknown>()
        loads.set(pluginId, pending)
        return pending.promise
      },
    },
  })
  const { controller } = harness
  controller.openPluginDetail('alpha', 'diagnostics')
  await harness.flush()
  controller.openPluginDetail('beta', 'diagnostics')
  await harness.flush()
  loads.get('beta')?.resolve(ok({ logs: [{ at: 2, level: 'info', message: 'beta' }], diagnostics: [] }))
  await harness.flush()
  loads.get('alpha')?.resolve(ok({ logs: [{ at: 1, level: 'info', message: 'alpha' }], diagnostics: [] }))
  await harness.flush()
  assert.deepEqual(controller.logs.value.map(entry => entry.message), ['beta'])
})

test('a refresh requested while one is in flight runs once more, silently, at the end', async () => {
  const snapshots: Array<ReturnType<typeof deferred<unknown>>> = []
  const harness = await mountPluginPanel({
    api: {
      getPluginPanelSnapshot: () => {
        const pending = deferred<unknown>()
        snapshots.push(pending)
        return pending.promise
      },
    },
  })
  const { controller } = harness
  assert.equal(controller.loading.value, true)
  void controller.refreshPanel()
  void controller.refreshPanel()
  assert.equal(snapshots.length, 1)
  snapshots[0].resolve(ok(snapshotOf([plugin('alpha')])))
  await harness.flush()
  assert.equal(snapshots.length, 2)
  assert.equal(controller.loading.value, false)
  snapshots[1].resolve(ok(snapshotOf([plugin('alpha'), plugin('gamma')])))
  await harness.flush()
  assert.deepEqual(controller.plugins.value.map(item => item.id), ['alpha', 'gamma'])
  assert.equal(snapshots.length, 2)
})

test('a refresh that drops the open detail plugin closes the detail view', async () => {
  let current = snapshotOf([plugin('alpha'), plugin('beta')])
  const harness = await mountPluginPanel({ api: { getPluginPanelSnapshot: () => Promise.resolve(ok(structuredClone(current))) } })
  const { controller } = harness
  await openDetailWithSettings(harness, 'beta')
  current = snapshotOf([plugin('alpha')])
  await controller.refreshPanel()
  assert.equal(controller.detailPluginId.value, '')
  assert.equal(controller.selectedPluginId.value, '')
})

// --- 原生 panel view 開關、放大與焦點還原 ----------------------------------------

test('opening sends the frame bounds, watches them, and closing restores focus', async () => {
  const harness = await mountPluginPanel({ api: { openPluginPanelView: () => Promise.resolve(ok({ openToken: 11 })) } })
  const { controller } = harness
  const trigger = new FakeHTMLElement('open-button')
  harness.document.activeElement = trigger
  frameElements(harness)
  await controller.openPluginPanelView('alpha')
  await harness.flush()
  assert.equal(controller.selectedPluginId.value, 'alpha')
  assert.equal(controller.panelViewPlugin.value?.id, 'alpha')
  assert.deepEqual(harness.callsOf('openPluginPanelView').map(call => call.args), [[
    'alpha', { x: 10, y: 20, width: 400, height: 500 }, { x: 12, y: 60, width: 396, height: 450 },
  ]])
  assert.ok(harness.callsOf('setPluginPanelViewBounds').length >= 1)
  assert.deepEqual(harness.callsOf('setPluginPanelViewBounds').at(-1)?.args, [
    11, { x: 10, y: 20, width: 400, height: 500 }, { x: 12, y: 60, width: 396, height: 450 }, { width: 460, height: 720 },
  ])
  const observer = FakeResizeObserver.instances.at(-1)
  assert.equal(observer?.observed.length, 2)

  harness.document.activeElement = null
  controller.closePluginPanelView()
  await harness.flush()
  assert.equal(controller.panelViewPluginId.value, '')
  assert.equal(controller.panelViewOpenToken.value, 0)
  assert.deepEqual(harness.callsOf('closePluginPanelView').map(call => call.args), [[11]])
  assert.equal(trigger.focusCount, 1)
  assert.equal(observer?.disconnected, true)
  assert.equal(harness.window.count('resize'), 0)
})

test('opening a disabled or missing panel reports an error and opens nothing', async () => {
  const harness = await mountPluginPanel({ snapshot: snapshotOf([plugin('alpha', { enabled: false }), plugin('beta', { panelView: false })]) })
  const { controller } = harness
  await controller.openPluginPanelView('alpha')
  await controller.openPluginPanelView('beta')
  assert.equal(harness.callsOf('openPluginPanelView').length, 0)
  assert.equal(controller.panelViewPluginId.value, '')
  assert.ok(controller.toasts.value.some(toast => toast.text === t('pluginPanelUnavailable')))
})

test('a frame with no size reports panel_unavailable instead of opening', async () => {
  const harness = await mountPluginPanel()
  const { controller } = harness
  await controller.openPluginPanelView('alpha')
  assert.equal(controller.panelViewPluginId.value, '')
  assert.equal(harness.callsOf('openPluginPanelView').length, 0)
  assert.ok(controller.toasts.value.some(toast => toast.text === t('pluginPanelViewUnavailable')))
})

test('a failed open keeps the frame with the error so the user can reload or go back', async () => {
  const harness = await mountPluginPanel({ api: { openPluginPanelView: () => Promise.resolve(fail('panel_load_failed')) } })
  const { controller } = harness
  frameElements(harness)
  await controller.openPluginPanelView('alpha')
  assert.equal(controller.panelViewPluginId.value, 'alpha')
  assert.equal(controller.panelViewError.value, 'panel_load_failed')
  controller.reloadPluginPanelView()
  await harness.flush()
  assert.equal(harness.callsOf('openPluginPanelView').length, 2)
})

test('Escape restores a maximized panel first, then closes it, but yields to an open dialog', async () => {
  const harness = await mountPluginPanel({ api: { openPluginPanelView: () => Promise.resolve(ok({ openToken: 3 })) } })
  const { controller } = harness
  const { scroll } = frameElements(harness)
  await controller.openPluginPanelView('alpha')
  await harness.flush()
  controller.togglePluginPanelViewMaximized()
  assert.equal(controller.panelViewMaximized.value, true)
  assert.deepEqual(harness.callsOf('resizePanel').map(call => call.args), [[932, 1500]])
  scroll.scrollTop = 0

  const escape = () => {
    const event = { key: 'Escape', defaultPrevented: false, prevented: false, stopped: false,
      preventDefault() { this.prevented = true }, stopPropagation() { this.stopped = true } }
    harness.window.dispatch('keydown', event)
    return event
  }
  harness.document.modalOpen = true
  assert.equal(escape().prevented, false)
  assert.equal(controller.panelViewMaximized.value, true)
  harness.document.modalOpen = false

  assert.equal(escape().prevented, true)
  await harness.flush()
  assert.equal(controller.panelViewMaximized.value, false)
  assert.deepEqual(harness.callsOf('resizePanel').at(-1)?.args, [{ release: true }])
  assert.equal(scroll.scrollTop, 240)
  assert.equal(controller.panelViewPluginId.value, 'alpha')

  assert.equal(escape().prevented, true)
  await harness.flush()
  assert.equal(controller.panelViewPluginId.value, '')
  assert.deepEqual(harness.callsOf('closePluginPanelView').map(call => call.args), [[3]])
})

test('a hidden close event clears the frame; selecting another plugin closes the panel', async () => {
  const harness = await mountPluginPanel({ api: { openPluginPanelView: () => Promise.resolve(ok({ openToken: 9 })) } })
  const { controller } = harness
  frameElements(harness)
  await controller.openPluginPanelView('alpha')
  harness.emit('onPluginPanelViewClosed', { pluginId: 'alpha', openToken: 9, reason: 'hidden' })
  assert.equal(controller.panelViewPluginId.value, '')
  assert.equal(harness.callsOf('closePluginPanelView').length, 0)

  await controller.openPluginPanelView('alpha')
  await harness.flush()
  controller.selectedPluginId.value = 'beta'
  await harness.flush()
  assert.equal(controller.panelViewPluginId.value, '')
  assert.deepEqual(harness.callsOf('closePluginPanelView').map(call => call.args), [[9]])
})

test('the panel frame link closes the panel and opens the plugin detail', async () => {
  const harness = await mountPluginPanel({ api: { openPluginPanelView: () => Promise.resolve(ok({ openToken: 6 })) } })
  const { controller } = harness
  frameElements(harness)
  await controller.openPluginPanelView('beta')
  controller.openPluginDetailFromPanel()
  assert.equal(controller.panelViewPluginId.value, '')
  assert.equal(controller.detailPluginId.value, 'beta')
  assert.equal(controller.detailSection.value, 'overview')
})

test('a panel request from props opens once per nonce and an empty request closes the panel', async () => {
  const harness = await mountPluginPanel({
    props: { requestedPluginId: 'alpha', requestNonce: 1001 },
    api: { openPluginPanelView: () => Promise.resolve(ok({ openToken: 21 })) },
  })
  // 掛載時 frame 還沒出現，第一次開啟以 panel_unavailable 結束；同一個序號不會重播。
  assert.equal(harness.callsOf('openPluginPanelView').length, 0)
  frameElements(harness)
  harness.props.requestNonce = 1001
  await harness.flush()
  assert.equal(harness.callsOf('openPluginPanelView').length, 0)
  harness.props.requestNonce = 1002
  await harness.flush()
  assert.equal(harness.callsOf('openPluginPanelView').length, 1)
  assert.equal(harness.controller.panelViewOpenToken.value, 21)
  harness.props.requestedPluginId = undefined
  harness.props.requestNonce = 1003
  await harness.flush()
  assert.equal(harness.controller.panelViewPluginId.value, '')
})

// --- 通知 -------------------------------------------------------------------

function notification(id: string, pluginId: string, read = false) {
  return {
    item: {
      id, pluginId, pluginName: { 'zh-TW': pluginId, 'en-US': pluginId }, title: id, body: '',
      priority: 'normal' as const, createdAt: 1, expiresAt: 2,
    },
    read,
  }
}

test('clearing notifications hides them, can be undone, and commits after five seconds', async () => {
  let records = [notification('n1', 'alpha'), notification('n2', 'beta')]
  const harness = await mountPluginPanel({
    api: {
      listPluginNotifications: () => Promise.resolve(ok(records)),
      clearPluginNotifications: () => { records = []; return Promise.resolve(ok(true)) },
    },
  })
  const { controller } = harness
  await controller.clearNotifications('alpha')
  assert.deepEqual(controller.visibleNotifications.value.map(record => record.item.id), ['n2'])
  const undo = controller.toasts.value.find(toast => toast.action)
  assert.ok(undo)
  controller.runToastAction(undo.id)
  assert.equal(controller.visibleNotifications.value.length, 2)
  harness.tick(6000)
  await harness.flush()
  assert.equal(harness.callsOf('clearPluginNotifications').length, 0)

  await controller.clearNotifications()
  assert.equal(controller.visibleNotifications.value.length, 0)
  harness.tick(5000)
  await harness.flush()
  assert.deepEqual(harness.callsOf('clearPluginNotifications').map(call => call.args), [[undefined]])
  assert.equal(controller.notifications.value.length, 0)
})

test('a pending clear is committed when the panel unmounts and leaves no timer behind', async () => {
  const harness = await mountPluginPanel({
    api: {
      listPluginNotifications: () => Promise.resolve(ok([notification('n1', 'alpha')])),
      clearPluginNotifications: () => Promise.resolve(ok(true)),
    },
  })
  await harness.controller.clearNotifications()
  assert.ok(harness.liveTimers() > 0)
  harness.unmount()
  assert.equal(harness.callsOf('clearPluginNotifications').length, 1)
  assert.equal(harness.liveTimers(), 0)
})

test('mark-all-read sends one request only when something is unread', async () => {
  let records = [notification('n1', 'alpha', true), notification('n2', 'beta')]
  const harness = await mountPluginPanel({
    api: {
      listPluginNotifications: () => Promise.resolve(ok(records)),
      markAllPluginNotificationsRead: () => { records = records.map(record => ({ ...record, read: true })); return Promise.resolve(ok(true)) },
    },
  })
  const { controller } = harness
  await controller.markAllNotificationsRead('alpha')
  assert.equal(harness.callsOf('markAllPluginNotificationsRead').length, 0)
  await controller.markAllNotificationsRead()
  assert.deepEqual(harness.callsOf('markAllPluginNotificationsRead').map(call => call.args), [[undefined]])
  assert.ok(controller.notifications.value.every(record => record.read))
  assert.equal(controller.notificationSource(records[0]), '插件 alpha')
})

// --- 清單、文字與查表 -----------------------------------------------------------

test('the installed list puts plugins that need attention first and filters by state and text', async () => {
  const crashed = { ...plugin('crashy'), status: 'disabled_crashed' as const }
  const harness = await mountPluginPanel({ snapshot: snapshotOf([plugin('alpha'), plugin('beta', { enabled: false }), crashed]) })
  const { controller } = harness
  assert.deepEqual(controller.filteredPlugins.value.map(item => item.id), ['crashy', 'alpha', 'beta'])
  controller.installedFilter.value = 'enabled'
  assert.deepEqual(controller.filteredPlugins.value.map(item => item.id), ['crashy', 'alpha'])
  controller.installedFilter.value = 'issues'
  assert.deepEqual(controller.filteredPlugins.value.map(item => item.id), ['crashy'])
  controller.installedFilter.value = 'updates'
  assert.deepEqual(controller.filteredPlugins.value.map(item => item.id), [])
  controller.catalogItems.value = [catalogItem('beta', true), catalogItem('alpha', false)]
  assert.deepEqual(controller.filteredPlugins.value.map(item => item.id), ['beta'])
  assert.equal(controller.catalogItemFor('alpha'), controller.catalogItems.value[1])
  assert.equal(controller.catalogItemFor('zzz'), undefined)
  controller.installedFilter.value = 'all'
  controller.installedSearch.value = ' BETA '
  assert.deepEqual(controller.filteredPlugins.value.map(item => item.id), ['beta'])
  assert.equal(controller.pluginStatusLabel(crashed), t('pluginStatusCrashed'))
  assert.equal(controller.pluginStatusTone(controller.plugins.value[1]), 'neutral')
})

// 複數標籤只存在 `.one`/`.other` 後綴鍵，基底名稱不是 TranslationKey，因此獨立成一個型別。
function catalogItem(id: string, updateAvailable: boolean): PluginCatalogPanelItem {
  const name = { 'zh-TW': id, 'en-US': id }
  const latestVersion = { version: '1.0.0', apiVersion: '1', url: `https://example.com/${id}.zip`, sha256: '0'.repeat(64), size: 1, publishedAt: '2026-01-01T00:00:00Z' }
  return {
    plugin: { id, name, description: name, author: 'Test', versions: [latestVersion] },
    latestVersion,
    installedVersion: null,
    updateAvailable,
    catalogOlder: false,
    permissionsIncreased: null,
    signingKeyChange: 'unknown',
  }
}

const PLURAL_LABEL_KEYS = ['pluginPermissionSkins', 'pluginPermissionPanelThemes'] as const
type PluralLabelKey = typeof PLURAL_LABEL_KEYS[number]

function isPluralLabelKey(key: TranslationKey | PluralLabelKey): key is PluralLabelKey {
  return (PLURAL_LABEL_KEYS as readonly string[]).includes(key)
}

const PERMISSION_COPY: Array<[string, TranslationKey | PluralLabelKey, Record<string, string> | undefined, TranslationKey]> = [
  ['network:api.example.com', 'pluginPermissionNetwork', { host: 'api.example.com' }, 'plugins.hintNetwork'],
  ['network:userGranted', 'plugins.permNetworkUserGranted', undefined, 'plugins.hintNetworkUserGranted'],
  ['links:docs.example.com', 'pluginPermissionLinks', { host: 'docs.example.com' }, 'plugins.hintLinks'],
  ['storage', 'pluginPermissionStorage', undefined, 'plugins.hintStorage'],
  ['storage:extra', 'pluginPermissionStorage', undefined, 'plugins.hintStorage'],
  ['agentStatus', 'pluginPermissionAgentStatus', undefined, 'plugins.hintAgentStatus'],
  ['schedule', 'pluginPermissionSchedule', undefined, 'plugins.hintSchedule'],
  ['secrets:token', 'pluginPermissionSecret', { name: 'token' }, 'plugins.hintSecrets'],
  ['contributes:feed', 'pluginPermissionFeed', undefined, 'plugins.hintFeed'],
  ['mystery:feed', 'pluginPermissionFeed', undefined, 'plugins.hintFeed'],
  ['contributes:reaction', 'pluginPermissionReaction', undefined, 'plugins.hintReaction'],
  ['contributes:panelView', 'pluginPermissionPanel', undefined, 'plugins.hintPanel'],
  ['contributes:commands', 'pluginPermissionCommands', undefined, 'plugins.hintCommands'],
  ['contributes:tray', 'pluginPermissionTray', undefined, 'plugins.hintTray'],
  ['contributes:badge', 'pluginPermissionBadge', undefined, 'plugins.hintBadge'],
  ['contributes:eventSource', 'pluginPermissionEventSource', undefined, 'plugins.hintEventSource'],
  ['contributes:skins:3', 'pluginPermissionSkins', { count: '3' }, 'plugins.hintSkins'],
  ['contributes:skins:x', 'pluginPermissionSkins', { count: 'x' }, 'plugins.hintSkins'],
  ['contributes:panelThemes:2', 'pluginPermissionPanelThemes', { count: '2' }, 'plugins.hintPanelThemes'],
  ['contributes:panelThemeFonts', 'pluginPermissionPanelThemeFonts', undefined, 'plugins.hintPanelThemeFonts'],
  ['contributes:settings', 'plugins.permUnknown', { unit: 'contributes:settings' }, 'plugins.hintUnknown'],
  ['contributes:constructor', 'plugins.permUnknown', { unit: 'contributes:constructor' }, 'plugins.hintUnknown'],
  ['contributes:toString', 'plugins.permUnknown', { unit: 'contributes:toString' }, 'plugins.hintUnknown'],
  ['mystery', 'plugins.permUnknown', { unit: 'mystery' }, 'plugins.hintUnknown'],
]

test('permission units map to the same label and hint copy', async () => {
  const harness = await mountPluginPanel()
  for (const [unit, labelKey, params, hintKey] of PERMISSION_COPY) {
    // 帶數量的貢獻點標籤以 `.one`/`.other` 存放，依 count 走 tPlural。
    const expectedLabel = isPluralLabelKey(labelKey)
      ? tPlural(labelKey, Number(params?.count) || 0, params)
      : t(labelKey, params)
    assert.equal(harness.controller.permissionLabel(unit), expectedLabel, unit)
    assert.equal(harness.controller.permissionHint(unit), t(hintKey), unit)
  }
})

test('resource limits keep their units, ranges and kilobyte scaling', async () => {
  const harness = await mountPluginPanel()
  const { controller } = harness
  const expected: Record<string, [string, string, string, string]> = {
    maxEnabledPlugins: ['3,145,728', '1,536', '60', '2048'],
    memoryMbPerPlugin: ['3,145,728 MB', '1,536 MB', '60 MB', '2048'],
    netMaxResponseBytes: ['3 MB', '1.5 kB', '0.1 kB', '2'],
    netTimeoutSeconds: ['3,145,728 秒', '1,536 秒', '60 秒', '2048'],
    netRequestsPerMinute: ['3,145,728 次／分鐘', '1,536 次／分鐘', '60 次／分鐘', '2048'],
    storageBytesPerPlugin: ['3 MB', '1.5 kB', '0.1 kB', '2'],
    globalFeedPer10Min: ['3,145,728 次／10 分鐘', '1,536 次／10 分鐘', '60 次／10 分鐘', '2048'],
    scheduleMinIntervalSeconds: ['3,145,728 秒', '1,536 秒', '60 秒', '2048'],
  }
  for (const field of controller.resourceFields) {
    const key = field.key
    assert.deepEqual([
      controller.resourceBoundText(key, 3 * 1024 * 1024), controller.resourceBoundText(key, 1536),
      controller.resourceBoundText(key, 60), controller.resourceInputValue(key, 2048),
    ], expected[key], key)
  }
  controller.updateResourceLimit('storageBytesPerPlugin', '128')
  controller.updateResourceLimit('netTimeoutSeconds', '4')
  await harness.flush()
  assert.deepEqual(harness.callsOf('setPluginGlobalPreferences').map(call => call.args), [[{ resources: { storageBytesPerPlugin: 128 * 1024 } }]])
  assert.ok(controller.toasts.value.some(toast => toast.text === t('pluginResourceRangeInvalid', { min: '5', max: '60' })))
})

test('error codes map to localized copy and unknown codes fall back', async () => {
  const harness = await mountPluginPanel()
  const { controller } = harness
  assert.equal(controller.localizedError('too_many_enabled'), t('pluginTooManyEnabled', { limit: '10' }))
  assert.equal(controller.localizedError('secret_consent_required'), t('pluginSecretConsentRequired'))
  assert.equal(controller.localizedError('something_else'), t('pluginActionFailed'))
  controller.setError('install_failed', undefined, 'author hint')
  const toast = controller.toasts.value.at(-1)
  assert.equal(toast?.detail, 'install_failed: author hint')
  assert.equal(toast?.sticky, true)
})

// 刻意差異：原本以一般物件查表，`constructor` 之類的原型名稱會拿到函式並讓 t() 拋例外。
test('error-code lookups ignore prototype names', async () => {
  const harness = await mountPluginPanel()
  assert.equal(harness.controller.localizedError('constructor'), t('pluginActionFailed'))
  assert.equal(harness.controller.localizedError('toString'), t('pluginActionFailed'))
  // 刻意餵入原型鏈上的名稱（不在 PluginErrorCode 裡），驗證標籤查表不會誤命中 Object.prototype 成員。
  const prototypeName = 'constructor' as unknown as PluginErrorCode
  assert.equal(harness.controller.diagnosticCodeLabel({ at: 1, code: prototypeName }), t('plugins.diagnosticRejectedHuman', { reason: t('plugins.reasonOther') }))
})

// --- 拆分時新增的守衛（刻意差異，原控制器沒有） ----------------------------------------

test('a settings save that finishes after switching plugins does not fill the new form', async () => {
  const pending = deferred<ReturnType<typeof ok<Record<string, string | number>>>>()
  const harness = await mountPluginPanel({ api: { setPluginSettings: () => pending.promise } })
  const { controller } = harness
  await openDetailWithSettings(harness)
  const save = controller.savePluginSettings()
  controller.openPluginDetail('beta', 'settings')
  await harness.flush()
  pending.resolve(ok({ city: 'Alpha saved', count: 5 }))
  await save
  assert.equal(controller.selectedPluginId.value, 'beta')
  assert.deepEqual(controller.settingsDraft.value, { city: 'Tainan', count: 2 })
  assert.deepEqual(controller.pluginSettings.value?.values, { city: 'Tainan', count: 2 })
  assert.ok(controller.toasts.value.some(toast => toast.text === t('pluginSettingsSaved')))
})

test('accepting consent after the draft was cleared does not send an empty value (which would remove the secret)', async () => {
  let consented = false
  const harness = await mountPluginPanel({
    api: {
      getPluginSecretConsent: () => Promise.resolve(ok(consented)),
      acceptPluginSecretConsent: () => { consented = true; return Promise.resolve(ok(true)) },
      setPluginSecret: () => Promise.resolve(ok({ configured: false })),
    },
  })
  const { controller } = harness
  await openDetailWithSettings(harness)
  controller.secretDrafts.value = { token: SECRET }
  await controller.savePluginSecret('token')
  assert.equal(controller.pendingSecretConsentKey.value, 'token')
  controller.resetSettingsDraft()
  await controller.confirmSecretConsent()
  assert.equal(controller.pendingSecretConsentKey.value, '')
  assert.equal(harness.callsOf('acceptPluginSecretConsent').length, 1)
  assert.equal(harness.callsOf('setPluginSecret').length, 0)
})

test('concurrent notification refreshes share one trailing request and keep the newest list', async () => {
  const lists: Array<ReturnType<typeof deferred<unknown>>> = []
  const harness = await mountPluginPanel({
    api: {
      listPluginNotifications: () => {
        const pending = deferred<unknown>()
        lists.push(pending)
        return pending.promise
      },
    },
  })
  const { controller } = harness
  // 掛載時的那一次還在途中。
  assert.equal(lists.length, 1)
  harness.emit('onPluginNotificationsChanged')
  harness.emit('onPluginNotificationsChanged')
  const awaited = controller.refreshNotifications()
  assert.equal(lists.length, 1)
  lists[0].resolve(ok([notification('old', 'alpha')]))
  await harness.flush()
  assert.equal(lists.length, 2)
  lists[1].resolve(ok([notification('new', 'alpha')]))
  await awaited
  assert.deepEqual(controller.notifications.value.map(record => record.item.id), ['new'])
  assert.equal(lists.length, 2)
})

// 刻意差異：原本把 reactive 草稿直接交給 IPC，structured clone 會以「An object could not be cloned」失敗
// （實機的儲存按鈕一律顯示操作失敗）。送出的必須是純物件。
test('settings are sent to the main process as a plain, cloneable object', async () => {
  const harness = await mountPluginPanel({
    api: { setPluginSettings: (_id: string, values: Record<string, unknown>) => Promise.resolve(ok({ ...values })) },
  })
  await openDetailWithSettings(harness)
  harness.controller.updateSetting('city', 'string', 'Keelung')
  await harness.controller.savePluginSettings()
  const sent = harness.callsOf('setPluginSettings')[0]?.args[1]
  assert.equal(isProxy(sent), false)
  assert.deepEqual(structuredClone(sent), { city: 'Keelung', count: 2 })
})
