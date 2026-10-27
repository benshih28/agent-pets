import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isPluginPanelInstallConfirmation,
  isPluginPanelNotificationId,
  isPluginPanelPluginId,
  isPluginPanelPreferencePatch,
  pluginPanelErrorCode,
} from '../electron/plugin-panel-validation.ts'
import { PluginPreferencesFileError } from '../electron/plugin-preferences.ts'

test('plugin panel validates installed ids and notification ids before IPC work', () => {
  assert.equal(isPluginPanelPluginId('ok-notify'), true)
  assert.equal(isPluginPanelPluginId('_host'), false)
  assert.equal(isPluginPanelPluginId('../outside'), false)
  assert.equal(isPluginPanelPluginId('Uppercase'), false)
  assert.equal(isPluginPanelNotificationId('feed-id_123'), true)
  assert.equal(isPluginPanelNotificationId('short'), false)
  assert.equal(isPluginPanelNotificationId('feed id with spaces'), false)
})

test('plugin panel preference patches must be bounded plain objects', () => {
  assert.equal(isPluginPanelPreferencePatch({ pluginsEnabled: true }), true)
  assert.equal(isPluginPanelPreferencePatch([]), false)
  assert.equal(isPluginPanelPreferencePatch(new Date()), false)
  assert.equal(isPluginPanelPreferencePatch({ value: 'x'.repeat(17 * 1024) }), false)
  const cyclic: Record<string, unknown> = {}
  cyclic['self'] = cyclic
  assert.equal(isPluginPanelPreferencePatch(cyclic), false)
})

test('plugin panel install confirmation validates both permission and signature consent flags', () => {
  assert.equal(isPluginPanelInstallConfirmation('opaque-plan-token', true, false), true)
  assert.equal(isPluginPanelInstallConfirmation('', true, false), false)
  assert.equal(isPluginPanelInstallConfirmation('token', 'yes', false), false)
  assert.equal(isPluginPanelInstallConfirmation('token', true, 'yes'), false)
  assert.equal(isPluginPanelInstallConfirmation('token', true, undefined), false)
  assert.equal(isPluginPanelInstallConfirmation('x'.repeat(129), false, false), false)
})

test('unsafe plugin preference files map to a recoverable localized panel error', () => {
  assert.equal(pluginPanelErrorCode(new PluginPreferencesFileError()), 'preferences_unsafe')
  assert.equal(pluginPanelErrorCode({ code: 'unsafe_file' }), 'preferences_unsafe')
})
