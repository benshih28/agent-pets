import type { PanelThemeFit, PanelThemeGradientStop, PanelThemeMode, PanelThemePosition } from './panel-theme.ts'
import type { PluginPanelThemeColorKey } from './plugin.ts'
import { isPluginId } from './id-patterns.ts'

// 使用者自己做的面板主題（「我的主題」，spec R20–R24）。主程序與渲染端共用的契約：
// 主程序是唯一會寫入 `userData/panel-themes-user/` 的地方，並以和插件主題相同的驗證器
// 檢查每一份定義；渲染端的主題編輯器只產生這裡描述的資料，不會產生 CSS。

/** 使用者主題在 PanelThemeRef.pluginId 中的保留擁有者 id。插件 id 不能含底線，所以不會撞名。 */
export const USER_PANEL_THEME_OWNER = '_user'
/** 「我的主題」在目錄中的來源名稱（介面以「我的主題：<名稱>」顯示，不會寫成插件）。 */
export const USER_PANEL_THEME_SOURCE_NAME = Object.freeze({ 'zh-TW': '我的主題', 'en-US': 'My themes' })
export const USER_PANEL_THEME_SCHEMA_VERSION = 1
export const USER_PANEL_THEME_MAX_COUNT = 50
/** 單一主題檔、匯入檔與驗證請求的大小上限（序列化後的 UTF-8 位元組）。 */
export const USER_PANEL_THEME_MAX_BYTES = 16 * 1024
export const USER_PANEL_THEME_ID_PATTERN = /^u-[0-9a-f]{12}$/
export const USER_PANEL_THEME_NAME_MAX = 48
export const USER_PANEL_THEME_EXPORT_FORMAT = 'agent-pets-panel-theme'

/** 編輯器可設定的顏色鍵（manifest 的 31 個鍵，不含已停用的 borderOnAccent），依介面分組。 */
export const USER_PANEL_THEME_COLOR_GROUPS = [
  { id: 'text', keys: ['text', 'textSecondary', 'textMuted', 'textFaint'] },
  { id: 'surfaces', keys: ['bg', 'surface', 'surface2', 'surfaceWarm', 'surfaceSage', 'surfaceSageSoft', 'surfaceOff'] },
  { id: 'accent', keys: ['accent', 'accentHover', 'accentText', 'onAccent', 'accentGlow', 'accentTrack', 'accentOnHover', 'sage', 'sageDeep', 'sageDark', 'sageTrack'] },
  { id: 'borders', keys: ['border', 'borderSoft'] },
  { id: 'status', keys: ['dangerText', 'successText', 'warnText', 'infoText'] },
  { id: 'effects', keys: ['scrim', 'shadow', 'highlight'] },
] as const satisfies ReadonlyArray<{ id: string; keys: readonly PluginPanelThemeColorKey[] }>
export type UserPanelThemeColorGroupId = typeof USER_PANEL_THEME_COLOR_GROUPS[number]['id']

export const USER_PANEL_THEME_COLOR_KEYS: readonly PluginPanelThemeColorKey[] = USER_PANEL_THEME_COLOR_GROUPS.flatMap(group => group.keys)

/** 寵物狀態膠囊的顏色（spec §3.7）；編輯器一律宣告完整的一組。 */
export const USER_PANEL_THEME_PET_STATUS_KEYS = ['background', 'text', 'textMuted', 'border', 'quotaFill', 'quotaTrack', 'quotaWarn'] as const
export type UserPanelThemePetStatusKey = typeof USER_PANEL_THEME_PET_STATUS_KEYS[number]

/**
 * 只能從這些系統字型組合中選（使用者主題不帶字型檔）。`builtin` = 內建字族。每組都以通用字族結尾，
 * 名稱都符合 manifest 的本機字族文法（spec §3.4）。
 */
