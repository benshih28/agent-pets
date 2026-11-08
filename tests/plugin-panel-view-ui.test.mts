import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'
import {
  isCurrentPluginPanelViewClose,
  pluginPanelViewCloseError,
  maximizedPluginPanelWindowSize,
  shouldResetPluginPanelMaximized,
} from '../src/utils/plugin-panel-view.ts'
import type { PluginPanelViewClosedEvent } from '../src/types/plugin.ts'

test('stale plugin panel close events cannot hide a newer panel frame', () => {
  const oldEvent: PluginPanelViewClosedEvent = {
    pluginId: 'old-plugin',
    openToken: 4,
    reason: 'closed',
  }
  assert.equal(isCurrentPluginPanelViewClose(oldEvent, 'new-plugin', 5), false)
  assert.equal(isCurrentPluginPanelViewClose(oldEvent, 'old-plugin', 5), false)
  assert.equal(isCurrentPluginPanelViewClose(oldEvent, 'old-plugin', 4), true)
})

test('panel close events map to localized status error codes', () => {
  assert.equal(pluginPanelViewCloseError('load_failed'), 'panel_load_failed')
  assert.equal(pluginPanelViewCloseError('renderer_crashed'), 'panel_crashed')
  assert.equal(pluginPanelViewCloseError('renderer_unavailable'), 'panel_unavailable')
  assert.equal(pluginPanelViewCloseError('disabled'), 'disabled')
  assert.equal(pluginPanelViewCloseError('closed'), 'panel_closed')
  assert.equal(pluginPanelViewCloseError('destroyed'), 'panel_closed')
  assert.equal(pluginPanelViewCloseError('hidden'), 'hidden')
})

test('plugin panel maximize control exposes its state and translations', () => {
  const source = readFileSync(new URL('../src/components/plugin-panel/PluginPanelFrame.vue', import.meta.url), 'utf8')
  const styles = readFileSync(new URL('../src/components/plugin-panel/PluginPanelFrame.css', import.meta.url), 'utf8')
  assert.match(source, /class="plugin-panel-view-control"/)
  assert.match(source, /:aria-pressed="panelViewMaximized"/)
  assert.match(source, /t\(panelViewMaximized\.value \? 'pluginPanelRestore' : 'pluginPanelMaximize'\)/)
  assert.match(styles, /plugin-panel-view-control\.btn\.icon-only\) \{[^}]*width: 32px;\s*height: 32px;/)
  assert.match(styles, /plugin-panel-view-control\.btn\.icon-only:focus-visible/)
  assert.match(styles, /prefers-reduced-motion/)
  const maximizeRule = styles.match(/\.plugin-panel-view-frame\.is-maximized\s*\{([^}]*)\}/)?.[1]
  assert.ok(maximizeRule)
  assert.match(maximizeRule, /position: fixed/)
  assert.match(maximizeRule, /inset: var\(--organic-space-2/)
  assert.doesNotMatch(maximizeRule, /backdrop-filter/)

  const localeDirectory = new URL('../src/locales/', import.meta.url)
  const localeFiles = readdirSync(localeDirectory).filter(name => /^[a-z]{2}-[A-Z]{2}\.json$/.test(name))
  assert.ok(localeFiles.length > 0)
  for (const filename of localeFiles) {
    const messages = JSON.parse(readFileSync(new URL(filename, localeDirectory), 'utf8')) as Record<string, unknown>
    assert.equal(typeof messages.pluginPanelMaximize, 'string', `${filename} is missing pluginPanelMaximize`)
    assert.equal(typeof messages.pluginPanelRestore, 'string', `${filename} is missing pluginPanelRestore`)
  }
})

test('plugin panel maximize state resets on close and plugin switches', () => {
  const controller = readFileSync(new URL('../src/composables/usePluginPanelController.ts', import.meta.url), 'utf8')
  assert.match(controller, /watch\(panelViewPluginId, async \(pluginId, previousPluginId\) => \{\s*if \(shouldResetPluginPanelMaximized\(previousPluginId, pluginId\)\)/)
  assert.match(controller, /watch\(panelViewPlugin, plugin => \{\s*if \(!plugin\) void restorePluginPanelViewMaximized\(\)/)
  assert.equal(shouldResetPluginPanelMaximized('first-plugin', ''), true)
  assert.equal(shouldResetPluginPanelMaximized('first-plugin', 'second-plugin'), true)
  assert.equal(shouldResetPluginPanelMaximized('same-plugin', 'same-plugin'), false)
})

test('maximizing enlarges the panel window to the plugin page limit without shrinking it', () => {
  assert.deepEqual(maximizedPluginPanelWindowSize({ width: 460, height: 720 }, { width: 1512, height: 944 }), { width: 1500, height: 932 })
  assert.deepEqual(maximizedPluginPanelWindowSize({ width: 460, height: 720 }, { width: 800, height: 600 }), { width: 788, height: 720 })
  assert.deepEqual(maximizedPluginPanelWindowSize({ width: 1500, height: 932 }, { width: 1512, height: 944 }), { width: 1500, height: 932 })
  const controller = readFileSync(new URL('../src/composables/usePluginPanelController.ts', import.meta.url), 'utf8')
  // 以既有的面板尺寸 API 加大與還原視窗（不在測試中寫出 API 名稱，避免 IPC 清冊把本檔當成該頻道的測試）。
  assert.match(controller, /window\.electronAPI\?\.\w+\(target\.height, target\.width\)/)
  assert.match(controller, /if \(restoreWindowSize && previousSize\) window\.electronAPI\?\.\w+\(\{ release: true \}\)/)
  // 還原按鈕、Esc、關閉與切換插件都要釋放放大用的暫時最小尺寸，主行程才不會把放大後的視窗記成使用者尺寸。
  assert.equal(controller.match(/restorePluginPanelViewMaximized\(true\)/g)?.length, 4)
})
