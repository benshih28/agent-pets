import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  DesktopPreferencesStore,
  parseDesktopPreferencesPatch,
  resolveLoginItemExecutable,
} from '../electron/desktop-preferences.ts'
import type { DesktopVisibilityCapabilities } from '../src/types/desktop-visibility.ts'

const TEST_VISIBILITY_CAPABILITIES: DesktopVisibilityCapabilities = {
  captureExclusion: { supported: true, mode: 'system' },
  fullscreenAutoHide: { supported: true, mode: 'macos-native' },
}

function tempPreferencesFile(t: test.TestContext): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-preferences-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return path.join(directory, 'desktop-preferences.json')
}

test('migrates legacy sound once and persists desktop preferences', (t) => {
  const filePath = tempPreferencesFile(t)
  let openAtLogin = false
  const store = new DesktopPreferencesStore(filePath, {
    supported: true,
    getStatus: () => (openAtLogin ? 'enabled' : 'disabled'),
    setLaunchAtStartup: (enabled) => {
      openAtLogin = enabled
      return openAtLogin ? 'enabled' : 'disabled'
    },
  }, TEST_VISIBILITY_CAPABILITIES)

  assert.equal(store.get().soundEnabled, false)
  assert.equal(store.get().permissionBubbleEnabled, true)
  assert.equal(store.get().presentationMcpEnabled, true)
  assert.equal(store.get().achievementsEnabled, true)
  assert.equal(store.get().edgeModeEnabled, false)
  assert.equal(store.get().shimejiEnabled, false)
  assert.equal(store.get().captureExclusionEnabled, false)
  assert.equal(store.get().fullscreenAutoHideEnabled, false)
  assert.equal(store.get().rightClickHideEnabled, false)
  assert.equal(store.get().sessionJumpEnabled, true)
  assert.equal(store.get().sessionJumpSwitchAppEnabled, true)
  assert.equal(store.get().locale, 'zh-TW')
  assert.equal(store.initializeLegacySound(true).soundEnabled, true)

  const updated = store.update({
    sessionJumpSwitchAppEnabled: false,
    dndEnabled: true,
    permissionBubbleEnabled: false,
    presentationMcpEnabled: false,
    achievementsEnabled: false,
    edgeModeEnabled: true,
    shimejiEnabled: true,
    captureExclusionEnabled: true,
    fullscreenAutoHideEnabled: true,
    rightClickHideEnabled: true,
    launchAtStartup: true,
    locale: 'en-US',
  })
  assert.equal(updated.dndEnabled, true)
  assert.equal(updated.permissionBubbleEnabled, false)
  assert.equal(updated.presentationMcpEnabled, false)
  assert.equal(updated.achievementsEnabled, false)
  assert.equal(updated.edgeModeEnabled, true)
  assert.equal(updated.shimejiEnabled, true)
  assert.equal(updated.captureExclusionEnabled, true)
  assert.equal(updated.fullscreenAutoHideEnabled, true)
  assert.equal(updated.rightClickHideEnabled, true)
  assert.equal(updated.sessionJumpSwitchAppEnabled, false)
  assert.throws(() => store.update({ sessionJumpEnabled: 'yes' }), /must be boolean/)
  assert.equal(updated.launchAtStartup, true)
  assert.equal(updated.locale, 'en-US')

  const reloaded = new DesktopPreferencesStore(filePath, {
    supported: true,
    getOpenAtLogin: () => openAtLogin,
    setOpenAtLogin: enabled => enabled,
  }, TEST_VISIBILITY_CAPABILITIES)
  assert.equal(reloaded.get().soundEnabled, true)
  assert.equal(reloaded.get().dndEnabled, true)
  assert.equal(reloaded.get().permissionBubbleEnabled, false)
  assert.equal(reloaded.get().presentationMcpEnabled, false)
  assert.equal(reloaded.get().achievementsEnabled, false)
  assert.equal(reloaded.get().edgeModeEnabled, true)
  assert.equal(reloaded.get().captureExclusionEnabled, true)
  assert.equal(reloaded.get().fullscreenAutoHideEnabled, true)
  assert.equal(reloaded.get().rightClickHideEnabled, true)
  assert.equal(reloaded.get().sessionJumpSwitchAppEnabled, false)
  assert.equal(reloaded.get().sessionJumpEnabled, true)
  assert.equal(reloaded.get().shimejiEnabled, true)
  assert.equal(reloaded.get().launchAtStartup, true)
  assert.equal(reloaded.get().locale, 'en-US')
})

