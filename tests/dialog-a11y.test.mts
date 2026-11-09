import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { FOCUSABLE_SELECTOR, nextTrapIndex } from '../src/composables/useDialogA11y.ts'
import { dialogTeleportTarget } from '../src/components/ui/dialog-host.ts'

test('Tab wraps from the last control to the first, Shift+Tab the reverse', () => {
  assert.equal(nextTrapIndex(3, 2, false), 0)
  assert.equal(nextTrapIndex(3, 0, true), 2)
})

test('Tab inside the dialog is left to the browser', () => {
  assert.equal(nextTrapIndex(3, 1, false), null)
  assert.equal(nextTrapIndex(3, 1, true), null)
})

test('focus that escaped the dialog is pulled back in', () => {
  assert.equal(nextTrapIndex(3, -1, false), 0)
  assert.equal(nextTrapIndex(3, -1, true), 2)
})

test('an empty dialog has nothing to trap', () => {
  assert.equal(nextTrapIndex(0, -1, false), null)
})

test('focusable selector covers inputs, selects, links and tabindex but not disabled/-1', () => {
  for (const part of ['button:not([disabled])', 'select:not([disabled])', 'textarea:not([disabled])', 'a[href]', '[tabindex]:not([tabindex="-1"])']) {
    assert.ok(FOCUSABLE_SELECTOR.includes(part), part)
  }
})

// 遮罩範圍：Dialog 掛到面板根元素，不受所在卡片（position: relative）或捲動區裁切。

test('a dialog teleports to the panel host unless it is nested in another dialog', () => {
  const host = { id: 'panel' }
  assert.equal(dialogTeleportTarget(host, false), host)
  assert.equal(dialogTeleportTarget(host, true), null)
  assert.equal(dialogTeleportTarget(null, false), null)
  assert.equal(dialogTeleportTarget(undefined, false), null)
})

test('the panel provides its root as the dialog host and Dialog teleports its scrim there', () => {
  const read = (name: string) => readFileSync(new URL(`../src/components/${name}`, import.meta.url), 'utf8')
  const dialog = read('ui/Dialog.vue')
  assert.match(dialog, /<Teleport :to="teleportTarget \?\? 'body'" :disabled="!teleportTarget">\s*<Transition name="dialog">\s*<div v-if="open" ref="scopeRef" class="scrim"/)
  assert.match(dialog, /provide\(DIALOG_NESTED_KEY, true\)/)
  assert.match(read('StatusPanel.vue'), /provide\(DIALOG_HOST_KEY, panelRoot\)/)
  assert.match(read('StatusPanel.vue'), /<div ref="panelRoot" class="status-panel"/)
})
