import test from 'node:test'
import assert from 'node:assert/strict'
import {
  hasPluginTabContent, parseStoredDashboardTab, pluginIdOfTab, pluginTabBadgeText, pluginTabSections, pluginTabValue,
  resolveDashboardTab, unreadCountByPlugin, visiblePluginTabPlugins,
} from '../src/utils/plugin-tabs.ts'
import { overflowState, pageScrollDelta, scrollLeftToReveal, wheelScrollDelta } from '../src/utils/tab-overflow.ts'

type Snap = Parameters<typeof visiblePluginTabPlugins>[0]

function plugin(id: string, over: Record<string, unknown> = {}, enabled = true) {
  return {
    id, currentVersion: '1.0.0', status: 'installed', installedAt: 1, grantedPermissions: {},
    manifest: { id, name: { 'zh-TW': id, 'en-US': id }, contributes: { feed: true } }, development: false,
    preference: { enabled, muted: false, rateLimitPer10Min: 10, targetPetId: null, grantedHosts: [] },
    ...over,
  }
}

function snap(plugins: unknown[], pluginsEnabled = true): Snap {
  return { preferences: { pluginsEnabled }, plugins } as unknown as Snap
}

test('only enabled plugins get a tab, in list order', () => {
  const result = visiblePluginTabPlugins(snap([plugin('aaa'), plugin('bbb', {}, false), plugin('ccc')]))
  assert.deepEqual(result.map(p => p.id), ['aaa', 'ccc'])
})

test('global switch off, crashed, incompatible and manifest-less plugins get no tab', () => {
  assert.deepEqual(visiblePluginTabPlugins(snap([plugin('aaa')], false)), [])
  assert.deepEqual(visiblePluginTabPlugins(snap([plugin('aaa', { status: 'disabled_crashed' })])), [])
  assert.deepEqual(visiblePluginTabPlugins(snap([plugin('aaa', { status: 'incompatible' })])), [])
  assert.deepEqual(visiblePluginTabPlugins(snap([plugin('aaa', { manifest: null })])), [])
  assert.deepEqual(visiblePluginTabPlugins(null), [])
})

test('a removed plugin drops its tab and an active plugin tab falls back to sessions', () => {
  const before = visiblePluginTabPlugins(snap([plugin('aaa'), plugin('bbb')])).map(p => p.id)
  const active = pluginTabValue('bbb')
  assert.equal(resolveDashboardTab(active, before), active)
  const after = visiblePluginTabPlugins(snap([plugin('aaa')])).map(p => p.id)
  assert.equal(resolveDashboardTab(active, after), 'sessions')
  assert.equal(resolveDashboardTab(active, visiblePluginTabPlugins(snap([plugin('aaa'), plugin('bbb', {}, false)])).map(p => p.id)), 'sessions')
  assert.equal(resolveDashboardTab('usage', []), 'usage')
  assert.equal(resolveDashboardTab('bogus', before), 'sessions')
})

test('stored tab parsing accepts built-in and well-formed plugin tabs only', () => {
  assert.equal(parseStoredDashboardTab('history'), 'history')
  assert.equal(parseStoredDashboardTab('plugin:my-plugin'), 'plugin:my-plugin')
  assert.equal(parseStoredDashboardTab('plugin:../x'), null)
  assert.equal(parseStoredDashboardTab('plugin:_host'), null)
  assert.equal(parseStoredDashboardTab(null), null)
  assert.equal(pluginIdOfTab('sessions'), null)
})

test('unread counts per plugin and badge text are capped', () => {
  const rec = (pluginId: string, read: boolean) => ({ read, item: { pluginId } }) as never
  const counts = unreadCountByPlugin([rec('aaa', false), rec('aaa', false), rec('aaa', true), rec('bbb', false)])
  assert.equal(counts.get('aaa'), 2)
  assert.equal(counts.get('bbb'), 1)
  assert.equal(pluginTabBadgeText(0), '')
  assert.equal(pluginTabBadgeText(7), '7')
  assert.equal(pluginTabBadgeText(120), '99+')
})

test('overflow state reports hidden edges', () => {
  assert.deepEqual(overflowState({ scrollLeft: 0, clientWidth: 300, scrollWidth: 300 }), { overflowing: false, start: false, end: false })
  assert.deepEqual(overflowState({ scrollLeft: 0, clientWidth: 300, scrollWidth: 500 }), { overflowing: true, start: false, end: true })
  assert.deepEqual(overflowState({ scrollLeft: 100, clientWidth: 300, scrollWidth: 500 }), { overflowing: true, start: true, end: true })
  assert.deepEqual(overflowState({ scrollLeft: 200, clientWidth: 300, scrollWidth: 500 }), { overflowing: true, start: true, end: false })
})

