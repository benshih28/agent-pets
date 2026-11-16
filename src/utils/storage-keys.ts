// Renderer localStorage 的單一 key 清單：key 字串、值型別、預設值、解析／序列化與是否跨視窗同步。
// key 字串是使用者既有偏好的位置，改名等於清掉所有人的設定；`tests/storage-keys.test.mts` 固定完整清單。
// 解析規則逐一照搬自各呼叫點的舊實作（含「無效值回退預設」的細節差異），不是統一後的新規則。
// 讀寫一律經過 `src/utils/local-storage.ts`，那裡負責 storage 停用或丟例外時的回退。
// Node 測試會直接載入本檔，所以執行期 import 只用相對路徑（見 agent-pets-conventions §1）。
import { isAgentFamilyKey } from '../types/agent.ts'
import { deepFreeze } from '../types/freeze.ts'
import { HISTORY_RANGE_OPTIONS, type HistoryRangeDays } from '../types/history.ts'
import { DEFAULT_LOCALE, isAppLocale, type AppLocale } from '../types/locale.ts'
import { isPetThemePreference, isThemePreference, type PetThemePreference, type ThemePreference } from '../types/theme.ts'
import { parseStoredDashboardTab } from './plugin-tabs.ts'
import { DEFAULT_SETTINGS_GROUP, isSettingsGroupId, type SettingsGroupId } from './settingsRegistry.ts'
import { DEFAULT_PET_ID } from './pet-id.ts'

// 主程序與 renderer 共用同一個預設寵物 id；既有的 renderer 呼叫端仍從這裡取用。
export { DEFAULT_PET_ID }

/** 心情每天的起始值。 */
export const MOOD_BASELINE = 10
/** 心情系統版本；`agent-pet-mood-version` 不等於它時，啟動會把心情重設回起始值（migration）。 */
export const MOOD_SYSTEM_VERSION = '2'

/**
 * @typeParam T 讀出來的值。
 * @typeParam W 寫入時接受的值；只寫不讀的空值（例如「沒有記住的分頁」）不必能寫回。
 */
export interface StorageKeyDefinition<T, W = T> {
  readonly key: string
  /** 缺值（`null`）與無效值都在這裡回退；不可丟例外。 */
  parse(raw: string | null): T
  serialize(value: W): string
  /** storage 不存在或讀取丟例外時的值。沒有特別指定時等於 `parse(null)`。 */
  readonly fallback: T
  /** 其他視窗寫入這個 key 時，本視窗是否經 `listenStorageSync` 接收。 */
  readonly sync: boolean
}

interface StorageKeyInput<K extends string, T, W, S extends boolean> {
  key: K
  parse(raw: string | null): T
  serialize(value: W): string
  fallback?: T
  sync: S
}

function defineStorageKey<const K extends string, T, W = T, const S extends boolean = boolean>(
  input: StorageKeyInput<K, T, W, S>,
): StorageKeyDefinition<T, W> & { readonly key: K, readonly sync: S } {
  return { ...input, fallback: input.fallback ?? input.parse(null) }
}

// '1'／'0' 旗標的兩種舊規則：預設關的開關只認 '1'，預設開的開關只有 '0' 算關。
const onlyOne = (raw: string | null): boolean => raw === '1'
const notZero = (raw: string | null): boolean => raw !== '0'
const flag = (value: boolean): string => (value ? '1' : '0')
const asIs = (value: string): string => value
const rawOrNull = (raw: string | null): string | null => raw
const numberText = (value: number): string => String(value)

function parseHiddenBuiltins(raw: string | null): string[] {
  try {
    const parsed: unknown = JSON.parse(raw || '[]')
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

// 只收家族 registry 裡的 key 與字串值：寫回時不會把手改或舊版留下的雜項帶下去，
// 另一個視窗也不能塞進非字串的值。
function parseFamilyPetIds(raw: string | null): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(raw || '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(parsed)) {
        if (isAgentFamilyKey(k) && typeof v === 'string') out[k] = v
      }
      return out
    }
  } catch {}
  return {}
}

export interface PatCount {
  /** 本機日期（`YYYY-M-D`，與心情的日期 key 同格式）。 */
  day: string
  count: number
}

function parsePatCount(raw: string | null): PatCount {
  const [day, saved] = (raw ?? '').split(':')
  return { day, count: Number(saved) || 0 }
}

function parseHistoryRange(raw: string | null): HistoryRangeDays {
  const stored = Number(raw)
  return HISTORY_RANGE_OPTIONS.find(option => option === stored) ?? 7
}

// 舊實作只做 JSON.parse、不檢查形狀；維持原樣，避免把現在讀得到的收合狀態判成無效。
function parseHistoryCollapsed(raw: string | null): Record<string, boolean> {
  try {
    return JSON.parse(raw ?? '{}') as Record<string, boolean>
  } catch {
    return {}
  }
}

export type HistoryView = 'overview' | 'sessions'

