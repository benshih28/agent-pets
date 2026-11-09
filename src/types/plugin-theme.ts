import { PANEL_THEME_FAMILY_ENTRY_PATTERN, PANEL_THEME_PX_PATTERN, PANEL_THEME_RGB_PATTERN, type PanelThemeMode } from './panel-theme.ts'

// 插件讀取主題 API（`theme.get()`／`theme.onDidChange`）與注入 panelView 的 `--ap-*` 公開契約。
// 名稱與值的格式一經發布就不能改；新增 token 只能在新的 apiVersion 或向後相容地追加。
// 主程序產生所有值，preload 與面板橋接層在寫入 CSS 或交給插件前再用下方規則逐一檢查。

export const PLUGIN_THEME_API_VERSION = 1

export const PLUGIN_THEME_COLOR_TOKENS = [
  '--ap-bg', '--ap-surface', '--ap-surface-2',
  '--ap-text', '--ap-text-secondary', '--ap-text-muted',
  '--ap-accent', '--ap-accent-hover', '--ap-accent-text', '--ap-on-accent',
  '--ap-border', '--ap-border-soft', '--ap-focus',
  '--ap-danger', '--ap-success', '--ap-warn', '--ap-info',
  '--ap-scrim', '--ap-shadow', '--ap-highlight',
] as const
export const PLUGIN_THEME_RADIUS_TOKENS = ['--ap-radius-sm', '--ap-radius-md', '--ap-radius-lg'] as const
export const PLUGIN_THEME_FAMILY_TOKENS = ['--ap-font-body', '--ap-font-heading'] as const
export const PLUGIN_THEME_SCALE_TOKEN = '--ap-font-scale'

export type PluginThemeColorToken = typeof PLUGIN_THEME_COLOR_TOKENS[number]
export type PluginThemeToken =
  | PluginThemeColorToken
  | typeof PLUGIN_THEME_RADIUS_TOKENS[number]
  | typeof PLUGIN_THEME_FAMILY_TOKENS[number]
  | typeof PLUGIN_THEME_SCALE_TOKEN

export const PLUGIN_THEME_TOKENS: readonly PluginThemeToken[] = Object.freeze([
  ...PLUGIN_THEME_COLOR_TOKENS,
  ...PLUGIN_THEME_RADIUS_TOKENS,
  ...PLUGIN_THEME_FAMILY_TOKENS,
  PLUGIN_THEME_SCALE_TOKEN,
])

export interface PluginThemeSnapshot {
  apiVersion: typeof PLUGIN_THEME_API_VERSION
  mode: PanelThemeMode
  tokens: Record<PluginThemeToken, string>
}

/** 字級倍率與 manifest `typography.scale` 相同範圍（0.92–1.15，最多兩位小數）。 */
const SCALE_PATTERN = /^(?:0\.9[2-9]|1|1\.0[1-9]|1\.1[0-5]?)$/
const FAMILY_MAX_LENGTH = 512
const FAMILY_MAX_ENTRIES = 8

const COLOR_TOKEN_SET: ReadonlySet<string> = new Set(PLUGIN_THEME_COLOR_TOKENS)
const RADIUS_TOKEN_SET: ReadonlySet<string> = new Set(PLUGIN_THEME_RADIUS_TOKENS)
const FAMILY_TOKEN_SET: ReadonlySet<string> = new Set(PLUGIN_THEME_FAMILY_TOKENS)

function isFamilyList(value: string): boolean {
  if (value.length === 0 || value.length > FAMILY_MAX_LENGTH) return false
  const entries = value.split(', ')
  return entries.length <= FAMILY_MAX_ENTRIES && entries.every(entry => PANEL_THEME_FAMILY_ENTRY_PATTERN.test(entry))
}

export function isPluginThemeTokenValue(name: string, value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (COLOR_TOKEN_SET.has(name)) return PANEL_THEME_RGB_PATTERN.test(value)
  if (RADIUS_TOKEN_SET.has(name)) return PANEL_THEME_PX_PATTERN.test(value)
  if (FAMILY_TOKEN_SET.has(name)) return isFamilyList(value)
  if (name === PLUGIN_THEME_SCALE_TOKEN) return SCALE_PATTERN.test(value)
  return false
}

/** 只接受完整、鍵集合完全相同且每個值都符合格式的快照；任何一項不符就整份丟棄。 */
export function isPluginThemeSnapshot(value: unknown): value is PluginThemeSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== 3 || record.apiVersion !== PLUGIN_THEME_API_VERSION
    || (record.mode !== 'light' && record.mode !== 'dark')) return false
  const tokens = record.tokens
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) return false
  const entries = tokens as Record<string, unknown>
  if (Object.keys(entries).length !== PLUGIN_THEME_TOKENS.length) return false
  return PLUGIN_THEME_TOKENS.every(name => Object.hasOwn(entries, name) && isPluginThemeTokenValue(name, entries[name]))
}

/** 交給插件的是獨立的凍結複本，插件改動它不會影響宿主或其他回呼。 */
export function clonePluginThemeSnapshot(snapshot: PluginThemeSnapshot): PluginThemeSnapshot {
  return Object.freeze({
    apiVersion: snapshot.apiVersion,
    mode: snapshot.mode,
    tokens: Object.freeze({ ...snapshot.tokens }),
  })
}