export const USER_PANEL_THEME_FONT_STACKS = {
  builtin: null,
  system: ['system-ui', 'sans-serif'],
  rounded: ['ui-rounded', 'Hiragino Maru Gothic ProN', 'system-ui', 'sans-serif'],
  humanist: ['Segoe UI', 'PingFang TC', 'Microsoft JhengHei', 'Noto Sans TC', 'sans-serif'],
  serif: ['Georgia', 'Times New Roman', 'Songti TC', 'PMingLiU', 'serif'],
  mono: ['ui-monospace', 'SF Mono', 'Menlo', 'Consolas', 'monospace'],
} as const satisfies Record<string, readonly string[] | null>
export type UserPanelThemeFontStackId = keyof typeof USER_PANEL_THEME_FONT_STACKS
export const USER_PANEL_THEME_FONT_STACK_IDS = Object.keys(USER_PANEL_THEME_FONT_STACKS) as UserPanelThemeFontStackId[]

export type UserPanelThemeBackground =
  | { type: 'solid' }
  | { type: 'gradient'; kind: 'linear'; angle: number; stops: PanelThemeGradientStop[] }
  | { type: 'gradient'; kind: 'radial'; position: PanelThemePosition; stops: PanelThemeGradientStop[] }

/** 使用者背景圖：開啟後該模式允許匯入圖片；`dim` 是預設遮罩（≥ 計算出的最小值）。 */
export interface UserPanelThemeImageSettings {
  fit: PanelThemeFit
  overlayColor: string
  dim: number
}

export interface UserPanelThemeModeDefinition {
  colors: Record<PluginPanelThemeColorKey, string>
  background: UserPanelThemeBackground
  image: UserPanelThemeImageSettings | null
  petStatus: Record<UserPanelThemePetStatusKey, string> | null
}

export interface UserPanelThemeDefinition {
  typography: { body: UserPanelThemeFontStackId; heading: UserPanelThemeFontStackId; scale: number }
  shape: { radiusSm: number; radiusMd: number; radiusLg: number }
  modes: Record<PanelThemeMode, UserPanelThemeModeDefinition>
}

/** `userData/panel-themes-user/<id>.json` 的內容。 */
export interface UserPanelThemeRecord {
  schemaVersion: typeof USER_PANEL_THEME_SCHEMA_VERSION
  id: string
  name: string
  createdAt: string
  updatedAt: string
  definition: UserPanelThemeDefinition
}

/** 匯出／匯入的 JSON：只有名稱與定義，沒有 id、時間、圖片位元組或路徑。 */
export interface UserPanelThemeExport {
  format: typeof USER_PANEL_THEME_EXPORT_FORMAT
  schemaVersion: typeof USER_PANEL_THEME_SCHEMA_VERSION
  name: string
  definition: UserPanelThemeDefinition
}

/** 驗證回傳的一筆問題（spec R21）。`path` 相對於模式；`suggested` 是可直接採用的修正值。 */
export interface PanelThemeDiagnostic {
  mode: PanelThemeMode
  path: string
  kind: 'alpha' | 'direction' | 'luminance' | 'chroma' | 'hue' | 'distance' | 'contrast' | 'overlay'
  problem: string
  foreground?: string
  background?: string
  measured?: number
  required?: number
  suggested?: string | number
}

export interface PanelThemeValidation {
  valid: boolean
  /** 結構或文法錯誤（第一個）；有這個時 `issues` 為空。 */
  schemaError?: { path: string; problem: string }
  issues: PanelThemeDiagnostic[]
  /** 開啟背景圖的模式，使用者遮罩的最小值。 */
  minDim: Partial<Record<PanelThemeMode, number>>
}

export type PanelThemeValidateIpcResult =
  | { ok: true; value: PanelThemeValidation }
  | { ok: false; error: import('./ipc').IpcErrorCode }

export type UserPanelThemeIpcResult =
  | { ok: true; value: { themes: UserPanelThemeRecord[]; id?: string } }
  | { ok: false; error: import('./ipc').IpcErrorCode; validation?: PanelThemeValidation; cancelled?: boolean }

export function isUserPanelThemeId(value: unknown): value is string {
  return typeof value === 'string' && USER_PANEL_THEME_ID_PATTERN.test(value)
}

/** 主題的擁有者：已安裝插件的 id，或「我的主題」的保留 id。 */
export function isPanelThemeOwnerId(value: unknown): value is string {
  return value === USER_PANEL_THEME_OWNER || isPluginId(value)
}
