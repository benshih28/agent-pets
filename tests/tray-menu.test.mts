import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTrayMenuTemplate } from '../electron/tray-menu.ts'

const preferences = {
  dndEnabled: false, dndUntil: null, notificationsEnabled: true, permissionBubbleEnabled: true,
  presentationMcpEnabled: true, achievementsEnabled: true, edgeModeEnabled: false, shimejiEnabled: false,
  captureExclusionEnabled: false, fullscreenAutoHideEnabled: false, rightClickHideEnabled: false,
  soundEnabled: false, launchAtStartup: false, launchAtStartupSupported: true, launchAtStartupStatus: 'disabled', locale: 'zh-TW',
  visibilityCapabilities: { captureExclusion: { supported: false }, fullscreenAutoHide: { supported: true } },
} as never

function build(overrides: Record<string, unknown> = {}, calls: string[] = []) {
  return buildTrayMenuTemplate({
    preferences, petVisible: true, petMode: 'normal',
    attention: { permission: 0, external: 0, input: 0, total: 0 }, attentionText: '',
    pluginMenu: null, pluginOmittedCount: 0, now: 0, ...overrides,
  } as never, {
    updatePreferences: (patch) => calls.push(JSON.stringify(patch)),
    showPet() {}, hidePet() { calls.push('hide') }, openPanel() { calls.push('panel') },
    openSettings() {}, toggleMiniMode() {}, quit() {},
  })
}

const labels = (items: Array<{ label?: string }>) => items.map((item) => item.label).filter(Boolean)

test('no dead placeholder entries', () => {
  assert.ok(!labels(build()).some((label) => String(label).includes('檢查更新')))
})

test('pending items are a clickable first entry that opens the panel', () => {
  const calls: string[] = []
  const menu = build({ attention: { permission: 1, external: 0, input: 1, total: 2 }, attentionText: '摘要' }, calls)
  const first = menu[0] as { label?: string; enabled?: boolean; click?: () => void }
  assert.match(first.label ?? '', /^2 個待處理/)
  assert.notEqual(first.enabled, false)
  first.click?.()
  assert.deepEqual(calls, ['panel'])
  assert.notEqual((build()[0] as { label?: string }).label?.startsWith('0'), true)
})

test('DND is a submenu whose presets set a bounded end time', () => {
  const calls: string[] = []
  const menu = build({ now: 1_000_000 }, calls)
  const dnd = menu.find((item) => Array.isArray(item.submenu) && String(item.label).startsWith('勿擾'))
  assert.ok(dnd)
  const thirty = (dnd!.submenu as Array<{ click?: () => void }>)[1]
  thirty.click?.()
  assert.deepEqual(JSON.parse(calls[0]), { dndEnabled: true, dndUntil: 1_000_000 + 30 * 60_000 })
})

test('plugin submenu sits before Settings and notes omitted commands', () => {
  const menu = build({ pluginMenu: { label: '插件', submenu: [{ label: 'x' }] }, pluginOmittedCount: 3 })
  const index = menu.findIndex((item) => item.label === '插件')
  assert.ok(index > 0)
  assert.equal(menu[index + 1]?.label, '開啟設定')
  const sub = menu[index].submenu as Array<{ label?: string; enabled?: boolean }>
  assert.equal(sub[sub.length - 1].enabled, false)
  assert.match(sub[sub.length - 1].label ?? '', /3/)
})

test('launch at login tray item reflects intent and marks pending approval', () => {
  const flat = (menu: Array<Record<string, unknown>>): Array<Record<string, unknown>> =>
    menu.flatMap(item => [item, ...(Array.isArray(item.submenu) ? flat(item.submenu as never) : [])])
  const find = (overrides: Record<string, unknown>) => flat(build({ preferences: { ...(preferences as object), ...overrides } }) as never)
    .find(item => typeof item.label === 'string' && item.label.includes('啟動'))
  const pending = find({ launchAtStartup: true, launchAtStartupStatus: 'requires-approval' })
  assert.equal(pending?.checked, true)
  assert.match(String(pending?.label), /（需核准）$/)
  assert.doesNotMatch(String(find({ launchAtStartup: true, launchAtStartupStatus: 'enabled' })?.label), /需核准/)
})
