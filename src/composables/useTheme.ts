import { ref } from 'vue'
import { isPetThemePreference, isThemePreference, THEME_PREFERENCES, type PetThemePreference, type ResolvedTheme, type ThemePreference } from '../types/theme.ts'
import { STORAGE_KEYS } from '../utils/storage-keys.ts'
import { listenStorageSync, readStored, syncOn, writeStored } from '../utils/local-storage.ts'

// Theme = which palette the panel layer (--organic-* / --color-*) uses.
// The desktop-pet layer (bubbles, status lines, handle) has its own
// preference: 'dark' (default), 'light', or 'follow' the resolved panel theme.
//   preference: 'system' follows the OS, 'light' / 'dark' force it.
// Applied as <html data-theme="light|dark"> — the panel window uses the panel
// preference, the pet window its pet preference; tokens.css supplies the values.
// 值域與型別在 `@/types/theme`（storage registry 也要用），這裡轉出以維持既有 import。
export { isPetThemePreference, isThemePreference, PET_THEME_PREFERENCES, THEME_PREFERENCES } from '../types/theme.ts'
export type { PetThemePreference, ResolvedTheme, ThemePreference } from '../types/theme.ts'

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (preference === 'system') return systemDark ? 'dark' : 'light'
  return preference
}

export function resolvePetTheme(preference: PetThemePreference, panelTheme: ResolvedTheme): ResolvedTheme {
  return preference === 'follow' ? panelTheme : preference
}

/** Quick-toggle order for the panel theme: system -> light -> dark -> system. */
export function nextThemePreference(preference: ThemePreference): ThemePreference {
  const index = THEME_PREFERENCES.indexOf(preference)
  return THEME_PREFERENCES[(index + 1) % THEME_PREFERENCES.length]
}

export const themePreference = ref<ThemePreference>('system')
export const resolvedTheme = ref<ResolvedTheme>('light')
export const petThemePreference = ref<PetThemePreference>('dark')
export const resolvedPetTheme = ref<ResolvedTheme>('dark')

function systemPrefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
}

/** 視窗種類：決定 <html data-window> 與色盤模式（tokens.css 依此選擇區塊）。 */
export type ThemeWindowKind = 'panel' | 'pet'
let windowKind: ThemeWindowKind = 'panel'

function apply(): void {
  resolvedTheme.value = resolveTheme(themePreference.value, systemPrefersDark())
  resolvedPetTheme.value = resolvePetTheme(petThemePreference.value, resolvedTheme.value)
  if (typeof document === 'undefined') return
  document.documentElement.dataset.window = windowKind
  // 寵物視窗的色盤模式就是寵物外觀；面板視窗用面板外觀。
  document.documentElement.dataset.theme = windowKind === 'pet' ? resolvedPetTheme.value : resolvedTheme.value
}

export function setPetThemePreference(value: unknown): PetThemePreference {
  petThemePreference.value = isPetThemePreference(value) ? value : 'dark'
  writeStored(STORAGE_KEYS.petTheme, petThemePreference.value)
  apply()
  return petThemePreference.value
}

export function setThemePreference(value: unknown): ThemePreference {
  themePreference.value = isThemePreference(value) ? value : 'system'
  writeStored(STORAGE_KEYS.theme, themePreference.value)
  apply()
  return themePreference.value
}

let initialized = false

function readPreferences(): void {
  themePreference.value = readStored(STORAGE_KEYS.theme)
  petThemePreference.value = readStored(STORAGE_KEYS.petTheme)
  apply()
}

/** Call once before mounting. Idempotent. */
export function initTheme(kind: ThemeWindowKind = 'panel'): void {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  windowKind = kind
  readPreferences()
  if (typeof matchMedia === 'function') {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', apply)
  }
  // The pet and panel windows share one origin, so a storage event keeps
  // both in step without IPC. 任一個 key 變了都重讀兩個偏好（與改前相同）。
  listenStorageSync([syncOn(STORAGE_KEYS.theme, readPreferences), syncOn(STORAGE_KEYS.petTheme, readPreferences)])
  // Inactive-window hook for CSS (liquid-glass.md: de-emphasise when blurred).
  const mark = () => {
    document.documentElement.toggleAttribute('data-window-blurred', !document.hasFocus())
  }
  window.addEventListener('focus', mark)
  window.addEventListener('blur', mark)
  mark()
}
