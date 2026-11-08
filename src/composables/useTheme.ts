import { ref } from 'vue'

// Theme = which palette the panel layer (--organic-* / --color-*) uses.
// The desktop-pet layer (bubbles, status lines, handle) has its own
// preference: 'dark' (default), 'light', or 'follow' the resolved panel theme.
//   preference: 'system' follows the OS, 'light' / 'dark' force it.
// Applied as <html data-theme="light|dark">; tokens.css supplies the values.
export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'agent-pet-theme'
export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark']

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (preference === 'system') return systemDark ? 'dark' : 'light'
  return preference
}

export type PetThemePreference = 'dark' | 'light' | 'follow'

export const PET_THEME_STORAGE_KEY = 'agent-pet-pet-theme'
export const PET_THEME_PREFERENCES: readonly PetThemePreference[] = ['dark', 'light', 'follow']

export function isPetThemePreference(value: unknown): value is PetThemePreference {
  return value === 'dark' || value === 'light' || value === 'follow'
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

function readStored(): ThemePreference {
  try {
    const value = typeof localStorage !== 'undefined' ? localStorage.getItem(THEME_STORAGE_KEY) : null
    return isThemePreference(value) ? value : 'system'
  } catch {
    return 'system'
  }
}

function readStoredPet(): PetThemePreference {
  try {
    const value = typeof localStorage !== 'undefined' ? localStorage.getItem(PET_THEME_STORAGE_KEY) : null
    return isPetThemePreference(value) ? value : 'dark'
  } catch {
    return 'dark'
  }
}

function apply(): void {
  resolvedTheme.value = resolveTheme(themePreference.value, systemPrefersDark())
  resolvedPetTheme.value = resolvePetTheme(petThemePreference.value, resolvedTheme.value)
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = resolvedTheme.value
  document.documentElement.dataset.petTheme = resolvedPetTheme.value
}

export function setPetThemePreference(value: unknown): PetThemePreference {
  petThemePreference.value = isPetThemePreference(value) ? value : 'dark'
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(PET_THEME_STORAGE_KEY, petThemePreference.value)
  } catch {}
  apply()
  return petThemePreference.value
}

export function setThemePreference(value: unknown): ThemePreference {
  themePreference.value = isThemePreference(value) ? value : 'system'
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(THEME_STORAGE_KEY, themePreference.value)
  } catch {}
  apply()
  return themePreference.value
}

let initialized = false

/** Call once before mounting. Idempotent. */
export function initTheme(): void {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  themePreference.value = readStored()
  petThemePreference.value = readStoredPet()
  apply()
  if (typeof matchMedia === 'function') {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', apply)
  }
  // The pet and panel windows share one origin, so a storage event keeps
  // both in step without IPC.
  window.addEventListener('storage', (event) => {
    if (event.key === THEME_STORAGE_KEY || event.key === PET_THEME_STORAGE_KEY) {
      themePreference.value = readStored()
      petThemePreference.value = readStoredPet()
      apply()
    }
  })
  // Inactive-window hook for CSS (liquid-glass.md: de-emphasise when blurred).
  const mark = () => {
    document.documentElement.toggleAttribute('data-window-blurred', !document.hasFocus())
  }
  window.addEventListener('focus', mark)
  window.addEventListener('blur', mark)
  mark()
}