export const STORAGE_KEYS = deepFreeze({
  // --- 寵物 ------------------------------------------------------------------
  petId: defineStorageKey({ key: 'agent-pet-id', parse: raw => raw || DEFAULT_PET_ID, serialize: asIs, sync: true }),
  petScale: defineStorageKey({ key: 'agent-pet-scale', parse: raw => parseFloat(raw || '1'), serialize: numberText, sync: true }),
  hiddenBuiltinPets: defineStorageKey({ key: 'agent-pet-hidden', parse: parseHiddenBuiltins, serialize: (ids: readonly string[]) => JSON.stringify(ids), sync: false }),
  familyPetIds: defineStorageKey({ key: 'agent-pet-family-map', parse: parseFamilyPetIds, serialize: (map: Record<string, string>) => JSON.stringify(map), sync: true }),
  multiPet: defineStorageKey({ key: 'agent-pet-multi', parse: onlyOne, serialize: flag, sync: true }),

  // --- 心情 ------------------------------------------------------------------
  // 讀出值未 clamp：啟動時由 store clamp，跨視窗同步時照舊直接套用。
  mood: defineStorageKey({ key: 'agent-pet-mood', parse: raw => parseFloat(raw || String(MOOD_BASELINE)), serialize: numberText, sync: true }),
  moodDate: defineStorageKey({ key: 'agent-pet-mood-date', parse: rawOrNull, serialize: asIs, sync: false }),
  moodVersion: defineStorageKey({ key: 'agent-pet-mood-version', parse: rawOrNull, serialize: asIs, sync: false }),
  moodVisuals: defineStorageKey({ key: 'agent-pet-mood-visuals', parse: notZero, serialize: flag, sync: true }),
  patCount: defineStorageKey({ key: 'agent-pet-pat', parse: parsePatCount, serialize: ({ day, count }: PatCount) => `${day}:${count}`, sync: false }),

  // --- 回饋與音效 -------------------------------------------------------------
  // 主程序的偏好送到之前的快取；只有 '1' 算開，與 SOUND_DEFAULTS.soundEnabled 的關一致。
  sound: defineStorageKey({ key: 'agent-pet-sound', parse: onlyOne, serialize: flag, sync: true }),
  reactions: defineStorageKey({ key: 'agent-pet-fx', parse: notZero, serialize: flag, sync: true }),
  bubble: defineStorageKey({ key: 'agent-pet-bubble', parse: notZero, serialize: flag, sync: true }),
  // 這兩個開關沒有存值時的啟動預設看舊的 fx／bubble（`readPetFeedbackDefaults`）；
  // 這裡的 parse 是跨視窗同步用的規則：只有 '1' 算開。
  ambient: defineStorageKey({ key: 'agent-pet-ambient', parse: onlyOne, serialize: flag, sync: true }),
  activityBubble: defineStorageKey({ key: 'agent-pet-activity', parse: onlyOne, serialize: flag, sync: true }),

  // --- 語言與外觀 -------------------------------------------------------------
  locale: defineStorageKey({ key: 'agent-pet-locale', parse: (raw): AppLocale => (isAppLocale(raw) ? raw : DEFAULT_LOCALE), serialize: (value: AppLocale) => value, sync: true }),
  theme: defineStorageKey({ key: 'agent-pet-theme', parse: (raw): ThemePreference => (isThemePreference(raw) ? raw : 'system'), serialize: (value: ThemePreference) => value, sync: true }),
  petTheme: defineStorageKey({ key: 'agent-pet-pet-theme', parse: (raw): PetThemePreference => (isPetThemePreference(raw) ? raw : 'dark'), serialize: (value: PetThemePreference) => value, sync: true }),

  // --- 單一視窗的介面記憶 -------------------------------------------------------
  // 讀不到 storage 時當作已看過：寧可不顯示引導，也不要每次啟動都跳出來。
  coachSeen: defineStorageKey({ key: 'agent-pet-coach-v1', parse: onlyOne, serialize: flag, fallback: true, sync: false }),
  achievementsSeenAt: defineStorageKey({ key: 'agent-pet-achievements-seen-at', parse: raw => Number(raw) || 0, serialize: numberText, sync: false }),
  historyRange: defineStorageKey({ key: 'agent-pet-history-range', parse: parseHistoryRange, serialize: (days: HistoryRangeDays) => String(days), sync: false }),
  historyCollapsed: defineStorageKey({ key: 'agent-pet-history-collapsed', parse: parseHistoryCollapsed, serialize: (value: Record<string, boolean>) => JSON.stringify(value), sync: false }),
  historyIntroDismissed: defineStorageKey({ key: 'agent-pet-history-intro-dismissed', parse: onlyOne, serialize: flag, sync: false }),
  historyView: defineStorageKey({ key: 'agent-pet-history-view', parse: (raw): HistoryView => (raw === 'sessions' ? 'sessions' : 'overview'), serialize: (value: HistoryView) => value, sync: false }),
  // 這兩個 key 的前綴是 `agent-pets-`（複數），與其他 key 不同；是既有資料，不能統一改名。
  dashboardTab: defineStorageKey({ key: 'agent-pets-dashboard-tab', parse: parseStoredDashboardTab, serialize: asIs, sync: false }),
  settingsGroup: defineStorageKey({ key: 'agent-pets-settings-group', parse: (raw): SettingsGroupId => (isSettingsGroupId(raw) ? raw : DEFAULT_SETTINGS_GROUP), serialize: (value: SettingsGroupId) => value, sync: false }),
} as const satisfies Record<string, StorageKeyDefinition<unknown, never>>)

export type StorageKeyName = keyof typeof STORAGE_KEYS
