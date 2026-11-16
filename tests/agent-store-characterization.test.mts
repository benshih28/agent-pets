// 階段 9 拆分 agentStore 前先固定的行為：在 Node 直接跑真的 store（假 localStorage、假 IPC、
// 假計時器），拆分前後同一組斷言都要通過。不依賴真實時間，所以在完整 test:unit 負載下也穩定。
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
  createAgentStoreHarness,
  START_TIME,
  type AgentStoreHarness,
} from './support/agent-store-harness.mts'
import { t } from '../src/i18n.ts'
import type { AgentSource, AgentState, AgentStatusEvent } from '../src/types/agent.ts'
import type { DesktopPreferences } from '../src/types/desktop.ts'
import type { PermissionRequestView } from '../src/types/permission.ts'
import { TOAST_ERROR_MS, TOAST_SUCCESS_MS, TOAST_WAITING_MS, WAITING_INPUT_DELAY_MS } from '../src/utils/pet-toast.ts'
import { SESSION_REMOVE_MS, SESSION_STALE_MS } from '../src/utils/session-lifecycle.ts'
import { PERMISSION_FAILURE_VISIBLE_MS, PERMISSION_OUTCOME_VISIBLE_MS } from '../src/utils/permission-view.ts'

let harness: AgentStoreHarness | null = null

function open(options: Parameters<typeof createAgentStoreHarness>[0] = {}): AgentStoreHarness {
  harness = createAgentStoreHarness(options)
  return harness
}

afterEach(() => {
  harness?.dispose()
  harness = null
})

// assert.equal(x, null) 會把 store 屬性窄化成 null，之後計時器推進或事件處理改變的值就變成 never；經由函式讀取才能反映真實狀態。
function peek<T>(read: () => T): T {
  return read()
}

function event(
  sessionId: string,
  state: AgentState,
  extra: Partial<AgentStatusEvent> = {},
): AgentStatusEvent {
  return { source: 'claude', sessionId, state, timestamp: Date.now(), ...extra }
}

function preferences(patch: Partial<DesktopPreferences> = {}): DesktopPreferences {
  return {
    dndEnabled: false,
    dndUntil: null,
    notificationsEnabled: true,
    permissionBubbleEnabled: true,
    claudePermissionRespondEnabled: false,
    claudePermissionWaitSeconds: 60,
    presentationMcpEnabled: true,
    achievementsEnabled: true,
    edgeModeEnabled: false,
    shimejiEnabled: false,
    captureExclusionEnabled: false,
    fullscreenAutoHideEnabled: false,
    rightClickHideEnabled: false,
    completionMarkersEnabled: true,
    sessionJumpEnabled: true,
    sessionJumpSwitchAppEnabled: true,
    soundEnabled: false,
    soundVolume: 60,
    soundOnPermission: true,
    soundOnError: true,
    soundOnSuccess: true,
    launchAtStartup: false,
    launchAtStartupSupported: false,
    launchAtStartupStatus: 'unsupported',
    locale: 'zh-TW',
    visibilityCapabilities: {
      captureExclusion: { supported: false, mode: 'unsupported' },
      fullscreenAutoHide: { supported: false, mode: 'unsupported' },
    },
    ...patch,
  }
}

function permissionRequest(requestId: string, patch: Partial<PermissionRequestView> = {}): PermissionRequestView {
  return {
    requestId,
    adapterId: 'opencode',
    agentId: 'opencode-cli',
    sessionId: 's-perm',
    generation: 1,
    action: 'bash',
    description: 'run tests',
    details: [],
    truncatedChars: 0,
    risk: 'medium',
    network: false,
    receivedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    status: 'pending',
    allowedDecisions: ['allow_once', 'deny'],
    queuePosition: 1,
    queueSize: 1,
    hotkeyEligible: false,
    truncated: false,
    ...patch,
  } as PermissionRequestView
}

// --- 對元件的 API ---------------------------------------------------------

const EXPECTED_ACTIONS = [
  'addProjectPet', 'applyDesktopPreferences', 'backToSessions', 'canSwitchToSessionApp', 'cleanupStale',
  'clearOfflineSessions', 'clearPresentation', 'clearUnreadResults', 'closePanel', 'closeProjectMcpPanel',
  'closeSetupWizard', 'completePluginFeed', 'decidePermission', 'dismissPermissionNotice', 'dismissPermissionOutcome',
  'dismissToast', 'getPetForFamily', 'getPresentationStatus', 'handleAchievementUnlocked', 'handleEvent',
  'handlePanelOpened', 'handlePluginFeedItem', 'handlePluginSkinsChanged', 'handlePresentationIntent',
  'handleProgressionAwarded', 'handleSuccessTimeout', 'initializeAchievements', 'initializeDesktopPreferences',
  'initializePermissionRequests', 'initializePetWindowMode', 'initializeProgression', 'loadPets', 'markPetInteraction',
  'openLoginItemsSettings', 'openPluginFeedLink', 'openProjectMcpPanel', 'openSettings', 'openSetupWizard', 'patPet',
  'pauseToast', 'quotaForecast', 'refreshProjectPets', 'refreshQuota', 'removePet', 'removeProjectPet', 'removeSession', 'renamePet',
  'resetMood', 'resizePetWindow', 'restoreSessionSnapshot', 'resumeToast', 'runSessionJump', 'sessionByKey',
  'setAchievementsEnabled', 'setAchievementsSnapshot', 'setActivityBubbleEnabled', 'setAmbientEnabled',
  'setBubbleEnabled', 'setCaptureExclusionEnabled', 'setClaudePermissionRespondEnabled',
  'setClaudePermissionWaitSeconds', 'setCompletionMarkersEnabled', 'setCueSink', 'setDndEnabled',
  'setEdgeModeEnabled', 'setFamilyPet', 'setFullscreenAutoHideEnabled', 'setLaunchAtStartup', 'setLocalePreference',
  'setMoodVisualsEnabled', 'setMultiPetEnabled', 'setNotificationsEnabled', 'setPanelModalLock', 'setPanelPinned',
  'setPermissionBubbleEnabled', 'setPermissionRequests', 'setPet', 'setPetMode', 'setPetWindowModeState',
  'setPluginFeedUnreadCount', 'setPresentationMcpEnabled', 'setProgressionPet', 'setProgressionSnapshot',
  'setProjectPetBinding', 'setProjectPetsEnabled', 'setQuotaUsage', 'setReactionsEnabled', 'setRightClickHideEnabled',
  'setScale', 'setSessionJumpEnabled', 'setSessionJumpSwitchAppEnabled', 'setShimejiEnabled', 'setSoundEnabled',
  'setSoundOption', 'syncFamilyPetIds', 'togglePanel',
]

