import {
  PANEL_THEME_ASSET_URL_PATTERN,
  PANEL_THEME_BACKGROUND_PROPERTY,
  PANEL_THEME_COLOR_PROPERTIES,
  PANEL_THEME_CSS_PROPERTIES,
  PANEL_THEME_FAMILY_ENTRY_PATTERN,
  PANEL_THEME_FAMILY_PROPERTIES,
  PANEL_THEME_FONT_ALIAS_PATTERN,
  PANEL_THEME_PX_PATTERN,
  PANEL_THEME_RGB_PATTERN,
  PET_STATUS_PROPERTIES,
  PET_THEME_COLOR_PROPERTIES,
  type PanelThemeBackgroundState,
  type PanelThemeCatalogEntry,
  type PanelThemeCssProperty,
  type PanelThemeMode,
  type PanelThemePosition,
  type PanelThemeState,
  type PetThemeModeState,
  type PetThemeState,
} from '../types/panel-theme.ts'
import { USER_PANEL_THEME_OWNER } from '../types/panel-theme-user.ts'

// 每個主機建構的名稱與值在進入 style.setProperty 之前都會重新驗證（縱深防禦）。

export interface PanelThemeMediaFlags {
  /** forced-colors: active（Windows 高對比）會暫停插件主題。 */
  forcedColors: boolean
  highContrast: boolean
}

const ALLOWED: ReadonlySet<string> = new Set(PANEL_THEME_CSS_PROPERTIES)
const COLOR_PROPERTIES: ReadonlySet<string> = new Set(PANEL_THEME_COLOR_PROPERTIES)
const FAMILY_PROPERTIES: ReadonlySet<string> = new Set(PANEL_THEME_FAMILY_PROPERTIES)

const RGB = PANEL_THEME_RGB_PATTERN.source.slice(1, -1)
const STOP = `${RGB} (?:\\d|[1-9]\\d|100)%`
const STOPS = `${STOP}(?:, ${STOP}){1,4}`
const ANGLE = '(?:\\d|[1-9]\\d|[1-2]\\d\\d|3[0-5]\\d)deg'
const POSITION_CSS: Record<PanelThemePosition, string> = {
  center: 'center',
  top: 'top',
  bottom: 'bottom',
  left: 'left',
  right: 'right',
  'top-left': 'left top',
  'top-right': 'right top',
  'bottom-left': 'left bottom',
  'bottom-right': 'right bottom',
}
const POSITION_ALTERNATION = Object.values(POSITION_CSS).join('|')
const GRADIENT_PATTERN = new RegExp(`^(?:linear-gradient\\(${ANGLE}, ${STOPS}\\)|radial-gradient\\(ellipse at (?:${POSITION_ALTERNATION}), ${STOPS}\\))$`)

export function panelThemePositionCss(position: PanelThemePosition): string {
  return POSITION_CSS[position] ?? 'center'
}

export function buildPanelThemeGradient(background: PanelThemeBackgroundState): string | null {
  if (background.type !== 'gradient') return null
  const stops = background.stops.map(stop => `${stop.color} ${stop.at}%`).join(', ')
  const value = background.kind === 'linear'
    ? `linear-gradient(${background.angle}deg, ${stops})`
    : `radial-gradient(ellipse at ${panelThemePositionCss(background.position)}, ${stops})`
  return GRADIENT_PATTERN.test(value) ? value : null
}

export function isPanelThemePropertyValue(name: string, value: unknown): value is string {
  if (!ALLOWED.has(name) || typeof value !== 'string' || value.length === 0 || value.length > 512) return false
  if (COLOR_PROPERTIES.has(name)) return PANEL_THEME_RGB_PATTERN.test(value)
  if (FAMILY_PROPERTIES.has(name)) {
    const entries = value.split(', ')
    return entries.length >= 1 && entries.length <= 5 && entries.every(entry => PANEL_THEME_FAMILY_ENTRY_PATTERN.test(entry))
  }
  if (name === PANEL_THEME_BACKGROUND_PROPERTY) return GRADIENT_PATTERN.test(value)
  return PANEL_THEME_PX_PATTERN.test(value)
}

export function isPanelThemeAssetUrl(value: unknown): value is string {
  return typeof value === 'string' && PANEL_THEME_ASSET_URL_PATTERN.test(value)
}

export function isPanelThemeFontAlias(value: unknown): value is string {
  return typeof value === 'string' && PANEL_THEME_FONT_ALIAS_PATTERN.test(value)
}

function withAlpha(color: string, alpha: string): string | null {
  const match = /^rgb\((\d{1,3} \d{1,3} \d{1,3}) \/ [0-9.]+\)$/.exec(color)
  return match ? `rgb(${match[1]} / ${alpha})` : null
}

export function activePanelTheme(state: PanelThemeState | null, mode: PanelThemeMode): PanelThemeCatalogEntry | null {
  const slot = state?.slots[mode]
  if (!state || !slot?.ref || slot.status !== 'active') return null
  const { pluginId, themeId } = slot.ref
  const entry = state.themes.find(theme => theme.ref.pluginId === pluginId && theme.ref.themeId === themeId)
  return entry?.modes[mode] ? entry : null
}

export interface PanelThemePropertyPlan {
  properties: Map<PanelThemeCssProperty, string>
  /** 未通過重新驗證的名稱或值（會記錄，絕不套用）。 */
  rejected: string[]
}

