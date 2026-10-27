import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPluginTrayMenu, type PluginTrayCommandItem } from '../electron/plugin-tray.ts'

function command(pluginId: string, title: string, pluginName = pluginId): PluginTrayCommandItem {
  return {
    pluginId,
    pluginName: { 'zh-TW': pluginName, 'en-US': pluginName },
    commandId: 'run',
    title: { 'zh-TW': title, 'en-US': title },
  }
}

function submenuItems(menu: NonNullable<ReturnType<typeof buildPluginTrayMenu>['menu']>) {
  assert.ok(Array.isArray(menu.submenu))
  return menu.submenu
}

test('plugin Tray menu is omitted when no eligible commands exist', () => {
  assert.deepEqual(buildPluginTrayMenu([], 'en-US', 'Plugins', () => {}), {
    menu: null,
    omittedPluginIds: [],
  })
})

test('plugin Tray menu groups declared commands and caps the combined items at 30', () => {
  const calls: string[] = []
  const items = Array.from({ length: 32 }, (_, index) => command(`plugin-${String(index).padStart(2, '0')}`, `Command ${index}`))
  const result = buildPluginTrayMenu(items, 'en-US', 'Plugins', (pluginId, commandId) => calls.push(`${pluginId}:${commandId}`))
  assert.ok(result.menu)
  assert.equal(submenuItems(result.menu).length, 30)
  assert.deepEqual(result.omittedPluginIds, ['plugin-30', 'plugin-31'])
  const plugin = submenuItems(result.menu)[0]
  assert.equal(plugin.label, 'plugin-00')
  assert.ok(Array.isArray(plugin.submenu))
  const firstCommand = plugin.submenu[0] as { label?: string; click?: () => void }
  assert.equal(firstCommand.label, 'Command 0')
  firstCommand.click?.()
  assert.deepEqual(calls, ['plugin-00:run'])
})

test('plugin Tray labels use the selected locale, remove control text, and truncate at 32 code points', () => {
  const longName = '插件🌱'.repeat(12)
  const result = buildPluginTrayMenu([command('safe-plugin', '啟動\n插件', longName)], 'zh-TW', '插件', () => {})
  assert.ok(result.menu)
  assert.equal(result.menu.label, '插件')
  const group = submenuItems(result.menu)[0]
  assert.equal(Array.from(String(group.label)).length, 32)
  assert.ok(String(group.label).endsWith('…'))
  assert.equal(Array.from(String((group.submenu as Array<{ label?: string }>)[0].label)).length, 5)
  assert.equal((group.submenu as Array<{ label?: string }>)[0].label, '啟動 插件')
})
