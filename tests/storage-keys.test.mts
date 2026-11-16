import assert from 'node:assert/strict'
import test from 'node:test'
import { STORAGE_KEYS, DEFAULT_PET_ID, MOOD_BASELINE, MOOD_SYSTEM_VERSION, type StorageKeyDefinition, type StorageKeyName } from '../src/utils/storage-keys.ts'
import { listenStorageSync, readStored, safeStorageReader, syncOn, writeStored } from '../src/utils/local-storage.ts'
import { isAgentFamilyKey } from '../src/types/agent.ts'
import { isAppLocale } from '../src/types/locale.ts'
import { isSettingsGroupId } from '../src/utils/settingsRegistry.ts'
import { parseStoredDashboardTab } from '../src/utils/plugin-tabs.ts'

// key 字串是使用者既有偏好的位置：任何一格變了，所有人的設定都會悄悄回到預設值。
// 新增 key 時在這裡補一列；改名或刪除要先在 phase report 記錄遷移方式。
const EXPECTED_KEYS: Record<StorageKeyName, string> = {
  petId: 'agent-pet-id',
  petScale: 'agent-pet-scale',
  hiddenBuiltinPets: 'agent-pet-hidden',
  familyPetIds: 'agent-pet-family-map',
  multiPet: 'agent-pet-multi',
  mood: 'agent-pet-mood',
  moodDate: 'agent-pet-mood-date',
  moodVersion: 'agent-pet-mood-version',
  moodVisuals: 'agent-pet-mood-visuals',
  patCount: 'agent-pet-pat',
  sound: 'agent-pet-sound',
  reactions: 'agent-pet-fx',
  bubble: 'agent-pet-bubble',
  ambient: 'agent-pet-ambient',
  activityBubble: 'agent-pet-activity',
  locale: 'agent-pet-locale',
  theme: 'agent-pet-theme',
  petTheme: 'agent-pet-pet-theme',
  coachSeen: 'agent-pet-coach-v1',
  achievementsSeenAt: 'agent-pet-achievements-seen-at',
  historyRange: 'agent-pet-history-range',
  historyCollapsed: 'agent-pet-history-collapsed',
  historyIntroDismissed: 'agent-pet-history-intro-dismissed',
  historyView: 'agent-pet-history-view',
  dashboardTab: 'agent-pets-dashboard-tab',
  settingsGroup: 'agent-pets-settings-group',
}

// 940a00b 時 App.vue（12 個）與 useTheme.ts（2 個）監聽的 key。
const EXPECTED_SYNCED = [
  'agent-pet-scale', 'agent-pet-id', 'agent-pet-family-map', 'agent-pet-sound', 'agent-pet-multi',
  'agent-pet-fx', 'agent-pet-bubble', 'agent-pet-ambient', 'agent-pet-activity', 'agent-pet-mood',
  'agent-pet-mood-visuals', 'agent-pet-locale', 'agent-pet-theme', 'agent-pet-pet-theme',
]

const names = Object.keys(STORAGE_KEYS) as StorageKeyName[]

test('the complete storage key list keeps its original strings', () => {
  assert.deepEqual(Object.fromEntries(names.map(name => [name, STORAGE_KEYS[name].key])), EXPECTED_KEYS)
  assert.equal(new Set(names.map(name => STORAGE_KEYS[name].key)).size, names.length, 'duplicate key string')
  assert.equal(DEFAULT_PET_ID, 'aang-airbender')
  assert.equal(MOOD_BASELINE, 10)
  assert.equal(MOOD_SYSTEM_VERSION, '2')
})

test('exactly the keys synced before are synced across windows', () => {
  const synced = names.filter(name => STORAGE_KEYS[name].sync).map(name => STORAGE_KEYS[name].key)
  assert.deepEqual(synced.sort(), [...EXPECTED_SYNCED].sort())
})

test('the registry is frozen', () => {
  assert.ok(Object.isFrozen(STORAGE_KEYS))
  for (const name of names) assert.ok(Object.isFrozen(STORAGE_KEYS[name]), name)
})