test('rejects unknown and non-boolean preference fields', () => {
  assert.throws(
    () => parseDesktopPreferencesPatch({ dndEnabled: 'yes' }),
    /must be boolean/,
  )
  assert.throws(
    () => parseDesktopPreferencesPatch({ callbackUrl: 'http://127.0.0.1' }),
    /Unsupported desktop preference/,
  )
  assert.throws(
    () => parseDesktopPreferencesPatch({ locale: 'fr-FR' }),
    /locale is unsupported/,
  )
})

test('keeps launch at startup disabled when the runtime does not support it', (t) => {
  const store = new DesktopPreferencesStore(tempPreferencesFile(t), {
    supported: false,
    getStatus: () => 'unsupported',
    setLaunchAtStartup: () => 'unsupported',
  })

  const updated = store.update({ launchAtStartup: true })
  assert.equal(updated.launchAtStartupSupported, false)
  assert.equal(updated.launchAtStartup, false)
})

test('projects stale visibility toggles to false on an unsupported runtime', (t) => {
  const filePath = tempPreferencesFile(t)
  let openAtLogin = false
  const supportedStore = new DesktopPreferencesStore(filePath, {
    supported: true,
    getStatus: () => (openAtLogin ? 'enabled' : 'disabled'),
    setLaunchAtStartup: enabled => { openAtLogin = enabled; return enabled ? 'enabled' : 'disabled' },
  }, TEST_VISIBILITY_CAPABILITIES)
  supportedStore.update({ captureExclusionEnabled: true, fullscreenAutoHideEnabled: true })

  const unsupportedStore = new DesktopPreferencesStore(filePath, {
    supported: true,
    getStatus: () => (openAtLogin ? 'enabled' : 'disabled'),
    setLaunchAtStartup: enabled => { openAtLogin = enabled; return enabled ? 'enabled' : 'disabled' },
  })
  assert.equal(unsupportedStore.get().captureExclusionEnabled, false)
  assert.equal(unsupportedStore.get().fullscreenAutoHideEnabled, false)
  assert.equal(unsupportedStore.get().visibilityCapabilities.captureExclusion.supported, false)
  assert.equal(unsupportedStore.get().visibilityCapabilities.fullscreenAutoHide.supported, false)

  // A later unrelated write must not carry the stale true values back to disk.
  unsupportedStore.update({ dndEnabled: true })
  const persisted = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>
  assert.equal(persisted.captureExclusionEnabled, false)
  assert.equal(persisted.fullscreenAutoHideEnabled, false)
})

test('clears visibility toggles when a native capability becomes unavailable', (t) => {
  const filePath = tempPreferencesFile(t)
  const store = new DesktopPreferencesStore(filePath, {
    supported: false,
    getOpenAtLogin: () => false,
    setOpenAtLogin: () => false,
  }, TEST_VISIBILITY_CAPABILITIES)
  store.update({ captureExclusionEnabled: true, fullscreenAutoHideEnabled: true })

  const updated = store.setVisibilityCapabilities({
    captureExclusion: { supported: true, mode: 'system' },
    fullscreenAutoHide: { supported: false, mode: 'unsupported' },
  })
  assert.equal(updated.captureExclusionEnabled, true)
  assert.equal(updated.fullscreenAutoHideEnabled, false)
  assert.equal(updated.visibilityCapabilities.fullscreenAutoHide.supported, false)

  const persisted = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>
  assert.equal(persisted.captureExclusionEnabled, true)
  assert.equal(persisted.fullscreenAutoHideEnabled, false)
})

test('uses only the original regular portable executable for Windows startup', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-portable-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const portablePath = path.join(directory, 'AgentPets.exe')
  fs.writeFileSync(portablePath, 'test launcher')

  assert.equal(
    resolveLoginItemExecutable('win32', true, 'C:\\Temp\\extracted.exe', portablePath),
    portablePath,
  )
  assert.equal(
    resolveLoginItemExecutable('win32', true, 'C:\\Temp\\extracted.exe', path.join(directory, 'missing.exe')),
    null,
  )
  assert.equal(resolveLoginItemExecutable('win32', false, portablePath, portablePath), null)
})

