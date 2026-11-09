import { formatPanelThemeColor, type PanelThemeRgba } from './panel-theme-color.ts'
import {
  builtinPanelThemeColors,
  DEFAULT_BODY_FAMILY,
  DEFAULT_HEADING_FAMILY,
  DEFAULT_RADII,
  type PanelThemeFamilyEntry,
  type ResolvedPanelTheme,
} from './plugin-panel-themes.ts'
import type { PluginPanelThemeColorKey } from '../src/types/plugin.ts'
import type { PanelThemeMode } from '../src/types/panel-theme.ts'
import {
  PLUGIN_THEME_API_VERSION,
  type PluginThemeColorToken,
  type PluginThemeSnapshot,
  type PluginThemeToken,
} from '../src/types/plugin-theme.ts'

// 把目前生效的主題（或內建色盤）轉成插件可讀的 `--ap-*` 快照。純函式、不碰 Electron。
// 不輸出主題插件的 id、主題 id、背景圖或使用者圖片；`@font` 別名只在設定面板文件內註冊，
// 插件頁面載不到，且是以 session salt 推導的識別值，所以一律去掉、只留本機字型與通用字族。

/** 公開 token → 已驗證的色盤鍵。`focus` 與 App 的焦點環相同，是 accentText（在每個表面上都 >= 3:1）。 */
const COLOR_SOURCES: Readonly<Record<PluginThemeColorToken, PluginPanelThemeColorKey>> = Object.freeze({
  '--ap-bg': 'bg',
  '--ap-surface': 'surface',
  '--ap-surface-2': 'surface2',
  '--ap-text': 'text',
  '--ap-text-secondary': 'textSecondary',
  '--ap-text-muted': 'textMuted',
  '--ap-accent': 'accent',
  '--ap-accent-hover': 'accentHover',
  '--ap-accent-text': 'accentText',
  '--ap-on-accent': 'onAccent',
  '--ap-border': 'border',
  '--ap-border-soft': 'borderSoft',
  '--ap-focus': 'accentText',
  '--ap-danger': 'dangerText',
  '--ap-success': 'successText',
  '--ap-warn': 'warnText',
  '--ap-info': 'infoText',
  '--ap-scrim': 'scrim',
  '--ap-shadow': 'shadow',
  '--ap-highlight': 'highlight',
})

const BUILTIN_COLORS: Readonly<Record<PanelThemeMode, Record<PluginPanelThemeColorKey, PanelThemeRgba>>> = Object.freeze({
  light: builtinPanelThemeColors('light'),
  dark: builtinPanelThemeColors('dark'),
})

function pluginFamily(entries: readonly PanelThemeFamilyEntry[] | null, fallback: string): string {
  if (!entries) return fallback
  const names: string[] = []
  for (const entry of entries) {
    if (entry.kind === 'generic') names.push(entry.name)
    else if (entry.kind === 'local') names.push(`"${entry.name}"`)
  }
  // manifest 規定最後一項必為通用字族，所以去掉 `@font` 後清單仍不會是空的。
  return names.join(', ')
}

function freezeSnapshot(mode: PanelThemeMode, tokens: Record<PluginThemeToken, string>): PluginThemeSnapshot {
  return Object.freeze({ apiVersion: PLUGIN_THEME_API_VERSION, mode, tokens: Object.freeze(tokens) })
}

/**
 * `theme` 為 null（內建、插件停用、forced-colors）時輸出內建色盤；
 * 否則 `theme.modes[mode]` 必須存在，呼叫端只在該模式的槽位為 active 時傳入。
 */
export function buildPluginThemeSnapshot(theme: ResolvedPanelTheme | null, mode: PanelThemeMode): PluginThemeSnapshot {
  const resolvedTheme = theme?.modes[mode] ? theme : null
  const colors = resolvedTheme?.modes[mode]?.colors ?? BUILTIN_COLORS[mode]
  const tokens = {} as Record<PluginThemeToken, string>
  for (const [token, key] of Object.entries(COLOR_SOURCES) as Array<[PluginThemeColorToken, PluginPanelThemeColorKey]>) {
    tokens[token] = formatPanelThemeColor(colors[key])
  }
  const shape = resolvedTheme?.shape ?? DEFAULT_RADII
  tokens['--ap-radius-sm'] = `${shape.radiusSm}px`
  tokens['--ap-radius-md'] = `${shape.radiusMd}px`
  tokens['--ap-radius-lg'] = `${shape.radiusLg}px`
  tokens['--ap-font-body'] = pluginFamily(resolvedTheme?.typography.body ?? null, DEFAULT_BODY_FAMILY)
  tokens['--ap-font-heading'] = pluginFamily(resolvedTheme?.typography.heading ?? null, DEFAULT_HEADING_FAMILY)
  tokens['--ap-font-scale'] = String(resolvedTheme?.typography.scale ?? 1)
  return freezeSnapshot(mode, tokens)
}