// 每個 key 在 940a00b 呼叫點的解析運算式，逐字照抄，作為對照的 oracle。
// startup／sync 分開的 key（fx、bubble、ambient、activity、mood、id、scale、locale）以 sync 規則對照；
// 啟動規則由下方的專門測試覆蓋。
const LEGACY_PARSE: Record<StorageKeyName, (raw: string | null) => unknown> = {
  petId: raw => raw || 'aang-airbender',
  petScale: raw => parseFloat(raw || '1'),
  hiddenBuiltinPets: raw => {
    try {
      const parsed = JSON.parse(raw || '[]')
      return Array.isArray(parsed) ? parsed.filter((id: unknown) => typeof id === 'string') : []
    } catch { return [] }
  },
  familyPetIds: json => {
    try {
      const parsed = JSON.parse(json || '{}')
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const out: Record<string, string> = {}
        for (const [k, v] of Object.entries(parsed)) if (isAgentFamilyKey(k) && typeof v === 'string') out[k] = v
        return out
      }
    } catch {}
    return {}
  },
  multiPet: raw => raw === '1',
  mood: raw => parseFloat(raw || String(10)),
  moodDate: raw => raw,
  moodVersion: raw => raw,
  moodVisuals: raw => raw !== '0',
  patCount: raw => {
    const [day, saved] = (raw ?? '').split(':')
    return { day, count: Number(saved) || 0 }
  },
  sound: raw => raw === '1',
  reactions: raw => raw !== '0',
  bubble: raw => raw !== '0',
  ambient: raw => raw === '1',
  activityBubble: raw => raw === '1',
  locale: raw => (isAppLocale(raw) ? raw : 'zh-TW'),
  theme: raw => (raw === 'system' || raw === 'light' || raw === 'dark' ? raw : 'system'),
  petTheme: raw => (raw === 'dark' || raw === 'light' || raw === 'follow' ? raw : 'dark'),
  coachSeen: raw => raw === '1',
  achievementsSeenAt: raw => Number(raw) || 0,
  historyRange: raw => [7, 30, 90].find(option => option === Number(raw)) ?? 7,
  historyCollapsed: raw => { try { return JSON.parse(raw ?? '{}') } catch { return {} } },
  historyIntroDismissed: raw => raw === '1',
  historyView: raw => (raw === 'sessions' ? 'sessions' : 'overview'),
  dashboardTab: raw => parseStoredDashboardTab(raw),
  settingsGroup: raw => (isSettingsGroupId(raw) ? raw : 'general'),
}

// 舊呼叫點在 storage 丟例外時的值；agentStore 的 key 原本沒有 try/catch（會讓 store 初始化失敗），
// 現在回退到缺值時的結果。
const LEGACY_UNAVAILABLE: Partial<Record<StorageKeyName, unknown>> = {
  coachSeen: true,
  historyIntroDismissed: false,
  historyView: 'overview',
  historyRange: 7,
  historyCollapsed: {},
  achievementsSeenAt: 0,
  dashboardTab: null,
  settingsGroup: 'general',
  theme: 'system',
  petTheme: 'dark',
  locale: 'zh-TW',
}

const SAMPLES: (string | null)[] = [
  null, '', '0', '1', 'true', 'false', 'abc', '2.5', '-3', '150', 'NaN', 'Infinity', '7', '30', '90', '31',
  '{}', '[]', 'null', '5', '"x"', '{bad json', '{"a":true,"b":false}', '["a",1,"b",null]',
  '{"claude":"cat","codex":5,"bogus":"x","opencode":"fox"}', '[["claude","x"]]',
  'sessions', 'overview', 'usage', 'history', 'plugin:com.example.tab', 'plugin:', 'plugin:../x',
  'zh-TW', 'en-US', 'en', 'system', 'light', 'dark', 'follow', 'general', 'pets', 'desktop', 'plugins', 'nope',
  '2026-11-10:3', '2026-11-10', ':', 'x:y:z', '2026-11-10:', 'aang-airbender', 'custom-pet-1',
]

test('every key parses missing and invalid values exactly like its old call site', () => {
  for (const name of names) {
    for (const raw of SAMPLES) {
      assert.deepEqual(STORAGE_KEYS[name].parse(raw), LEGACY_PARSE[name](raw), `${name} ← ${JSON.stringify(raw)}`)
    }
  }
})

test('the unavailable-storage value matches the old catch branch, else the missing-value result', () => {
  for (const name of names) {
    const expected = Object.hasOwn(LEGACY_UNAVAILABLE, name) ? LEGACY_UNAVAILABLE[name] : LEGACY_PARSE[name](null)
    assert.deepEqual(STORAGE_KEYS[name].fallback, expected, name)
  }
})