test('dndUntil is validated, bounded, and cleared when DND is off', async () => {
  const { parseDesktopPreferencesPatch } = await import('../electron/desktop-preferences.ts')
  assert.deepEqual(parseDesktopPreferencesPatch({ dndUntil: null }), { dndUntil: null })
  assert.throws(() => parseDesktopPreferencesPatch({ dndUntil: 'soon' }))
  assert.throws(() => parseDesktopPreferencesPatch({ dndUntil: -5 }))
})

test('soundVolume must be a number from 0 to 100', async () => {
  const { parseDesktopPreferencesPatch } = await import('../electron/desktop-preferences.ts')
  assert.deepEqual(parseDesktopPreferencesPatch({ soundVolume: 35 }), { soundVolume: 35 })
  assert.throws(() => parseDesktopPreferencesPatch({ soundVolume: 101 }))
  assert.throws(() => parseDesktopPreferencesPatch({ soundVolume: '50' }))
})

test('keeps the launch-at-login intent while macOS approval is pending', (t) => {
  const filePath = tempPreferencesFile(t)
  let status: 'requires-approval' | 'enabled' | 'not-in-applications' | 'error' = 'requires-approval'
  const adapter = {
    supported: true,
    getStatus: () => status,
    setLaunchAtStartup: () => status,
  }
  const store = new DesktopPreferencesStore(filePath, adapter, TEST_VISIBILITY_CAPABILITIES)

  const pending = store.update({ launchAtStartup: true })
  assert.equal(pending.launchAtStartup, true)
  assert.equal(pending.launchAtStartupStatus, 'requires-approval')

  // Persisted intent survives a restart and an unrelated update.
  const reloaded = new DesktopPreferencesStore(filePath, adapter, TEST_VISIBILITY_CAPABILITIES)
  assert.equal(reloaded.get().launchAtStartup, true)
  assert.equal(reloaded.update({ soundEnabled: true }).launchAtStartup, true)

  status = 'enabled'
  assert.equal(reloaded.get().launchAtStartupStatus, 'enabled')
  status = 'not-in-applications'
  const outside = reloaded.update({ launchAtStartup: true })
  assert.equal(outside.launchAtStartup, true)
  assert.equal(outside.launchAtStartupStatus, 'not-in-applications')
  status = 'error'
  assert.equal(reloaded.update({ launchAtStartup: false }).launchAtStartup, false)
})

test('reports unsupported status and rejects status in patches', (t) => {
  const store = new DesktopPreferencesStore(tempPreferencesFile(t), {
    supported: false,
    getStatus: () => 'unsupported',
    setLaunchAtStartup: () => 'unsupported',
  })
  assert.equal(store.get().launchAtStartupStatus, 'unsupported')
  assert.throws(() => parseDesktopPreferencesPatch({ launchAtStartupStatus: 'enabled' }), /Unsupported desktop preference/)
})

test('answering Claude Code permissions is off by default and the wait is a bounded integer', (t) => {
  const filePath = tempPreferencesFile(t)
  const loginItem = { supported: false, getStatus: () => 'unsupported' as const, setLaunchAtStartup: () => 'unsupported' as const }
  const store = new DesktopPreferencesStore(filePath, loginItem, TEST_VISIBILITY_CAPABILITIES)
  assert.equal(store.get().claudePermissionRespondEnabled, false)
  assert.equal(store.get().claudePermissionWaitSeconds, 90)

  const updated = store.update({ claudePermissionRespondEnabled: true, claudePermissionWaitSeconds: 45 })
  assert.equal(updated.claudePermissionRespondEnabled, true)
  assert.equal(updated.claudePermissionWaitSeconds, 45)
  const reloaded = new DesktopPreferencesStore(filePath, loginItem, TEST_VISIBILITY_CAPABILITIES)
  assert.equal(reloaded.get().claudePermissionRespondEnabled, true)
  assert.equal(reloaded.get().claudePermissionWaitSeconds, 45)

  for (const bad of [14, 121, 30.5, '60', null, Number.NaN]) {
    assert.throws(() => parseDesktopPreferencesPatch({ claudePermissionWaitSeconds: bad }), TypeError, String(bad))
  }
  assert.throws(() => parseDesktopPreferencesPatch({ claudePermissionRespondEnabled: 'yes' }), TypeError)

  // A tampered file falls back to safe defaults.
  fs.writeFileSync(filePath, JSON.stringify({ claudePermissionRespondEnabled: 'true', claudePermissionWaitSeconds: 9_999 }))
  const tampered = new DesktopPreferencesStore(filePath, loginItem, TEST_VISIBILITY_CAPABILITIES)
  assert.equal(tampered.get().claudePermissionRespondEnabled, false)
  assert.equal(tampered.get().claudePermissionWaitSeconds, 90)
})