const EXPECTED_STATE = [
  'achievementUnlock', 'achievements', 'achievementsEnabled', 'activePetId', 'activeSessions', 'activityBubbleActive',
  'activityBubbleEnabled', 'activityText', 'ambientActive', 'ambientEnabled', 'bubbleActive', 'bubbleEnabled',
  'captureExclusionEnabled', 'claudePermissionRespondEnabled', 'claudePermissionWaitSeconds',
  'completionMarkersEnabled', 'currentFamilyKey', 'currentSource', 'currentState', 'defaultPetId',
  'desktopPreferencesReady', 'desktopVisibilityCapabilities', 'dndEnabled', 'edgeModeEnabled', 'familyLines',
  'familyPetIds', 'fullscreenAutoHideEnabled', 'hasQuotaCapableSessions', 'hasSuccessSessions',
  'highestPrioritySession', 'isDragging', 'isMultiPet', 'launchAtStartup', 'launchAtStartupStatus',
  'launchAtStartupSupported', 'levelUpEvent', 'mood', 'moodVisualsEnabled', 'multiPetEnabled', 'notificationsEnabled',
  'panelOpenCount', 'panelPinned', 'panelRoute', 'panelView', 'permissionBubbleActive', 'permissionBubbleEnabled',
  'permissionNotice', 'permissionOutcome', 'permissionRequest', 'permissionRequests', 'petScale', 'petWindowMode',
  'pets', 'petsLoaded', 'pluginFeedItem', 'pluginFeedUnreadCount', 'presentationMcpEnabled', 'presentationReaction',
  'presentationSay', 'progression', 'projectPets', 'projectPetsEnabled', 'projectPetsError', 'projectPetsLoading',
  'quotaByFamily', 'quotaCheckedAt', 'quotaError', 'quotaLoading', 'quotaRefreshMs', 'quotaSettleDelayMs',
  'quotaSettleMinIntervalMs', 'quotaStaleSignal', 'quotaThrottleSec', 'quotaUsage', 'reactionsActive',
  'reactionsEnabled', 'recentAwards', 'rightClickHideEnabled', 'scaledH', 'scaledW', 'selectedPet',
  'sessionJumpEnabled', 'sessionJumpSwitchAppEnabled', 'sessionList', 'sessions', 'shimejiEnabled',
  'showProjectMcpPanel', 'showWizard', 'soundEnabled', 'soundOnError', 'soundOnPermission', 'soundOnSuccess',
  'soundVolume', 'toast', 'toastPaused', 'toastRemainingMs', 'unreadResults', 'visiblePets',
]

test('the store exposes exactly the same members, split the same way into actions and state', () => {
  const { store } = open()
  const members = Object.keys(store).filter(key => !key.startsWith('$') && !key.startsWith('_')).sort()
  const record = store as unknown as Record<string, unknown>
  assert.deepEqual(members.filter(key => typeof record[key] === 'function'), EXPECTED_ACTIONS)
  assert.deepEqual(members.filter(key => typeof record[key] !== 'function'), EXPECTED_STATE)
})

test('the refs that App.vue writes for cross-window sync stay writable on the store', () => {
  const { store, storage } = open()
  const writesBefore = storage.writes.length
  store.petScale = 1.5
  store.selectedPet = 'other-pet'
  store.soundEnabled = true
  store.multiPetEnabled = true
  store.reactionsEnabled = false
  store.bubbleEnabled = false
  store.ambientEnabled = true
  store.activityBubbleEnabled = true
  store.mood = 42
  store.moodVisualsEnabled = false
  store.isDragging = true
  store.syncFamilyPetIds({ codex: 'cat' })
  assert.equal(store.petScale, 1.5)
  assert.equal(store.selectedPet, 'other-pet')
  assert.equal(store.soundEnabled, true)
  assert.equal(store.multiPetEnabled, true)
  assert.equal(store.reactionsEnabled, false)
  assert.equal(store.bubbleEnabled, false)
  assert.equal(store.ambientEnabled, true)
  assert.equal(store.activityBubbleEnabled, true)
  assert.equal(store.mood, 42)
  assert.equal(store.moodVisualsEnabled, false)
  assert.equal(store.isDragging, true)
  assert.deepEqual(store.familyPetIds, { codex: 'cat' })
  // 同步寫入只更新本視窗的狀態，不能再寫回 storage（否則兩個視窗會互相觸發）。
  assert.equal(storage.writes.length, writesBefore)
})

