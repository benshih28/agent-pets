import { ref } from 'vue'
import { isPetThemePreference, isThemePreference, THEME_PREFERENCES, type PetThemePreference, type ResolvedTheme, type ThemePreference } from '../types/theme.ts'
import { STORAGE_KEYS } from '../utils/storage-keys.ts'
import { listenStorageSync, readStored, syncOn, writeStored } from '../utils/local-storage.ts'

export { isPetThemePreference, isThemePreference, PET_THEME_PREFERENCES, THEME_PREFERENCES } from '../types/theme.ts'
export type { PetThemePreference, ResolvedTheme, ThemePreference } from '../types/theme.ts'

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (preference === 'system') return systemDark ? 'dark' : 'light'
  return preference
}

export function resolvePetTheme(preference: PetThemePreference, panelTheme: ResolvedTheme): ResolvedTheme {
  return preference === 'follow' ? panelTheme : preference
}

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

export type ThemeWindowKind = 'panel' | 'pet'
let windowKind: ThemeWindowKind = 'panel'

function apply(): void {
  resolvedTheme.value = resolveTheme(themePreference.value, systemPrefersDark())
  resolvedPetTheme.value = resolvePetTheme(petThemePreference.value, resolvedTheme.value)
  if (typeof document === 'undefined') return
  document.documentElement.dataset.window = windowKind
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

export function initTheme(kind: ThemeWindowKind = 'panel'): void {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  windowKind = kind
  readPreferences()
  if (typeof matchMedia === 'function') {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', apply)
  }
  // Pet and panel windows share one origin, so storage events keep them in step without IPC.
  listenStorageSync([syncOn(STORAGE_KEYS.theme, readPreferences), syncOn(STORAGE_KEYS.petTheme, readPreferences)])
  const mark = () => {
    document.documentElement.toggleAttribute('data-window-blurred', !document.hasFocus())
  }
  window.addEventListener('focus', mark)
  window.addEventListener('blur', mark)
  mark()
}