test('completion markers default on, persist, and only accept booleans', (t) => {
  const filePath = tempPreferencesFile(t)
  const loginItem = { supported: false, getStatus: () => 'unsupported' as const, setLaunchAtStartup: () => 'unsupported' as const }
  const store = new DesktopPreferencesStore(filePath, loginItem, TEST_VISIBILITY_CAPABILITIES)
  assert.equal(store.get().completionMarkersEnabled, true)

  assert.equal(store.update({ completionMarkersEnabled: false }).completionMarkersEnabled, false)
  assert.equal(JSON.parse(fs.readFileSync(filePath, 'utf8')).completionMarkersEnabled, false)
  assert.equal(new DesktopPreferencesStore(filePath, loginItem, TEST_VISIBILITY_CAPABILITIES).get().completionMarkersEnabled, false)

  assert.throws(() => parseDesktopPreferencesPatch({ completionMarkersEnabled: 'off' }), /must be boolean/)
  assert.throws(() => parseDesktopPreferencesPatch({ completionMarkersEnabled: 0 }), /must be boolean/)

  // A hand-edited file with a non-boolean value falls back to the default.
  fs.writeFileSync(filePath, JSON.stringify({ completionMarkersEnabled: 'no' }))
  assert.equal(new DesktopPreferencesStore(filePath, loginItem, TEST_VISIBILITY_CAPABILITIES).get().completionMarkersEnabled, true)
})

test('the pet only renders completion markers while the preference is on', () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'components', 'DesktopPet.vue'), 'utf8')
  assert.match(source, /<span v-if="store\.completionMarkersEnabled && store\.unreadResults\.count > 0" class="mini-status-count">/)
  assert.match(source, /v-if="store\.completionMarkersEnabled && store\.unreadResults\.count > 0"\s+class="unread-badge"/)
  assert.match(source, /v-if="store\.completionMarkersEnabled && store\.unreadResults\.count > 0"\s+class="edge-peek-result-badge"/)
  assert.doesNotMatch(source, /v-if="store\.unreadResults\.count > 0"/)
})

test('results are not counted while completion markers are off', async () => {
  const { noteUnread, UNREAD_RESULTS_MAX } = await import('../src/utils/unread-results.ts')
  const empty = { count: 0, hasError: false }
  assert.equal(noteUnread(empty, 'error', false, true), empty)
  assert.equal(noteUnread(empty, 'success', true, false), empty)
  assert.deepEqual(noteUnread(empty, 'success', true, true), { count: 1, hasError: false })
  assert.deepEqual(noteUnread({ count: 1, hasError: false }, 'error', true, true), { count: 2, hasError: true })
  assert.equal(noteUnread({ count: UNREAD_RESULTS_MAX, hasError: false }, 'success', true, true).count, UNREAD_RESULTS_MAX)

  // Switching markers off (locally or from another window's broadcast) drops what was counted.
  const store = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'stores', 'agentStore.ts'), 'utf8')
  assert.match(store, /function setCompletionMarkersEnabled\(enabled: boolean\) \{\s+completionMarkersEnabled\.value = enabled\s+if \(!enabled\) clearUnreadResults\(\)/)
  assert.match(store, /completionMarkersEnabled\.value = preferences\.completionMarkersEnabled !== false\s+if \(!completionMarkersEnabled\.value\) clearUnreadResults\(\)/)
  assert.match(store, /noteUnread\(unreadResults\.value, tone, completionMarkersEnabled\.value, away\)/)
})
