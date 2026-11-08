import assert from 'node:assert/strict'
import test from 'node:test'
import { desktopVisibilityCapabilitiesForPlatform } from '../electron/desktop-visibility.ts'

test('platform capability projection is explicit about native Windows and macOS support', () => {
  assert.deepEqual(
    desktopVisibilityCapabilitiesForPlatform('win32', true, true),
    {
      captureExclusion: { supported: true, mode: 'system' },
      fullscreenAutoHide: { supported: true, mode: 'windows-native' },
    },
  )
  assert.equal(
    desktopVisibilityCapabilitiesForPlatform('win32', true, false).fullscreenAutoHide.supported,
    false,
  )
  assert.deepEqual(
    desktopVisibilityCapabilitiesForPlatform('darwin', true),
    {
      captureExclusion: { supported: true, mode: 'limited' },
      fullscreenAutoHide: { supported: true, mode: 'macos-native' },
    },
  )
  assert.equal(
    desktopVisibilityCapabilitiesForPlatform('linux', true).fullscreenAutoHide.supported,
    false,
  )
})

test('macOS keeps windows visible over fullscreen Spaces while a permission request is pending', async () => {
  const { macVisibleOnFullScreen } = await import('../electron/desktop-visibility.ts')
  assert.equal(macVisibleOnFullScreen(false, false), true)
  assert.equal(macVisibleOnFullScreen(true, false), false)
  assert.equal(macVisibleOnFullScreen(true, true), true)
})