// --- 偏好與 localStorage key ----------------------------------------------

test('preferences are read from and written to the existing localStorage keys', () => {
  const { store, storage } = open({
    storage: {
      'agent-pet-id': 'stored-pet',
      'agent-pet-scale': '0.75',
      'agent-pet-multi': '1',
      'agent-pet-fx': '0',
      'agent-pet-bubble': '1',
      'agent-pet-ambient': '1',
      'agent-pet-activity': '1',
      'agent-pet-mood-visuals': '0',
      'agent-pet-sound': '1',
      'agent-pet-family-map': JSON.stringify({ claude: 'monkey', nope: 'x' }),
      'agent-pet-hidden': JSON.stringify(['hidden-one']),
    },
  })
  assert.equal(store.selectedPet, 'stored-pet')
  assert.equal(store.petScale, 0.75)
  assert.equal(store.multiPetEnabled, true)
  assert.equal(store.reactionsEnabled, false)
  assert.equal(store.bubbleEnabled, true)
  assert.equal(store.ambientEnabled, true)
  assert.equal(store.activityBubbleEnabled, true)
  assert.equal(store.moodVisualsEnabled, false)
  assert.equal(store.soundEnabled, true)
  assert.deepEqual(store.familyPetIds, { claude: 'monkey' })

  storage.writes.length = 0
  store.setScale(1.25)
  store.setMultiPetEnabled(false)
  store.setReactionsEnabled(true)
  store.setBubbleEnabled(false)
  store.setAmbientEnabled(false)
  store.setActivityBubbleEnabled(false)
  store.setMoodVisualsEnabled(true)
  store.setFamilyPet('codex', 'cat')
  store.setFamilyPet('not-a-family', 'cat')
  store.setFamilyPet('claude', null)
  store.setPet('new-pet')
  assert.deepEqual(storage.writes, [
    ['agent-pet-scale', '1.25'],
    ['agent-pet-multi', '0'],
    ['agent-pet-fx', '1'],
    ['agent-pet-bubble', '0'],
    ['agent-pet-ambient', '0'],
    ['agent-pet-activity', '0'],
    ['agent-pet-mood-visuals', '1'],
    ['agent-pet-family-map', JSON.stringify({ claude: 'monkey', codex: 'cat' })],
    ['agent-pet-family-map', JSON.stringify({ codex: 'cat' })],
    ['agent-pet-id', 'new-pet'],
  ])
})

test('defaults apply when nothing is stored, and the mood reset is persisted at start', () => {
  const { store, storage } = open()
  assert.equal(store.selectedPet, 'aang-airbender')
  assert.equal(store.petScale, 1)
  assert.equal(store.multiPetEnabled, false)
  assert.equal(store.reactionsEnabled, true)
  assert.equal(store.bubbleEnabled, true)
  assert.equal(store.ambientEnabled, false)
  assert.equal(store.activityBubbleEnabled, false)
  assert.equal(store.soundEnabled, false)
  assert.equal(store.mood, 10)
  const today = new Date(START_TIME)
  assert.deepEqual(storage.writes, [
    ['agent-pet-mood', '10'],
    ['agent-pet-mood-date', `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`],
    ['agent-pet-mood-version', '2'],
  ])
})

// --- 心情 -----------------------------------------------------------------

