import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('agent session store keeps the existing bounded eviction and presentation behavior', () => {
  const source = read('../src/stores/agentStore.ts')
  assert.match(source, /const MAX_SESSION_COUNT = 200/)
  assert.match(source, /new Map<string, AgentSession>\(\)/)
  assert.match(source, /sessionIndex\.upsert\([\s\S]*?MAX_SESSION_COUNT\)/)
  assert.match(source, /sessionIndex\.updatePriority\(key, event\.state, event\.timestamp\)/)
  assert.match(source, /if \(event\.originalEvent === 'AgentPetsIntegrationTest' && event\.state === 'offline'\)/)
  assert.match(source, /prevState !== event\.state/)
  assert.match(source, /showToast\(event\.source, event\.project, event\.state\)/)
})

test('status panel preserves dashboard and settings navigation contracts', () => {
  const source = [
    '../src/components/StatusPanel.vue',
    '../src/components/status-panel/StatusPanelSessions.vue',
    '../src/components/status-panel/StatusPanelUsage.vue',
    '../src/components/status-panel/StatusPanelHistory.vue',
  ].map(read).join('\n')
  for (const id of ['sessions', 'usage', 'history', 'language', 'appearance', 'desktop', 'plugins', 'pets', 'growth', 'advanced']) {
    assert.ok(source.includes(`'${id}'`), `missing tab id ${id}`)
  }
  assert.match(source, /role="tablist"/)
  assert.match(source, /role="tabpanel"/)
  assert.match(source, /ArrowRight/)
  assert.match(source, /settingsTab\.value = 'appearance'/)
  assert.match(source, /onPanelOpenPluginView/)
  assert.match(source, /store\.decidePermission\(store\.permissionRequest\.requestId, \$event\)/)
  assert.match(source, /store\.clearOfflineSessions\(\)/)
  assert.match(source, /store\.sessionList\.filter\(session => session\.state !== 'offline'\)/)
  const shell = read('../src/components/StatusPanel.vue')
  assert.match(shell, /defineAsyncComponent\(\(\) => import\('@\/components\/status-panel\/SettingsAppearance\.vue'\)\)/)
  assert.match(shell, /void import\('@\/components\/status-panel\/SettingsAppearance\.vue'\)/)
})

test('plugin panel preserves install, settings, diagnostics and notification actions', () => {
  const source = read('../src/components/PluginPanel.vue')
  for (const key of [
    'pluginInstalledHeading', 'pluginCatalogHeading', 'pluginSettingsHeading',
    'pluginDiagnosticsHeading', 'pluginNotificationsHeading', 'pluginCommandsHeading',
  ]) assert.ok(source.includes(key), `missing visible section ${key}`)
  for (const action of [
    'openPluginPanel' + 'View', 'invokePlugin' + 'Command', 'savePluginSettings',
    'markNotificationRead', 'requestRemove', 'confirmInstall',
  ]) assert.ok(source.includes(action), `missing action ${action}`)
  assert.match(source, /role="alert"/)
  assert.match(source, /aria-live="polite"/)
})

test('renderer panel and extracted component files stay below the 500-line target', () => {
  const components = [
    '../src/components/PluginPanel.vue',
    '../src/components/plugin-panel/PluginPanelDialogs.vue',
    '../src/components/StatusPanel.vue',
    '../src/components/status-panel/StatusPanelHistory.vue',
    '../src/components/status-panel/StatusPanelSessions.vue',
    '../src/components/status-panel/StatusPanelUsage.vue',
    '../src/components/status-panel/SettingsAdvanced.vue',
    '../src/components/status-panel/SettingsAppearance.vue',
    '../src/components/status-panel/SettingsDesktop.vue',
    '../src/components/status-panel/SettingsGrowth.vue',
    '../src/components/status-panel/SettingsLanguage.vue',
    '../src/components/status-panel/SettingsPets.vue',
    '../src/components/status-panel/SettingsPlugins.vue',
  ]
  for (const path of components) {
    assert.ok(read(path).split('\n').length < 500, `${path} exceeds the component line target`)
  }
})

test('pet animation cadence and terminal frame behavior stay fixed', () => {
  const source = read('../src/components/PetAnimation.vue')
  for (const cadence of [
    'idle: { name: \'idle\', row: 0, frameDurations: [280, 110, 110, 140, 140, 320] }',
    'waving: { name: \'waving\', row: 3, frameDurations: [140, 140, 140, 280] }',
    'jumping: { name: \'jumping\', row: 4, frameDurations: [140, 140, 140, 140, 280] }',
  ]) assert.ok(source.includes(cadence), `missing animation cadence: ${cadence}`)
  assert.ok(source.includes('hold their final'))
  assert.ok(source.includes('frame until the store reports the next state'))
  assert.match(source, /function frameDelay\(\): number/)
  assert.match(source, /animationFrameId = requestAnimationFrame\(animationTick\)/)
  assert.match(source, /document\.addEventListener\('visibilitychange', handleDocumentVisibilityChange\)/)
  assert.doesNotMatch(source, /setTimeout\(tick, frameDelay\(\)\)/)
  const desktopPet = read('../src/components/DesktopPet.vue')
  assert.match(desktopPet, /shimejiReducedMotion\.value \|\| store\.petWindowMode\.mode === 'mini'/)
  assert.match(desktopPet, /:freeze="petAnimationFrozen"/)
})

test('app recurring work is tied to stale, success and quota activity', () => {
  const source = read('../src/App.vue')
  assert.match(source, /store\.cleanupStale\(\)/)
  assert.match(source, /watch\(\(\) => store\.hasSuccessSessions/)
  assert.match(source, /watch\(\(\) => store\.hasQuotaCapableSessions/)
  assert.match(source, /store\.handleSuccessTimeout\(\)/)
  assert.match(source, /store\.refreshQuota\(\)/)
  assert.match(source, /document\.addEventListener\('visibilitychange', onDocumentVisibilityChange\)/)
  assert.match(source, /if \(document\.hidden\) \{\s+stopRecurringTimers\(\)/)
})