export function panelThemeTargetProperties(
  entry: PanelThemeCatalogEntry | null,
  mode: PanelThemeMode,
  flags: PanelThemeMediaFlags,
): PanelThemePropertyPlan {
  const properties = new Map<PanelThemeCssProperty, string>()
  const rejected: string[] = []
  const modeState = entry?.modes[mode]
  if (!entry || !modeState || flags.forcedColors) return { properties, rejected }
  const candidates: Array<[string, unknown]> = [
    ...Object.entries(entry.shared.properties),
    ...Object.entries(modeState.properties),
  ]
  const gradient = buildPanelThemeGradient(modeState.background)
  if (modeState.background.type === 'gradient') candidates.push([PANEL_THEME_BACKGROUND_PROPERTY, gradient])
  if (flags.highContrast) {
    const text = modeState.properties['--organic-text']
    candidates.push(['--organic-border', withAlpha(text, '0.6')], ['--organic-border-soft', withAlpha(text, '0.4')])
  }
  for (const [name, value] of candidates) {
    if (isPanelThemePropertyValue(name, value)) properties.set(name as PanelThemeCssProperty, value)
    else rejected.push(name.slice(0, 64))
  }
  return { properties, rejected }
}

export function diffPanelThemeProperties(
  current: ReadonlyMap<string, string>,
  next: ReadonlyMap<string, string>,
): { remove: string[]; set: Array<[string, string]> } {
  const remove = [...current.keys()].filter(name => !next.has(name))
  const set = [...next].filter(([name, value]) => current.get(name) !== value)
  return { remove, set }
}

export function activePanelThemeModes(state: PanelThemeState | null, ref: { pluginId: string; themeId: string }): PanelThemeMode[] {
  if (!state) return []
  return (['light', 'dark'] as const).filter(mode => {
    const slot = state.slots[mode]
    return slot.status === 'active' && slot.ref?.pluginId === ref.pluginId && slot.ref.themeId === ref.themeId
  })
}

/** 擁有啟用中插槽的插件（淺色優先），否則為第一個提供主題的插件；null 表示沒有，目標為 Appearance 狀態列。 */
export function panelThemeSettingsTarget(state: PanelThemeState | null): string | null {
  if (!state) return null
  // 我的主題（保留擁有者 `_user`）不是插件，沒有插件設定可開。
  const pluginThemes = state.themes.filter(theme => theme.ref.pluginId !== USER_PANEL_THEME_OWNER)
  for (const mode of ['light', 'dark'] as const) {
    const ref = state.slots[mode].ref
    if (ref && pluginThemes.some(theme => theme.ref.pluginId === ref.pluginId)) return ref.pluginId
  }
  return pluginThemes[0]?.ref.pluginId ?? null
}

function canonicalSet(source: unknown, names: readonly string[]): Map<string, string> | null {
  if (!source || typeof source !== 'object') return null
  const record = source as Record<string, unknown>
  const properties = new Map<string, string>()
  for (const name of names) {
    const value = record[name]
    if (typeof value !== 'string' || value.length > 32 || !PANEL_THEME_RGB_PATTERN.test(value)) return null
    properties.set(name, value)
  }
  // 多出允許清單以外的名稱代表內容不是主程序建構的：整組拒絕。
  return Object.keys(record).length === names.length ? properties : null
}

/** 每一組都是全有或全無、值必須是主機標準 rgb()；只設一部分會在未經驗證的情況下混用主題色與內建色。 */
export function petThemeTargetProperties(state: PetThemeState | null, mode: PanelThemeMode, flags: PanelThemeMediaFlags): Map<string, string> {
  const source: PetThemeModeState | null | undefined = flags.forcedColors ? null : state?.[mode]
  const colors = canonicalSet(source?.colors, PET_THEME_COLOR_PROPERTIES)
  if (!colors) return new Map()
  const strong = flags.highContrast ? withAlpha(colors.get('--organic-text')!, '0.6') : null
  const soft = flags.highContrast ? withAlpha(colors.get('--organic-text')!, '0.4') : null
  if (strong && soft) colors.set('--organic-border', strong).set('--organic-border-soft', soft)
  const status = source?.status == null ? new Map<string, string>() : canonicalSet(source.status, PET_STATUS_PROPERTIES)
  return status ? new Map([...colors, ...status]) : colors
}

export function petStatusPreviewProperties(status: Record<string, string> | null | undefined): Map<string, string> {
  return canonicalSet(status, PET_STATUS_PROPERTIES) ?? new Map()
}

export function panelThemePreviewStyle(
  entry: PanelThemeCatalogEntry | null,
  mode: PanelThemeMode,
  builtin: Readonly<Record<string, string>> | null,
  forcedColors: boolean,
): Record<string, string> {
  const result: Record<string, string> = {}
  if (forcedColors) return result
  if (entry) {
    for (const [name, value] of panelThemeTargetProperties(entry, mode, { forcedColors: false, highContrast: false }).properties) result[name] = value
    for (const [name, value] of petStatusPreviewProperties(entry.modes[mode]?.petStatus)) result[name] = value
  } else if (builtin) {
    for (const [name, value] of Object.entries(builtin)) {
      if (isPanelThemePropertyValue(name, value)) result[name] = value
    }
  }
  return result
}
