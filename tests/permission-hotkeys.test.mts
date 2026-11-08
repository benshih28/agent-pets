import assert from 'node:assert/strict'
import test from 'node:test'
import { attachHotkeyInfo, PermissionHotkeys, permissionHotkeyLabels } from '../electron/permission-hotkeys.ts'

function view(overrides: Record<string, unknown> = {}) {
  return {
    requestId: 'r1', status: 'pending', hotkeyEligible: true,
    allowedDecisions: ['allow_once', 'deny'], ...overrides,
  } as never
}

function fakeShortcuts(blocked: string[] = []) {
  const registered = new Map<string, () => void>()
  let registerCalls = 0
  return {
    registered,
    get registerCalls() { return registerCalls },
    port: {
      register(accelerator: string, callback: () => void) {
        registerCalls += 1
        if (blocked.includes(accelerator)) return false
        registered.set(accelerator, callback)
        return true
      },
      unregister(accelerator: string) { registered.delete(accelerator) },
      isRegistered(accelerator: string) { return registered.has(accelerator) },
    },
  }
}

test('labels follow the platform', () => {
  assert.equal(permissionHotkeyLabels('darwin').allow, '⌘⇧Y')
  assert.equal(permissionHotkeyLabels('win32').deny, 'Ctrl+Shift+N')
})

test('registers once per top request and reports active', () => {
  const shortcuts = fakeShortcuts()
  const decisions: string[] = []
  const hotkeys = new PermissionHotkeys({
    shortcuts: shortcuts.port, platform: 'darwin', decide: (id, d) => decisions.push(`${id}:${d}`),
  })
  const info = hotkeys.sync(view(), true)
  assert.equal(info?.status, 'active')
  hotkeys.sync(view(), true)
  assert.equal(shortcuts.registerCalls, 2, 'a repeat broadcast must not re-register')
  shortcuts.registered.get('CommandOrControl+Shift+Y')?.()
  assert.deepEqual(decisions, ['r1:allow_once'])
  hotkeys.sync(view({ requestId: 'r2' }), true)
  shortcuts.registered.get('CommandOrControl+Shift+N')?.()
  assert.deepEqual(decisions, ['r1:allow_once', 'r2:deny'])
})

test('a shortcut owned by another app is reported unavailable and fully released', () => {
  const shortcuts = fakeShortcuts(['CommandOrControl+Shift+N'])
  const hotkeys = new PermissionHotkeys({ shortcuts: shortcuts.port, platform: 'win32', decide: () => {} })
  assert.equal(hotkeys.sync(view(), true)?.status, 'unavailable')
  assert.equal(shortcuts.registered.size, 0)
})

test('ineligible, disabled or non-pending requests get no shortcut and release old ones', () => {
  const shortcuts = fakeShortcuts()
  const hotkeys = new PermissionHotkeys({ shortcuts: shortcuts.port, platform: 'win32', decide: () => {} })
  hotkeys.sync(view(), true)
  assert.equal(shortcuts.registered.size, 2)
  assert.equal(hotkeys.sync(view({ hotkeyEligible: false }), true), null)
  assert.equal(shortcuts.registered.size, 0)
  assert.equal(hotkeys.sync(view(), false), null)
  assert.equal(hotkeys.sync(view({ status: 'deciding' }), true), null)
  assert.equal(hotkeys.sync(null, true), null)
  assert.equal(shortcuts.registered.size, 0)
})

test('hotkey info is attached to the top request only', () => {
  const out = attachHotkeyInfo([view(), view({ requestId: 'r2' })], { status: 'active', allowLabel: 'a', denyLabel: 'd' })
  assert.ok((out[0] as { hotkey?: unknown }).hotkey)
  assert.equal((out[1] as { hotkey?: unknown }).hotkey, undefined)
})
