import test from 'node:test'
import assert from 'node:assert/strict'
import { acceleratorKeys, detectPlatform, formatAccelerator } from '../src/utils/accelerator.ts'

test('formats the permission hotkeys per platform', () => {
  assert.equal(formatAccelerator('CommandOrControl+Shift+Y', 'mac'), '⌘⇧Y')
  assert.equal(formatAccelerator('CommandOrControl+Shift+N', 'other'), 'Ctrl+Shift+N')
  assert.deepEqual(acceleratorKeys('Alt+F4', 'other'), ['Alt', 'F4'])
  assert.deepEqual(acceleratorKeys('Control+a', 'mac'), ['⌃', 'A'])
})

test('detects macOS from navigator.platform strings', () => {
  assert.equal(detectPlatform('MacIntel'), 'mac')
  assert.equal(detectPlatform('Win32'), 'other')
  assert.equal(detectPlatform(''), 'other')
})