test('serialize writes the same strings the old call sites wrote', () => {
  assert.equal(STORAGE_KEYS.petScale.serialize(0.75), '0.75')
  assert.equal(STORAGE_KEYS.mood.serialize(42.5), '42.5')
  assert.equal(STORAGE_KEYS.sound.serialize(true), '1')
  assert.equal(STORAGE_KEYS.reactions.serialize(false), '0')
  assert.equal(STORAGE_KEYS.coachSeen.serialize(true), '1')
  assert.equal(STORAGE_KEYS.historyIntroDismissed.serialize(true), '1')
  assert.equal(STORAGE_KEYS.hiddenBuiltinPets.serialize(['a', 'b']), '["a","b"]')
  assert.equal(STORAGE_KEYS.familyPetIds.serialize({ claude: 'cat' }), '{"claude":"cat"}')
  assert.equal(STORAGE_KEYS.patCount.serialize({ day: '2026-11-10', count: 3 }), '2026-11-10:3')
  assert.equal(STORAGE_KEYS.historyRange.serialize(30), '30')
  assert.equal(STORAGE_KEYS.historyCollapsed.serialize({ agents: true }), '{"agents":true}')
  assert.equal(STORAGE_KEYS.achievementsSeenAt.serialize(1_700_000_000_000), '1700000000000')
  for (const name of names) {
    // 能寫回的值寫出去再讀回來不變（只讀的 null 例外）。
    const value = STORAGE_KEYS[name].fallback
    if (value === null) continue
    const entry = STORAGE_KEYS[name] as { parse(raw: string | null): unknown, serialize(value: unknown): string }
    assert.deepEqual(entry.parse(entry.serialize(value)), value, name)
  }
})

// --- helper -------------------------------------------------------------------

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, String(value)) },
    removeItem: (key: string) => { data.delete(key) },
  }
}

const throwing = {
  getItem() { throw new DOMException('denied', 'SecurityError') },
  setItem() { throw new DOMException('quota', 'QuotaExceededError') },
}

function withLocalStorage<R>(value: unknown, run: () => R): R {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { value, configurable: true, writable: true })
  try {
    return run()
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete (globalThis as { localStorage?: unknown }).localStorage
  }
}

test('reads go through parse and writes through serialize', () => {
  const storage = memoryStorage({ 'agent-pet-scale': '0.5', 'agent-pets-settings-group': 'bogus' })
  withLocalStorage(storage, () => {
    assert.equal(readStored(STORAGE_KEYS.petScale), 0.5)
    assert.equal(readStored(STORAGE_KEYS.settingsGroup), 'general')
    assert.equal(readStored(STORAGE_KEYS.coachSeen), false)
    assert.equal(writeStored(STORAGE_KEYS.multiPet, true), true)
    assert.equal(writeStored(STORAGE_KEYS.patCount, { day: '2026-11-10', count: 2 }), true)
  })
  assert.equal(storage.data.get('agent-pet-multi'), '1')
  assert.equal(storage.data.get('agent-pet-pat'), '2026-11-10:2')
})

test('a disabled or missing storage never throws and falls back', () => {
  for (const storage of [throwing, undefined]) {
    withLocalStorage(storage, () => {
      for (const name of names) {
        const entry: StorageKeyDefinition<unknown, never> = STORAGE_KEYS[name]
        assert.deepEqual(readStored(entry), entry.fallback, name)
      }
      assert.equal(writeStored(STORAGE_KEYS.sound, true), false)
      assert.equal(safeStorageReader.getItem('agent-pet-fx'), null)
    })
  }
  // 連讀取 `localStorage` 屬性本身都丟例外（某些沙箱環境）。
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new DOMException('denied', 'SecurityError') } })
  try {
    assert.equal(readStored(STORAGE_KEYS.coachSeen), true)
    assert.equal(writeStored(STORAGE_KEYS.coachSeen, true), false)
    assert.equal(safeStorageReader.getItem('agent-pet-fx'), null)
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete (globalThis as { localStorage?: unknown }).localStorage
  }
})

test('storage events are dispatched by key to the bound handler only', () => {
  const previousWindow = (globalThis as { window?: unknown }).window
  const target = new EventTarget()
  ;(globalThis as { window?: unknown }).window = target
  const calls: unknown[] = []
  try {
    const stop = listenStorageSync([
      syncOn(STORAGE_KEYS.petScale, (value, raw) => calls.push(['scale', value, raw])),
      syncOn(STORAGE_KEYS.familyPetIds, value => calls.push(['family', value])),
      syncOn(STORAGE_KEYS.ambient, value => calls.push(['ambient', value])),
    ])
    const fire = (key: string | null, newValue: string | null) =>
      target.dispatchEvent(Object.assign(new Event('storage'), { key, newValue }))
    fire('agent-pet-scale', '0.75')
    fire('agent-pet-family-map', '{"claude":"cat","bogus":"x"}')
    fire('agent-pet-ambient', null)
    fire('agent-pet-history-range', '30')
    fire(null, null)
    stop()
    fire('agent-pet-scale', '2')
  } finally {
    ;(globalThis as { window?: unknown }).window = previousWindow
  }
  assert.deepEqual(calls, [['scale', 0.75, '0.75'], ['family', { claude: 'cat' }], ['ambient', false]])
})

test('binding the same key twice is a programming error', () => {
  const noop = () => {}
  assert.throws(() => listenStorageSync([syncOn(STORAGE_KEYS.mood, noop), syncOn(STORAGE_KEYS.mood, noop)]), /duplicate/)
})
