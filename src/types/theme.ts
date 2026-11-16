// 外觀偏好的值域。放在 types（沒有執行期 import），讓 storage key registry 能驗證存放值，
// 而不必 import `useTheme.ts`（它反過來要用 registry 讀寫偏好）。
//   面板：'system' 跟隨作業系統，'light'／'dark' 強制指定。
//   寵物層（泡泡、狀態列、把手）：'dark'（預設）、'light'，或 'follow' 跟隨面板解析後的外觀。
export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'
export type PetThemePreference = 'dark' | 'light' | 'follow'

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark']
export const PET_THEME_PREFERENCES: readonly PetThemePreference[] = ['dark', 'light', 'follow']

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}

export function isPetThemePreference(value: unknown): value is PetThemePreference {
  return value === 'dark' || value === 'light' || value === 'follow'
}