function todayKey(): string {
  const d = new Date(START_TIME)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

test('a stored mood from today and the current version is kept and clamped', () => {
  const { store, storage } = open({
    storage: { 'agent-pet-mood': '140', 'agent-pet-mood-date': todayKey(), 'agent-pet-mood-version': '2' },
  })
  assert.equal(store.mood, 100)
  assert.equal(storage.writes.length, 0)
})

test('a stored mood from another day or an old version resets to the baseline', () => {
  for (const stale of [
    { 'agent-pet-mood': '80', 'agent-pet-mood-date': '2020-1-1', 'agent-pet-mood-version': '2' },
    { 'agent-pet-mood': '80', 'agent-pet-mood-date': todayKey(), 'agent-pet-mood-version': '1' },
  ]) {
    const { store, dispose } = createAgentStoreHarness({ storage: stale })
    assert.equal(store.mood, 10)
    dispose()
  }
})

test('success and error move the mood, and petting is capped at five per day', () => {
  const { store, storage } = open({
    storage: { 'agent-pet-mood': '50', 'agent-pet-mood-date': todayKey(), 'agent-pet-mood-version': '2' },
  })
  store.handleEvent(event('a', 'thinking'))
  store.handleEvent(event('a', 'success'))
  assert.equal(store.mood, 54)
  store.handleEvent(event('b', 'thinking'))
  store.handleEvent(event('b', 'error'))
  assert.equal(store.mood, 48)
  assert.equal(storage.values.get('agent-pet-mood'), '48')

  const results = Array.from({ length: 6 }, () => store.patPet())
  assert.deepEqual(results, [true, true, true, true, true, false])
  assert.equal(store.mood, 53)
  assert.equal(storage.values.get('agent-pet-pat'), `${todayKey()}:5`)

  store.resetMood()
  assert.equal(store.mood, 10)
})

test('completed tools and sustained work earn capped mood points within one task', () => {
  const { store } = open({
    storage: { 'agent-pet-mood': '20', 'agent-pet-mood-date': todayKey(), 'agent-pet-mood-version': '2' },
  })
  const start = Date.now()
  store.handleEvent(event('t', 'thinking', { timestamp: start, originalEvent: 'UserPromptSubmit' }))
  // 每完成兩個工具 +1，上限 8。
  for (let index = 0; index < 20; index += 1) {
    store.handleEvent(event('t', 'tool-running', { timestamp: start }))
    store.handleEvent(event('t', 'thinking', { timestamp: start }))
  }
  assert.equal(store.mood, 28)
  // 每 5 分鐘 +1，上限 4。
  store.handleEvent(event('t', 'thinking', { timestamp: start + 11 * 60_000 }))
  assert.equal(store.mood, 30)
  store.handleEvent(event('t', 'thinking', { timestamp: start + 60 * 60_000 }))
  assert.equal(store.mood, 32)
})

test('the presentation status reports mood bands and the fallback single pet', () => {
  const { store } = open({
    storage: { 'agent-pet-mood': '70', 'agent-pet-mood-date': todayKey(), 'agent-pet-mood-version': '2' },
  })
  assert.deepEqual(store.getPresentationStatus(), {
    activePets: [{
      petId: 'aang-airbender', name: 'aang-airbender', agentFamily: null, mood: 'happy', level: 1, visibleState: 'offline',
    }],
    dnd: false,
    enabled: true,
  })
  store.mood = 25
  assert.equal(store.getPresentationStatus().activePets[0]?.mood, 'low')
  store.mood = 26
  assert.equal(store.getPresentationStatus().activePets[0]?.mood, 'neutral')
})

// --- 工作階段 -------------------------------------------------------------

test('sessions are created, updated in place, ranked and removed by the integration test event', () => {
  const { store } = open()
  store.handleEvent(event('one', 'thinking', { project: 'C:/work/alpha', toolName: 'Bash' }))
  store.handleEvent(event('two', 'waiting-permission', { source: 'codex' }))
  assert.equal(store.sessionList.length, 2)
  assert.equal(store.currentState, 'waiting-permission')
  assert.equal(store.currentSource, 'codex')
  assert.equal(store.currentFamilyKey, 'codex')

  store.handleEvent(event('one', 'tool-running', { toolName: 'Read' }))
  const one = store.sessionByKey('claude:one')
  assert.equal(one?.state, 'tool-running')
  assert.equal(one?.toolName, 'Read')
  assert.equal(one?.firstSeenAt, START_TIME)
  assert.equal(store.sessions['claude:one']?.state, 'tool-running')

  store.handleEvent(event('two', 'offline', { source: 'codex', originalEvent: 'AgentPetsIntegrationTest' }))
  assert.equal(store.sessionByKey('codex:two'), undefined)
  assert.equal(store.currentState, 'tool-running')
  assert.equal(store.activityText, 'Read')
  assert.deepEqual(store.familyLines.map(line => [line.key, line.state, line.variants]), [['claude', 'tool-running', ['CLI']]])
})

test('the session list sorts by priority, then recency, then source label', () => {
  const { store } = open()
  const at = Date.now()
  store.handleEvent(event('idle', 'idle', { timestamp: at }))
  store.handleEvent(event('busy-old', 'thinking', { timestamp: at, source: 'codex' }))
  store.handleEvent(event('busy-new', 'thinking', { timestamp: at + 10 }))
  store.handleEvent(event('busy-tie', 'thinking', { timestamp: at, source: 'claude' }))
  store.handleEvent(event('error', 'error', { timestamp: at }))
  assert.deepEqual(store.sessionList.map(session => session.key), [
    'claude:error', 'claude:busy-new', 'claude:busy-tie', 'codex:busy-old', 'claude:idle',
  ])
})

test('at 200 sessions the oldest offline session is evicted first, then the oldest live one', () => {
  const { store } = open()
  const at = Date.now()
  store.handleEvent(event('gone', 'offline', { timestamp: at + 500 }))
  for (let index = 0; index < 199; index += 1) {
    store.handleEvent(event(`s${index}`, 'idle', { timestamp: at + index }))
  }
  assert.equal(store.sessionList.length, 200)
  store.handleEvent(event('new-1', 'thinking', { timestamp: at + 1_000 }))
  assert.equal(store.sessionByKey('claude:gone'), undefined)
  assert.equal(store.sessionList.length, 200)
  store.handleEvent(event('new-2', 'thinking', { timestamp: at + 1_001 }))
  assert.equal(store.sessionByKey('claude:s0'), undefined)
  assert.ok(store.sessionByKey('claude:s1'))
})

test('stale sweeps mark silent sessions offline and drop long-offline ones; pending permission keeps a wait alive', () => {
  const { store, tick } = open()
  store.handleEvent(event('quiet', 'thinking'))
  store.handleEvent(event('perm', 'waiting-permission'))
  store.setPermissionRequests([permissionRequest('r1')])
  tick(SESSION_STALE_MS + 1)
  store.setPermissionRequests([permissionRequest('r1', { expiresAt: Date.now() + 60_000 })])
  store.cleanupStale()
  assert.equal(store.sessionByKey('claude:quiet')?.state, 'offline')
  assert.equal(store.sessionByKey('claude:perm')?.state, 'waiting-permission')
  tick(SESSION_REMOVE_MS)
  store.cleanupStale()
  assert.equal(store.sessionByKey('claude:quiet'), undefined)

  store.handleEvent(event('off', 'offline'))
  store.clearOfflineSessions()
  assert.equal(store.sessionByKey('claude:off'), undefined)
})

test('a turn whose end never arrives settles to idle quietly, and the next real event takes over', () => {
  const { store, tick } = open()
  store.handleEvent(event('stuck', 'thinking', { originalEvent: 'UserPromptSubmit' }))
  store.handleEvent(event('build', 'tool-running'))
  tick(5 * 60_000 + 1)
  store.cleanupStale()
  assert.equal(store.sessionByKey('claude:stuck')?.state, 'idle')
  // 工具可以合法地跑很久，不會因為安靜就被改掉。
  assert.equal(store.sessionByKey('claude:build')?.state, 'tool-running')
  // 降級只改顯示：沒有提示框，也不當成工作完成。
  assert.equal(peek(() => store.toast), null)

  // 回合其實還在跑：後續事件照常蓋過，完成時仍然有完成的提示。
  store.handleEvent(event('stuck', 'tool-running'))
  assert.equal(store.sessionByKey('claude:stuck')?.state, 'tool-running')
  assert.equal(store.handleEvent(event('stuck', 'success')), 'success')
  assert.ok(store.toast)
})

test('the two sweep entry points are the same sweep', () => {
  const { store, tick } = open()
  store.handleEvent(event('done', 'success'))
  store.handleEvent(event('quiet', 'thinking'))
  tick(4_001)
  store.cleanupStale()
  assert.equal(store.sessionByKey('claude:done')?.state, 'idle')
  tick(SESSION_STALE_MS)
  store.handleSuccessTimeout()
  assert.equal(store.sessionByKey('claude:quiet')?.state, 'offline')
  assert.equal(store.sessionByKey('claude:done')?.state, 'offline')
})

test('success turns idle after the display window, and a restored snapshot never overwrites live data', () => {
  const { store, tick } = open()
  store.handleEvent(event('done', 'success'))
  store.handleSuccessTimeout()
  assert.equal(store.sessionByKey('claude:done')?.state, 'success')
  tick(60_000)
  store.handleSuccessTimeout()
  assert.equal(store.sessionByKey('claude:done')?.state, 'idle')

  const now = Date.now()
  const restored = store.restoreSessionSnapshot([
    { source: 'claude', sessionId: 'done', state: 'error', lastSeenAt: now },
    { source: 'codex', sessionId: 'back', state: 'thinking', lastSeenAt: now - 1_000, project: 'p', host: { kind: 'terminal', app: 'bogus' } },
    { source: 'codex', sessionId: 'old', state: 'thinking', lastSeenAt: now - SESSION_REMOVE_MS - 1 },
    { source: 'codex', sessionId: 'bad', state: 'nope', lastSeenAt: now },
    'junk',
  ])
  assert.equal(restored, 1)
  assert.equal(store.sessionByKey('claude:done')?.state, 'idle')
  const back = store.sessionByKey('codex:back')
  assert.equal(back?.firstSeenAt, now - 1_000)
  assert.equal(back?.host, undefined)
  assert.equal(peek(() => store.toast), null)
})

test('handleEvent returns the sound cue for new terminal and permission states only', () => {
  const { store, tick } = open()
  assert.equal(store.handleEvent(event('a', 'waiting-permission')), 'waiting-permission')
  assert.equal(store.handleEvent(event('a', 'waiting-permission')), null)
  assert.equal(store.handleEvent(event('a', 'error')), 'error')
  assert.equal(store.handleEvent(event('a', 'error')), null)
  store.handleEvent(event('quick', 'thinking'))
  assert.equal(store.handleEvent(event('quick', 'success')), null)
  store.handleEvent(event('long', 'thinking'))
  tick(15_000)
  assert.equal(store.handleEvent(event('long', 'success')), 'success')
  assert.equal(store.handleEvent(event('x', 'thinking')), null)
})

test('a finished quota-capable session bumps the stale signal', () => {
  const { store } = open()
  store.handleEvent(event('q', 'success', { source: 'opencode-cli' as AgentSource }))
  assert.equal(store.quotaStaleSignal, 0)
  store.handleEvent(event('q', 'success', { source: 'codex' }))
  assert.equal(store.quotaStaleSignal, 1)
})

test('the active pet follows a known routed pet, then the family override (visible pets only), then the selection', async () => {
  const list = [
    { id: 'aang-airbender', displayName: 'Aang', folder: 'a', builtIn: true },
    { id: 'cat', displayName: 'Cat', folder: 'c', builtIn: true },
    { id: 'monkey', displayName: 'Monkey', folder: 'm', builtIn: true },
  ]
  const { store } = open({
    storage: { 'agent-pet-hidden': JSON.stringify(['monkey']), 'agent-pet-multi': '1' },
    api: { loadPets: () => Promise.resolve(list) },
  })
  await store.loadPets()
  store.setFamilyPet('codex', 'cat')
  store.setFamilyPet('claude', 'monkey')
  store.handleEvent(event('c1', 'thinking', { source: 'codex' }))
  assert.equal(store.activePetId, 'cat')
  store.handleEvent(event('c1', 'thinking', { source: 'codex', routedPetId: 'monkey' }))
  assert.equal(store.activePetId, 'monkey')
  store.handleEvent(event('c1', 'thinking', { source: 'codex', routedPetId: 'unknown-pet' }))
  assert.equal(store.activePetId, 'cat')
  store.handleEvent(event('c1', 'idle', { source: 'codex' }))
  store.handleEvent(event('k1', 'error'))
  assert.equal(store.getPetForFamily('claude'), 'aang-airbender')
  assert.equal(store.activePetId, 'aang-airbender')
  assert.deepEqual(store.familyLines.map(line => [line.key, line.petId]), [['codex', 'cat'], ['claude', 'aang-airbender']])
  assert.deepEqual(store.getPresentationStatus().activePets.map(pet => pet.name), ['Cat', 'Aang'])
  store.setMultiPetEnabled(false)
  store.handleEvent(event('c1', 'error', { source: 'codex' }))
  store.handleEvent(event('k1', 'idle'))
  assert.equal(store.activePetId, 'aang-airbender')
})

// --- Toast 提示 -----------------------------------------------------------

test('a success toast merges with the previous success and closes after its TTL', () => {
  const { store, tick } = open()
  store.handleEvent(event('a', 'thinking', { project: 'C:/work/alpha' }))
  tick(20_000)
  store.handleEvent(event('a', 'success', { project: 'C:/work/alpha' }))
  assert.equal(store.toast?.tone, 'success')
  assert.equal(store.toast?.title, t('pet.toastDone'))
  assert.equal(store.toast?.count, 1)
  assert.equal(store.toast?.meta, 'Claude CLI · alpha')
  assert.equal(store.toast?.detail, t('pet.toastElapsed', { time: '20s' }))
  assert.equal(store.toast?.countdown.durationMs, TOAST_SUCCESS_MS)
  const firstId = store.toast?.id

  store.handleEvent(event('b', 'success'))
  assert.equal(store.toast?.count, 2)
  assert.equal(store.toast?.title, t('pet.toastManyDone', { count: 2 }))
  assert.equal(store.toast?.meta, '')
  assert.equal(store.toast?.detail, undefined)
  assert.notEqual(store.toast?.id, firstId)

  tick(100)
  assert.equal(store.toastRemainingMs, TOAST_SUCCESS_MS - 100)
  tick(TOAST_SUCCESS_MS - 101)
  assert.ok(store.toast)
  tick(1)
  assert.equal(peek(() => store.toast), null)
  assert.equal(store.toastRemainingMs, 0)
})

test('an error toast replaces a success toast instead of merging, and uses the error TTL', () => {
  const { store, tick } = open()
  store.handleEvent(event('a', 'success'))
  store.handleEvent(event('b', 'error'))
  assert.equal(store.toast?.tone, 'error')
  assert.equal(store.toast?.count, 1)
  assert.equal(store.toast?.title, t('pet.toastFailed'))
  tick(TOAST_ERROR_MS - 1)
  assert.ok(store.toast)
  tick(1)
  assert.equal(peek(() => store.toast), null)
})

test('hover pauses the countdown and resume continues from what was left', () => {
  const { store, tick } = open()
  store.handleEvent(event('a', 'success'))
  tick(1_000)
  store.pauseToast()
  assert.equal(store.toastPaused, true)
  assert.equal(store.toastRemainingMs, TOAST_SUCCESS_MS - 1_000)
  tick(60_000)
  assert.ok(store.toast)
  store.resumeToast()
  assert.equal(store.toastPaused, false)
  tick(TOAST_SUCCESS_MS - 1_001)
  assert.ok(store.toast)
  tick(1)
  assert.equal(peek(() => store.toast), null)
})

test('an unanswered prompt shows the waiting toast after the grace period and asks for its cue', () => {
  const { store, tick } = open()
  const cues: string[] = []
  store.setCueSink(cue => cues.push(cue))
  store.handleEvent(event('w', 'waiting-input'))
  tick(WAITING_INPUT_DELAY_MS - 1)
  assert.equal(peek(() => store.toast), null)
  tick(1)
  assert.equal(store.toast?.tone, 'waiting')
  assert.equal(store.toast?.title, t('pet.toastWaiting'))
  assert.equal(store.toast?.countdown.durationMs, TOAST_WAITING_MS)
  assert.deepEqual(cues, ['waiting-input'])

  store.dismissToast()
  store.handleEvent(event('w2', 'waiting-input'))
  store.handleEvent(event('w2', 'thinking'))
  tick(WAITING_INPUT_DELAY_MS)
  assert.equal(peek(() => store.toast), null)
})

test('results that finish while you are away become unread markers', () => {
  const { store, tick } = open()
  store.handleEvent(event('a', 'success'))
  assert.deepEqual(store.unreadResults, { count: 0, hasError: false })
  tick(45_000)
  store.handleEvent(event('b', 'error'))
  assert.deepEqual(store.unreadResults, { count: 1, hasError: true })
  store.clearUnreadResults()
  assert.deepEqual(store.unreadResults, { count: 0, hasError: false })
})

// --- Presentation 與 plugin feed -----------------------------------------

function intent(id: string, patch: Record<string, unknown> = {}) {
  return { id, kind: 'react', reaction: 'happy', createdAt: Date.now(), expiresAt: Date.now() + 1_000, ...patch }
}

test('presentation intents are ignored until desktop preferences arrive', () => {
  const { store } = open()
  store.handlePresentationIntent(intent('early'))
  assert.equal(peek(() => store.presentationReaction), null)
})

test('presentation intents play in order, expire, and respect the queue bound', () => {
  const { store, tick } = open()
  store.applyDesktopPreferences(preferences())
  store.handlePresentationIntent(intent('r1'))
  store.handlePresentationIntent({ id: 's1', kind: 'say', message: '  hi\u0000 <b>there</b>  ', createdAt: Date.now(), expiresAt: Date.now() + 2_000 })
  assert.deepEqual(store.presentationReaction, { id: 'r1', reaction: 'happy' })
  assert.equal(peek(() => store.presentationSay), null)
  tick(1_000)
  assert.equal(peek(() => store.presentationReaction), null)
  assert.equal(store.presentationSay?.message, 'hi b there /b')
  tick(1_000)
  assert.equal(peek(() => store.presentationSay), null)

  // 佇列上限 8：超過時丟最舊的。
  store.handlePresentationIntent(intent('active', { expiresAt: Date.now() + 10_000 }))
  for (let index = 0; index < 9; index += 1) {
    store.handlePresentationIntent(intent(`q${index}`, { expiresAt: Date.now() + 60_000 }))
  }
  tick(10_000)
  assert.equal(store.presentationReaction?.id, 'q1')
})

test('urgent agent states, DND and the MCP switch clear presentation, but plugin reactions survive the MCP switch', () => {
  const { store, tick } = open()
  store.applyDesktopPreferences(preferences())
  store.handlePresentationIntent(intent('r1'))
  store.handleEvent(event('x', 'waiting-input'))
  assert.equal(peek(() => store.presentationReaction), null)
  store.handlePresentationIntent(intent('blocked'))
  assert.equal(peek(() => store.presentationReaction), null)
  store.handleEvent(event('x', 'idle'))

  store.handlePresentationIntent(intent('plugin', { source: 'plugin', expiresAt: Date.now() + 5_000 }))
  store.handlePresentationIntent(intent('mcp', { expiresAt: Date.now() + 5_000 }))
  assert.equal(store.presentationReaction?.id, 'plugin')
  store.setPresentationMcpEnabled(false)
  assert.equal(store.presentationReaction?.id, 'plugin')
  store.handlePresentationIntent(intent('mcp-2'))
  tick(5_000)
  assert.equal(peek(() => store.presentationReaction), null)

  store.applyDesktopPreferences(preferences({ dndEnabled: true }))
  store.handlePresentationIntent(intent('plugin-dnd', { source: 'plugin' }))
  assert.equal(peek(() => store.presentationReaction), null)
})

test('presentation intents for an unknown pet or with an invalid shape are dropped', () => {
  const { store } = open()
  store.applyDesktopPreferences(preferences())
  for (const bad of [
    intent('a', { petId: 'someone-else' }),
    intent('b', { reaction: 'explode' }),
    intent('c', { expiresAt: Date.now() }),
    intent('d', { source: 'plugin', kind: 'say', message: 'x' }),
    { id: 'e', kind: 'say', message: '   ', createdAt: Date.now(), expiresAt: Date.now() + 1_000 },
    null,
  ]) store.handlePresentationIntent(bad)
  assert.equal(peek(() => store.presentationReaction), null)
  assert.equal(peek(() => store.presentationSay), null)
  store.handlePresentationIntent(intent('ok', { petId: 'aang-airbender' }))
  assert.deepEqual(store.presentationReaction, { id: 'ok', reaction: 'happy', petId: 'aang-airbender' })
})

function feedItem(id: string, patch: Record<string, unknown> = {}) {
  return {
    id,
    pluginId: 'demo-plugin',
    pluginName: { 'zh-TW': '示範', 'en-US': 'Demo' },
    title: 'Title',
    body: 'Body',
    priority: 'normal',
    createdAt: Date.now(),
    expiresAt: Date.now() + 10_000,
    ...patch,
  }
}

test('a plugin feed item is shown until it expires, then reported complete to main', () => {
  const { store, tick, calls } = open()
  store.handlePluginFeedItem(feedItem('feed-0001', { link: 'https://example.com/a', iconUrl: 'agent-pets://plugin/demo-plugin/icon.png' }))
  assert.equal(store.pluginFeedItem?.id, 'feed-0001')
  assert.equal(store.pluginFeedItem?.link, 'https://example.com/a')
  store.handlePluginFeedItem(feedItem('feed-0002', { link: 'http://example.com' }))
  assert.equal(store.pluginFeedItem?.id, 'feed-0001')
  store.handlePluginFeedItem(feedItem('feed-0003', { expiresAt: Date.now() + 20_000 }))
  assert.equal(store.pluginFeedItem?.id, 'feed-0001')
  tick(10_000)
  assert.equal(store.pluginFeedItem, null)
  assert.deepEqual(calls.filter(call => call.name === 'completePluginFeed').map(call => call.args), [['feed-0001']])

  store.setPluginFeedUnreadCount(5)
  assert.equal(store.pluginFeedUnreadCount, 5)
  store.setPluginFeedUnreadCount(-3)
  assert.equal(store.pluginFeedUnreadCount, 0)
  store.setPluginFeedUnreadCount(1.5)
  assert.equal(store.pluginFeedUnreadCount, 0)
})

// --- Permission UI --------------------------------------------------------

test('a request that vanishes settles its waiting session and shows a brief outcome', () => {
  const { store, tick } = open()
  store.handleEvent(event('s-perm', 'waiting-permission', { source: 'opencode-cli' as AgentSource }))
  store.setPermissionRequests([permissionRequest('r1'), { requestId: 'broken' }])
  assert.equal(store.permissionRequests.length, 1)
  assert.equal(store.permissionRequest?.requestId, 'r1')
  store.setPermissionRequests([])
  assert.equal(store.sessionByKey('opencode-cli:s-perm')?.state, 'idle')
  assert.equal(store.permissionOutcome?.requestId, 'r1')
  tick(PERMISSION_OUTCOME_VISIBLE_MS)
  assert.equal(store.permissionOutcome, null)
})

test('a decision returns the classified result; only delivered or final ones settle the session', async () => {
  let response: unknown = { ok: false, error: 'delivery_failed' }
  const { store, tick, flush } = open({ api: { decidePermission: () => Promise.resolve(response) } })
  store.handleEvent(event('s-perm', 'waiting-permission', { source: 'opencode-cli' as AgentSource }))
  store.setPermissionRequests([permissionRequest('r1')])
  const failed = await store.decidePermission('r1', 'allow_once')
  assert.equal(failed.ok, false)
  assert.equal(store.sessionByKey('opencode-cli:s-perm')?.state, 'waiting-permission')
  assert.equal(store.permissionOutcome?.requestId, 'r1')
  tick(PERMISSION_FAILURE_VISIBLE_MS)
  assert.equal(store.permissionOutcome, null)

  response = { ok: true, status: 'allowed' }
  const delivered = await store.decidePermission('r1', 'allow_once')
  await flush()
  assert.equal(delivered.ok, true)
  assert.equal(store.sessionByKey('opencode-cli:s-perm')?.state, 'idle')
  assert.deepEqual(await store.decidePermission('missing', 'deny'), { ok: false, kind: 'cancelled' })
})

test('external-only permission notices list every waiting session until dismissed', () => {
  const { store } = open()
  const notice = { responseMode: 'external_only' } as AgentStatusEvent['permissionNotice']
  store.handleEvent(event('n1', 'waiting-permission', { permissionNotice: notice, project: 'C:/a/one' }))
  store.handleEvent(event('n2', 'waiting-permission', { source: 'codex', permissionNotice: notice }))
  assert.equal(store.permissionNotice?.items.length, 2)
  assert.equal(store.permissionNotice?.title, t('permission.noticeTitleMulti', { count: 2 }))
  store.dismissPermissionNotice()
  assert.equal(peek(() => store.permissionNotice), null)
  store.handleEvent(event('n1', 'thinking'))
  store.handleEvent(event('n1', 'waiting-permission', { permissionNotice: notice, project: 'C:/a/one' }))
  assert.equal(store.permissionNotice?.items.length, 1)
})

// --- 面板導航 -------------------------------------------------------------

test('panel navigation follows the route machine and drives the blur lock', async () => {
  const { store, calls, flush } = open()
  assert.equal(store.panelView, 'sessions')
  store.openSettings()
  assert.equal(store.panelView, 'settings')
  store.openSetupWizard()
  assert.equal(store.showWizard, true)
  await flush()
  assert.deepEqual(calls.filter(call => call.name === 'setPanelBlurLock').map(call => call.args[0]), [{ modal: true }])
  store.closePanel()
  assert.equal(store.showWizard, false)
  await flush()
  const names = calls.map(call => call.name)
  assert.ok(names.indexOf('hidePanel') < names.lastIndexOf('resizePanel'))
  assert.deepEqual(calls.filter(call => call.name === 'resizePanel').at(-1)?.args, [{ release: true }])

  store.setPanelModalLock('confirm', true)
  await flush()
  store.setPanelModalLock('confirm', false)
  await flush()
  store.setPanelPinned(true)
  assert.deepEqual(calls.filter(call => call.name === 'setPanelBlurLock').map(call => call.args[0]), [
    { modal: true }, { modal: false }, { modal: true }, { modal: false }, { pinned: true },
  ])

  store.openSettings()
  store.handlePanelOpened({ restore: true })
  assert.equal(store.panelView, 'settings')
  store.handlePanelOpened()
  assert.equal(store.panelView, 'sessions')
  assert.equal(store.panelOpenCount, 2)
})

// --- 桌面偏好 -------------------------------------------------------------

test('desktop preferences from main update the mirrored state and the cached sound flag', () => {
  const { store, storage } = open()
  assert.equal(store.desktopPreferencesReady, false)
  assert.equal(store.bubbleActive, false)
  store.applyDesktopPreferences(preferences({ soundEnabled: true, completionMarkersEnabled: false }))
  assert.equal(store.desktopPreferencesReady, true)
  assert.equal(store.soundEnabled, true)
  assert.equal(store.completionMarkersEnabled, false)
  assert.equal(store.bubbleActive, true)
  assert.equal(store.permissionBubbleActive, true)
  assert.equal(storage.values.get('agent-pet-sound'), '1')
  store.applyDesktopPreferences(preferences({ dndEnabled: true }))
  assert.equal(store.bubbleActive, false)
  assert.equal(store.reactionsActive, false)
})

// --- 階段 9 新增：store 結束時清掉所有計時器 ---------------------------------

test('disposing the store clears pending toast, waiting reminder, feed and permission outcome timers', () => {
  const { store, liveTimers, tick } = open()
  store.handleEvent(event('a', 'success'))
  store.handleEvent(event('w', 'waiting-input', { source: 'codex' }))
  store.handlePluginFeedItem(feedItem('feed-0001'))
  store.handleEvent(event('s-perm', 'waiting-permission', { source: 'opencode-cli' as AgentSource }))
  store.setPermissionRequests([permissionRequest('r1')])
  store.setPermissionRequests([])
  assert.ok(store.toast)
  assert.ok(store.pluginFeedItem)
  assert.ok(store.permissionOutcome)
  // toast 到期＋進度、等待輸入提醒、feed、權限結果卡片。
  assert.equal(liveTimers(), 5)
  store.$dispose()
  assert.equal(liveTimers(), 0)
  tick(120_000)
  assert.ok(store.toast, 'a disposed store no longer runs its timers')
})

test('disposing the store clears the presentation timer', () => {
  const { store, liveTimers } = open()
  store.applyDesktopPreferences(preferences())
  store.handlePresentationIntent(intent('r1', { expiresAt: Date.now() + 60_000 }))
  assert.ok(store.presentationReaction)
  assert.equal(liveTimers(), 1)
  store.$dispose()
  assert.equal(liveTimers(), 0)
})