test('scroll-into-view only moves when the tab is clipped and stays in range', () => {
  const metrics = { scrollLeft: 100, clientWidth: 300, scrollWidth: 800 }
  assert.equal(scrollLeftToReveal(metrics, { left: 150, width: 80 }, 20), 100)
  assert.equal(scrollLeftToReveal(metrics, { left: 40, width: 80 }, 20), 20)
  assert.equal(scrollLeftToReveal(metrics, { left: 380, width: 100 }, 20), 200)
  assert.equal(scrollLeftToReveal(metrics, { left: 760, width: 40 }, 20), 500)
  assert.equal(scrollLeftToReveal({ ...metrics, scrollLeft: 50 }, { left: 0, width: 80 }, 20), 0)
})

test('wheel redirects vertical and shift wheel only when overflowing', () => {
  assert.equal(wheelScrollDelta({ deltaX: 0, deltaY: 40 }, true), 40)
  assert.equal(wheelScrollDelta({ deltaX: 0, deltaY: 40, shiftKey: true }, true), 40)
  assert.equal(wheelScrollDelta({ deltaX: 0, deltaY: 40 }, false), null)
  assert.equal(wheelScrollDelta({ deltaX: 30, deltaY: 2 }, true), null)
  assert.equal(wheelScrollDelta({ deltaX: 0, deltaY: 0 }, true), null)
  assert.equal(pageScrollDelta(300, 1), 225)
  assert.equal(pageScrollDelta(300, -1), -225)
})

test('a tab shows only the sections the plugin can use, and a plugin with none gets no tab', () => {
  const manifest = (contributes: Record<string, unknown>) => ({ contributes }) as never
  // 只提供面板主題：分頁主體是主題清單，沒有通知、命令或設定。
  assert.deepEqual(pluginTabSections(manifest({ panelThemes: [{ id: 'aurora' }] })), { panelView: false, panelThemes: true, feed: false, commands: false, settings: false })
  // 能送通知的插件才有通知區；空的設定 schema 不算設定。
  assert.deepEqual(pluginTabSections(manifest({ feed: true, settings: { type: 'object', properties: {} } })), { panelView: false, panelThemes: false, feed: true, commands: false, settings: false })
  assert.equal(pluginTabSections(manifest({ settings: { type: 'object', properties: { interval: { type: 'number' } } } })).settings, true)
  assert.equal(pluginTabSections(manifest({ commands: [{ id: 'go' }] })).commands, true)
  assert.equal(pluginTabSections(manifest({ panelView: { entry: 'ui/index.html' } })).panelView, true)
  // 只有寵物外觀、只有反應或徽章：沒有分頁。
  for (const contributes of [{ skins: [{ id: 'fox' }] }, { reaction: true, badge: true }, {}]) {
    assert.equal(hasPluginTabContent(pluginTabSections(manifest(contributes))), false, JSON.stringify(contributes))
  }
  const skins = plugin('skin-pack', { manifest: { id: 'skin-pack', name: { 'zh-TW': 's', 'en-US': 's' }, contributes: { skins: [{ id: 'fox' }] } } })
  const themes = plugin('theme-pack', { manifest: { id: 'theme-pack', name: { 'zh-TW': 't', 'en-US': 't' }, contributes: { panelThemes: [{ id: 'aurora' }] } } })
  assert.deepEqual(visiblePluginTabPlugins(snap([skins, themes])).map(p => p.id), ['theme-pack'])
  assert.equal(pluginTabSections(null).feed, false)
})

test('the tab content renders each section only for a matching capability and hosts the shared theme list', async () => {
  const { readFileSync } = await import('node:fs')
  const content = readFileSync('src/components/status-panel/PluginTabContent.vue', 'utf8')
  assert.match(content, /<PluginThemeTab v-if="tab\.sections\.panelThemes"/)
  assert.match(content, /<section v-if="tab\.sections\.commands"/)
  assert.match(content, /<section v-if="tab\.sections\.feed"/)
  assert.match(content, /v-if="tab\.sections\.settings"[^>]*@click="emit\('openSettings'/)
  // 主題清單與詳情頁共用同一個元件，不複製邏輯。
  assert.match(readFileSync('src/components/status-panel/PluginThemeTab.vue', 'utf8'), /<PluginPanelThemes :plugin-id="pluginId"/)
  assert.match(readFileSync('src/components/plugin-panel/PluginDetail.vue', 'utf8'), /<PluginPanelThemes /)
  // 「開啟插件設定」與搜尋先找分頁，沒有分頁才開詳情頁。
  const panel = readFileSync('src/components/StatusPanel.vue', 'utf8')
  assert.match(panel, /watch\(panelThemeTargetRequest,[\s\S]*?candidate\.sections\.panelThemes[\s\S]*?openPluginTabSettings\(request\.pluginId, 'themes'\)[\s\S]*?selectDashboardTab\(tab\.value\)/)
})
