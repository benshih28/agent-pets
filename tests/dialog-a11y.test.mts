import test from 'node:test'
import assert from 'node:assert/strict'
import { FOCUSABLE_SELECTOR, nextTrapIndex } from '../src/composables/useDialogA11y.ts'

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
