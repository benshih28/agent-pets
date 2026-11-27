// 不能 import Electron 或 Node：目錄驗證器會原封不動內嵌這個檔案（連同 panel-theme-color.ts 與 pet-sprite-validation.ts）。
// 任何違規都直接拒絕，不做任何夾限。

import {
  PANEL_THEME_BLACK,
  PANEL_THEME_WHITE,
  compositeColor,
  contrastRatio,
  formatPanelThemeColor,
  mixColor,
  oklabDistance,
  parsePanelThemeColor,
  rgbToOklch,
  relativeLuminance,
  withAlpha,
  type PanelThemeRgba,
} from './panel-theme-color.ts'
import { readImageAnimated, readImageOrientation, readImageSize } from './pet-sprite-validation.ts'
import { rasterImageTypeIn, type RasterImageType } from './raster-image.ts'
import type {
  PluginLocalizedText,
  PluginPanelThemeBackground,
  PluginPanelThemeColorKey,
  PluginPanelThemeColors,
  PluginPanelThemeContribution,
  PluginPanelThemeFit,
  PluginPanelThemeFontFace,
  PluginPanelThemeModeDefinition,
  PluginPanelThemePosition,
} from '../src/types/plugin.ts'
import type { AppLocale } from '../src/types/locale.ts'
import type {
  PanelThemeBackgroundState,
  PanelThemeCatalogEntry,
  PanelThemeColorProperty,
  PanelThemeMode,
  PanelThemeModeState,
  PanelThemeRef,
  PanelThemeSharedProperty,
  PanelThemeSlotState,
  PanelThemeState,
  PanelThemeStoreData,
  PanelThemeUnavailableReason,
  PetStatusProperty,
} from '../src/types/panel-theme.ts'

export const PANEL_THEME_MAX_THEMES = 8
export const PANEL_THEME_MAX_FACES_PER_THEME = 4
export const PANEL_THEME_MAX_FONT_FILES = 8
export const PANEL_THEME_MAX_IMAGE_FILES = 16
export const PANEL_THEME_MAX_STOPS = 5
export const PANEL_THEME_FONT_MAX_BYTES = 1024 * 1024
export const PANEL_THEME_IMAGE_MAX_BYTES = 8 * 1024 * 1024
export const PANEL_THEME_IMAGE_MIN_SIDE = 64
export const PANEL_THEME_IMAGE_MAX_SIDE = 4096
export const PANEL_THEME_IMAGE_MAX_PIXELS = 8_388_608
export const PANEL_THEME_USER_IMAGE_MAX_BYTES = 20 * 1024 * 1024
export const PANEL_THEME_USER_IMAGE_MAX_SIDE = 8192
export const PANEL_THEME_USER_IMAGE_MAX_PIXELS = 16_777_216
export const PANEL_THEME_OVERLAY_FLOOR = 0.5
export const PANEL_THEME_OVERLAY_CEILING = 0.95
export const PANEL_THEME_DIAGNOSTIC_MAX_LENGTH = 200

type TokenKind = 'required' | 'derived' | 'builtin'
type AlphaClass = 'opaque' | 'translucent' | 'border' | 'scrim'

interface ColorToken {
  key: PluginPanelThemeColorKey
  property: PanelThemeColorProperty
  kind: TokenKind
  alpha: AlphaClass
  light: string
  dark: string
}

export const PANEL_THEME_COLOR_TOKENS: readonly ColorToken[] = Object.freeze([
  { key: 'bg', property: '--organic-bg', kind: 'required', alpha: 'opaque', light: '#f5ead8', dark: '#1f1b16' },
  { key: 'surface', property: '--organic-surface', kind: 'required', alpha: 'opaque', light: '#f9f4ed', dark: '#292420' },
  { key: 'surface2', property: '--organic-surface-2', kind: 'required', alpha: 'opaque', light: '#eee7db', dark: '#342e28' },
  { key: 'surfaceWarm', property: '--organic-surface-warm', kind: 'derived', alpha: 'opaque', light: '#ffe1d0', dark: '#4a3022' },
  { key: 'surfaceSage', property: '--organic-surface-sage', kind: 'derived', alpha: 'opaque', light: '#e1eecc', dark: '#2e3622' },
  { key: 'surfaceSageSoft', property: '--organic-surface-sage-soft', kind: 'derived', alpha: 'opaque', light: '#f0fae1', dark: '#263019' },
  { key: 'surfaceOff', property: '--organic-surface-off', kind: 'derived', alpha: 'opaque', light: '#dcd3c4', dark: '#3f372e' },
  { key: 'text', property: '--organic-text', kind: 'required', alpha: 'opaque', light: '#201e1d', dark: '#f3ede4' },
  { key: 'textSecondary', property: '--organic-text-secondary', kind: 'required', alpha: 'opaque', light: '#645c50', dark: '#cfc5b6' },
  { key: 'textMuted', property: '--organic-text-muted', kind: 'required', alpha: 'opaque', light: '#6b6354', dark: '#b0a592' },
  { key: 'textFaint', property: '--organic-text-faint', kind: 'derived', alpha: 'opaque', light: '#8a8070', dark: '#8d8374' },
  { key: 'accent', property: '--organic-accent', kind: 'required', alpha: 'opaque', light: '#c67139', dark: '#d98652' },
  { key: 'accentHover', property: '--organic-accent-hover', kind: 'derived', alpha: 'opaque', light: '#a85a28', dark: '#e39a6b' },
  { key: 'accentText', property: '--organic-accent-text', kind: 'required', alpha: 'opaque', light: '#8c491a', dark: '#f0b48a' },
  { key: 'onAccent', property: '--organic-accent-contrast', kind: 'required', alpha: 'opaque', light: '#fff2eb', dark: '#201e1d' },
  { key: 'accentGlow', property: '--organic-accent-glow', kind: 'derived', alpha: 'translucent', light: 'rgba(198,113,57,.2)', dark: 'rgba(217,134,82,.28)' },
  { key: 'accentTrack', property: '--organic-accent-track', kind: 'derived', alpha: 'translucent', light: 'rgba(32,30,29,.08)', dark: 'rgba(243,237,228,.1)' },
  { key: 'accentOnHover', property: '--organic-accent-on-hover', kind: 'derived', alpha: 'translucent', light: 'rgba(32,30,29,.05)', dark: 'rgba(243,237,228,.06)' },
  { key: 'sage', property: '--organic-sage', kind: 'builtin', alpha: 'opaque', light: '#7a8a5e', dark: '#9db07b' },
  { key: 'sageDeep', property: '--organic-sage-deep', kind: 'builtin', alpha: 'opaque', light: '#56633f', dark: '#aebf8c' },
  { key: 'sageDark', property: '--organic-sage-dark', kind: 'builtin', alpha: 'opaque', light: '#3d472b', dark: '#c9d6ad' },
  { key: 'sageTrack', property: '--organic-sage-track', kind: 'derived', alpha: 'translucent', light: 'rgba(61,71,43,.16)', dark: 'rgba(201,214,173,.18)' },
  { key: 'border', property: '--organic-border', kind: 'required', alpha: 'border', light: 'rgba(32,30,29,.16)', dark: 'rgba(243,237,228,.18)' },
  { key: 'borderSoft', property: '--organic-border-soft', kind: 'derived', alpha: 'translucent', light: 'rgba(32,30,29,.1)', dark: 'rgba(243,237,228,.1)' },
  { key: 'dangerText', property: '--organic-danger-text', kind: 'builtin', alpha: 'opaque', light: '#a62f1e', dark: '#ff9a8a' },
  { key: 'successText', property: '--organic-success-text', kind: 'builtin', alpha: 'opaque', light: '#3f5a1c', dark: '#b6d48a' },
  { key: 'warnText', property: '--organic-warn-text', kind: 'builtin', alpha: 'opaque', light: '#7a5200', dark: '#f0c866' },
  { key: 'scrim', property: '--organic-scrim', kind: 'builtin', alpha: 'scrim', light: 'rgba(46,43,37,.42)', dark: 'rgba(0,0,0,.55)' },
  // 省略時取內建值，與 tokens.css 的 --builtin-organic-* 相同。
  { key: 'infoText', property: '--organic-info-text', kind: 'builtin', alpha: 'opaque', light: '#2e5b8c', dark: '#9cc3f0' },
  { key: 'shadow', property: '--organic-shadow', kind: 'builtin', alpha: 'opaque', light: '#2e2b25', dark: '#000000' },
  { key: 'highlight', property: '--organic-highlight', kind: 'builtin', alpha: 'opaque', light: '#ffffff', dark: '#ffffff' },
])

// 已停用但仍接受：照樣檢查文法與 alpha（原本合法的 manifest 依舊合法），但不推導、不輸出。
export const PANEL_THEME_DEPRECATED_COLOR_KEYS: Readonly<Record<string, AlphaClass>> = Object.freeze({
  borderOnAccent: 'translucent',
})

// 「寵物視窗永不套主題」的唯一例外：只有狀態膠囊的顏色；泡泡、權限/風險 UI、狀態點與 sprite 維持內建。
export type PetStatusColorKey = 'background' | 'border' | 'text' | 'textMuted' | 'quotaFill' | 'quotaTrack' | 'quotaWarn'

interface PetStatusToken {
  key: PetStatusColorKey
  property: PetStatusProperty
  required: boolean
  alpha: readonly [number, number]
}

export const PET_STATUS_TOKENS: readonly PetStatusToken[] = Object.freeze([
  { key: 'background', property: '--pet-status-background', required: true, alpha: [0.85, 1] },
  { key: 'border', property: '--pet-status-border', required: false, alpha: [0.08, 1] },
  { key: 'text', property: '--pet-status-text', required: true, alpha: [1, 1] },
  { key: 'textMuted', property: '--pet-status-text-muted', required: false, alpha: [1, 1] },
  { key: 'quotaFill', property: '--pet-status-quota-fill', required: false, alpha: [1, 1] },
  { key: 'quotaTrack', property: '--pet-status-quota-track', required: false, alpha: [0.1, 1] },
  { key: 'quotaWarn', property: '--pet-status-quota-warn', required: false, alpha: [1, 1] },
])
const PET_STATUS_KEYS: readonly string[] = PET_STATUS_TOKENS.map(token => token.key)
const BUILTIN_QUOTA_WARNING = '#e3b64f'

const TOKEN_BY_KEY: ReadonlyMap<string, ColorToken> = new Map(PANEL_THEME_COLOR_TOKENS.map(token => [token.key, token]))
const ALPHA_RANGES: Record<AlphaClass, readonly [number, number]> = {
  opaque: [1, 1],
  translucent: [0.02, 0.95],
  border: [0.08, 1],
  scrim: [0.3, 0.9],
}

const BASE_FONT_SIZES: ReadonlyArray<readonly [PanelThemeSharedProperty, number]> = [
  ['--organic-font-label', 12], ['--organic-font-body-sm', 12], ['--organic-font-body-md', 13],
  ['--organic-font-body-lg', 15], ['--organic-font-heading-sm', 15], ['--organic-font-heading-md', 18],
  ['--organic-font-panel-title', 18], ['--organic-font-display-sm', 22], ['--organic-font-display-md', 22],
]
const FONT_FLOOR_PX = 11
export const DEFAULT_BODY_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
export const DEFAULT_HEADING_FAMILY = '"Lining Digits", "Georgia", "Times New Roman", serif'
export const DEFAULT_RADII = { radiusSm: 8, radiusMd: 16, radiusLg: 28 } as const
const RADIUS_MAX = { radiusSm: 16, radiusMd: 24, radiusLg: 32 } as const

const THEME_ID = /^[a-z0-9-]{1,32}$/
const FONT_ID = /^[a-z0-9-]{1,32}$/
const LOCAL_FAMILY = /^[A-Za-z0-9](?:[A-Za-z0-9 -]{0,46}[A-Za-z0-9])?$/
const FONT_REFERENCE = /^@([a-z0-9-]{1,32})$/
const GENERIC_FAMILIES: ReadonlySet<string> = new Set([
  'serif', 'sans-serif', 'monospace', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-rounded', 'ui-monospace',
])
const FITS: ReadonlySet<string> = new Set(['cover', 'contain', 'tile'])
const POSITIONS: ReadonlySet<string> = new Set([
  'center', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right',
])
const MODES: readonly PanelThemeMode[] = ['light', 'dark']

// 診斷只含主機已知的名稱、驗證過的 id、索引與數字，所以不需跳脫即可顯示（僅限開發者模式）。
export class PanelThemeValidationError extends Error {
  readonly diagnostic: string

  constructor(diagnostic: string) {
    const bounded = diagnostic.length > PANEL_THEME_DIAGNOSTIC_MAX_LENGTH
      ? `${diagnostic.slice(0, PANEL_THEME_DIAGNOSTIC_MAX_LENGTH - 1)}…`
      : diagnostic
    super(bounded)
    this.diagnostic = bounded
  }
}

function fail(path: string, problem: string): never {
  throw new PanelThemeValidationError(`${path}: ${problem}`)
}

function ratioText(value: number): string {
  return (Math.floor(value * 100) / 100).toFixed(2)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function assertKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(path, 'unknown key')
  }
}

export function normalizePanelThemePlainText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const text = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > 0 && text.length <= maxLength ? text : null
}

// 這個模組要能被目錄驗證器 vendor，只能 import 同層模組的值，所以不取 SUPPORTED_LOCALES；
// `satisfies Record<AppLocale, true>` 讓新增語系時這裡一定跟著改。
const LOCALIZED_KEYS: readonly string[] = Object.keys({ 'zh-TW': true, 'en-US': true } satisfies Record<AppLocale, true>)

function parseLocalized(value: unknown, maxLength: number, path: string): PluginLocalizedText {
  if (!isRecord(value)) fail(path, 'must be { "zh-TW", "en-US" }')
  assertKeys(value, LOCALIZED_KEYS, path)
  const zhTW = normalizePanelThemePlainText(value['zh-TW'], maxLength)
  const enUS = normalizePanelThemePlainText(value['en-US'], maxLength)
  if (!zhTW || !enUS) fail(path, `each locale needs 1-${maxLength} characters`)
  return { 'zh-TW': zhTW, 'en-US': enUS }
}

export function normalizePanelThemeAssetPath(value: unknown, extensions: readonly string[]): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return null
  const normalized = value.normalize('NFC')
  if (normalized.startsWith('/') || normalized.includes('\\') || normalized.includes('..') || normalized.includes(':')
    || /[\u0000-\u001f\u007f<>"|?*]/.test(normalized)) return null
  const segments = normalized.split('/')
  if (segments.some(segment => segment.length === 0 || segment === '.' || /[. ]$/.test(segment))) return null
  if (segments.some(segment => /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(segment))) return null
  const suffix = `.${normalized.split('.').at(-1)?.toLowerCase() ?? ''}`
  return extensions.includes(suffix) ? normalized : null
}

function integerIn(value: unknown, min: number, max: number, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    fail(path, `must be an integer ${min}-${max}`)
  }
  return value
}

function numberIn(value: unknown, min: number, max: number, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(path, `must be a number ${min}-${max}`)
  }
  return value
}

function hasAtMostTwoDecimals(value: number): boolean {
  return /^\d+(?:\.\d{1,2})?$/.test(String(value))
}

function enumOf<T extends string>(value: unknown, allowed: ReadonlySet<string>, fallback: T, path: string): T {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !allowed.has(value)) fail(path, 'is not an allowed value')
  return value as T
}

function colorAt(value: unknown, path: string): PanelThemeRgba {
  const parsed = parsePanelThemeColor(value)
  if (!parsed.ok) {
    fail(path, parsed.error === 'out_of_gamut' ? 'colour is outside sRGB' : parsed.error === 'out_of_range' ? 'colour value out of range' : 'not an allowed colour')
  }
  return parsed.color
}

function opaqueColorAt(value: unknown, path: string): PanelThemeRgba {
  const color = colorAt(value, path)
  if (color.a !== 1) fail(path, 'must be opaque')
  return color
}

export type PanelThemeFamilyEntry =
  | { kind: 'font'; id: string }
  | { kind: 'local'; name: string }
  | { kind: 'generic'; name: string }

export type ResolvedPanelThemeBackground =
  | { type: 'solid' }
  | { type: 'gradient'; kind: 'linear'; angle: number; stops: Array<{ color: PanelThemeRgba; at: number }> }
  | { type: 'gradient'; kind: 'radial'; position: PluginPanelThemePosition; stops: Array<{ color: PanelThemeRgba; at: number }> }
  | {
      type: 'image'
      src: string
      fit: PluginPanelThemeFit
      position: PluginPanelThemePosition
      opacity: number
      blur: number
      overlay: { color: PanelThemeRgba; opacity: number }
    }

export interface ResolvedPanelThemeMode {
  colors: Record<PluginPanelThemeColorKey, PanelThemeRgba>
  petStatus?: Record<PetStatusColorKey, PanelThemeRgba>
  background: ResolvedPanelThemeBackground
  userImage?: { fit: PluginPanelThemeFit; overlayColor: PanelThemeRgba; defaultDim: number; minDim: number }
}

export interface ResolvedPanelTheme {
  id: string
  displayName: PluginLocalizedText
  description?: PluginLocalizedText
  fonts: PluginPanelThemeFontFace[]
  typography: { body: PanelThemeFamilyEntry[] | null; heading: PanelThemeFamilyEntry[] | null; scale: number }
  shape: { radiusSm: number; radiusMd: number; radiusLg: number }
  modes: Partial<Record<PanelThemeMode, ResolvedPanelThemeMode>>
}

export interface PanelThemeParseResult {
  contributions: PluginPanelThemeContribution[]
  themes: ResolvedPanelTheme[]
}

function parseFonts(value: unknown, path: string): PluginPanelThemeFontFace[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > PANEL_THEME_MAX_FACES_PER_THEME) {
    fail(path, `must be an array of at most ${PANEL_THEME_MAX_FACES_PER_THEME} faces`)
  }
  const faces: PluginPanelThemeFontFace[] = []
  const seen = new Set<string>()
  value.forEach((raw, index) => {
    const facePath = `${path}[${index}]`
    if (!isRecord(raw)) fail(facePath, 'must be an object')
    assertKeys(raw, ['id', 'src', 'weight', 'style'], facePath)
    if (typeof raw.id !== 'string' || !FONT_ID.test(raw.id)) fail(`${facePath}.id`, 'must match ^[a-z0-9-]{1,32}$')
    const src = normalizePanelThemeAssetPath(raw.src, ['.woff2'])
    if (!src) fail(`${facePath}.src`, 'must be a safe relative .woff2 path')
    const weight = raw.weight === undefined ? 400 : raw.weight
    if (weight !== 400 && weight !== 600 && weight !== 700) fail(`${facePath}.weight`, 'must be 400, 600 or 700')
    const style = raw.style === undefined ? 'normal' : raw.style
    if (style !== 'normal' && style !== 'italic') fail(`${facePath}.style`, 'must be normal or italic')
    const key = `${raw.id}\u0000${weight}\u0000${style}`
    if (seen.has(key)) fail(facePath, 'duplicate id, weight and style')
    seen.add(key)
    faces.push({ id: raw.id, src, weight, style })
  })
  return faces
}

function parseFamilyList(value: unknown, fontIds: ReadonlySet<string>, path: string): { raw: string[]; entries: PanelThemeFamilyEntry[] } | null {
  if (value === undefined) return null
  if (!Array.isArray(value) || value.length < 1 || value.length > 5) fail(path, 'must list 1-5 families')
  const entries: PanelThemeFamilyEntry[] = []
  value.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`
    if (typeof entry !== 'string') fail(entryPath, 'must be a string')
    const reference = FONT_REFERENCE.exec(entry)
    if (reference) {
      if (!fontIds.has(reference[1]!)) fail(entryPath, 'names no face in this theme\'s fonts')
      entries.push({ kind: 'font', id: reference[1]! })
    } else if (GENERIC_FAMILIES.has(entry)) {
      entries.push({ kind: 'generic', name: entry })
    } else if (LOCAL_FAMILY.test(entry)) {
      entries.push({ kind: 'local', name: entry })
    } else {
      fail(entryPath, 'is not an allowed family name')
    }
  })
  if (entries.at(-1)?.kind !== 'generic') fail(path, 'last entry must be a generic family')
  return { raw: [...value as string[]], entries }
}

function parseTypography(value: unknown, fontIds: ReadonlySet<string>, path: string) {
  if (value === undefined) return { contribution: { scale: 1 }, body: null, heading: null, scale: 1 }
  if (!isRecord(value)) fail(path, 'must be an object')
  assertKeys(value, ['body', 'heading', 'scale'], path)
  const body = parseFamilyList(value.body, fontIds, `${path}.body`)
  const heading = parseFamilyList(value.heading, fontIds, `${path}.heading`)
  let scale = 1
  if (value.scale !== undefined) {
    scale = numberIn(value.scale, 0.92, 1.15, `${path}.scale`)
    if (!hasAtMostTwoDecimals(scale)) fail(`${path}.scale`, 'must have at most 2 decimals')
  }
  return {
    contribution: { ...(body ? { body: body.raw } : {}), ...(heading ? { heading: heading.raw } : {}), scale },
    body: body?.entries ?? null,
    heading: heading?.entries ?? null,
    scale,
  }
}

function parseShape(value: unknown, path: string): { radiusSm: number; radiusMd: number; radiusLg: number } {
  if (value === undefined) return { ...DEFAULT_RADII }
  if (!isRecord(value)) fail(path, 'must be an object')
  assertKeys(value, ['radiusSm', 'radiusMd', 'radiusLg'], path)
  const shape = { ...DEFAULT_RADII } as { radiusSm: number; radiusMd: number; radiusLg: number }
  for (const key of ['radiusSm', 'radiusMd', 'radiusLg'] as const) {
    if (value[key] !== undefined) shape[key] = integerIn(value[key], 0, RADIUS_MAX[key], `${path}.${key}`)
  }
  if (shape.radiusSm > shape.radiusMd || shape.radiusMd > shape.radiusLg) {
    fail(path, 'radii must satisfy radiusSm <= radiusMd <= radiusLg')
  }
  return shape
}

function builtinColor(token: ColorToken, mode: PanelThemeMode): PanelThemeRgba {
  const parsed = parsePanelThemeColor(mode === 'light' ? token.light : token.dark)
  if (!parsed.ok) throw new TypeError(`built-in ${token.key} is not a valid colour`)
  return parsed.color
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

export function derivePanelThemeColors(
  declared: Partial<Record<PluginPanelThemeColorKey, PanelThemeRgba>>,
  mode: PanelThemeMode,
): Record<PluginPanelThemeColorKey, PanelThemeRgba> {
  const colors = { ...declared } as Record<PluginPanelThemeColorKey, PanelThemeRgba>
  for (const token of PANEL_THEME_COLOR_TOKENS) {
    if (token.kind === 'builtin' && !colors[token.key]) colors[token.key] = builtinColor(token, mode)
  }
  const derive = (key: PluginPanelThemeColorKey, compute: () => PanelThemeRgba) => {
    if (!colors[key]) colors[key] = compute()
  }
  derive('surfaceWarm', () => mixColor(colors.surface, colors.accent, 0.18))
  derive('surfaceSage', () => mixColor(colors.surface, colors.sage, 0.18))
  derive('surfaceSageSoft', () => mixColor(colors.surface, colors.sage, 0.08))
  derive('surfaceOff', () => mixColor(colors.surface2, colors.text, 0.12))
  derive('textFaint', () => ({ ...colors.textMuted }))
  derive('accentHover', () => deriveAccentHover(colors.accent, colors.text, colors.onAccent))
  derive('accentGlow', () => withAlpha(colors.accent, 0.22))
  derive('accentTrack', () => withAlpha(colors.text, 0.08))
  derive('accentOnHover', () => withAlpha(colors.text, 0.05))
  derive('sageTrack', () => withAlpha(colors.sageDark, 0.16))
  derive('borderSoft', () => withAlpha(colors.border, round3(colors.border.a * 0.625)))
  return colors
}

// 都不符合時取 0.20（主題會因 onAccent/accentHover 這組被拒絕）；結果是確定性的。
export function deriveAccentHover(accent: PanelThemeRgba, text: PanelThemeRgba, onAccent: PanelThemeRgba): PanelThemeRgba {
  for (let step = 20; step <= 60; step += 5) {
    const candidate = mixColor(accent, text, step / 100)
    if (contrastRatio(onAccent, candidate) >= 4.5) return candidate
  }
  return mixColor(accent, text, 0.2)
}

type ColorSet = Record<PluginPanelThemeColorKey, PanelThemeRgba>
interface Backdrop { name: string; color: PanelThemeRgba }
type Pair = readonly [PluginPanelThemeColorKey, number]

const BACKDROP_PAIRS: readonly Pair[] = [['text', 4.5], ['textSecondary', 4.5], ['textMuted', 4.5], ['accentText', 4.5], ['accent', 3]]
interface ContrastFailure {
  foreground: string
  background: string
  ratio: number
  minimum: number
  /** 前景是主機固定色時，改指向失敗的表面。 */
  blame?: string
}

export type PanelThemeIssueKind = 'alpha' | 'direction' | 'luminance' | 'chroma' | 'hue' | 'distance' | 'contrast' | 'overlay'

// `path` 相對於模式（`colors.textMuted`、`background.overlay.opacity`）。只含主機已知的名稱與數字。
export interface PanelThemeIssue {
  path: string
  kind: PanelThemeIssueKind
  problem: string
  foreground?: string
  background?: string
  measured?: number
  required?: number
}

function* backdropFailures(colors: ColorSet, backdrops: readonly Backdrop[]): Generator<ContrastFailure> {
  for (const backdrop of backdrops) {
    for (const [key, minimum] of BACKDROP_PAIRS) {
      const ratio = contrastRatio(colors[key], backdrop.color)
      if (!(ratio >= minimum)) yield { foreground: key, background: backdrop.name, ratio, minimum }
    }
  }
}

function firstOf<T>(values: Iterable<T>): T | null {
  for (const value of values) return value
  return null
}

function firstBackdropFailure(colors: ColorSet, backdrops: readonly Backdrop[]): ContrastFailure | null {
  return firstOf(backdropFailures(colors, backdrops))
}

// 狀態色必須維持語意（紅、綠、琥珀、藍），且彼此與強調色之間要有最小色差，避免把「危險」畫得像「成功」或一般按鈕。
type HueRange = readonly [number, number]
export const PANEL_THEME_STATE_HUES: Readonly<Record<'dangerText' | 'successText' | 'warnText' | 'infoText', readonly HueRange[]>> = Object.freeze({
  dangerText: [[0, 50], [340, 360]],
  successText: [[105, 170]],
  warnText: [[55, 105]],
  infoText: [[200, 290]],
})
export const PANEL_THEME_STATE_MIN_CHROMA = 0.05
export const PANEL_THEME_STATE_MIN_DISTANCE = 0.08
// 以填色 `accent` 而非 `accentText` 比較：會被誤認的是強調按鈕與風險徽章。
export const PANEL_THEME_STATE_ACCENT_MIN_DISTANCE = 0.06

const STATE_DISTANCE_PAIRS: ReadonlyArray<readonly [PluginPanelThemeColorKey, PluginPanelThemeColorKey, number]> = [
  ['dangerText', 'successText', PANEL_THEME_STATE_MIN_DISTANCE],
  ['dangerText', 'warnText', PANEL_THEME_STATE_MIN_DISTANCE],
  ['successText', 'warnText', PANEL_THEME_STATE_MIN_DISTANCE],
  ['infoText', 'dangerText', PANEL_THEME_STATE_MIN_DISTANCE],
  ['infoText', 'successText', PANEL_THEME_STATE_MIN_DISTANCE],
  ['infoText', 'warnText', PANEL_THEME_STATE_MIN_DISTANCE],
  ['dangerText', 'accent', PANEL_THEME_STATE_ACCENT_MIN_DISTANCE],
  ['successText', 'accent', PANEL_THEME_STATE_ACCENT_MIN_DISTANCE],
  ['warnText', 'accent', PANEL_THEME_STATE_ACCENT_MIN_DISTANCE],
  ['infoText', 'accent', PANEL_THEME_STATE_ACCENT_MIN_DISTANCE],
]

// 主題會套到每個介面（包含權限與風險 UI），所以由主機在接受前證明每個文字/圖示 token 在每個表面上都夠清楚。
// 版面、文字標籤與「按住才允許」由主機程式碼決定，主題無法改變。

// 以下 alpha 與 tokens.css 的 color-mix 比例相同。
export const PET_BUBBLE_SURFACE_ALPHA = 0.93
export const PET_PILL_SURFACE_ALPHA = 0.92
export const PET_OVERLAY_SURFACE_ALPHA = 0.98
// tokens.css --organic-status-track
export const PET_PILL_TRACK_ALPHA = 0.14
// Button.vue、InlinePermissionCard.vue 的主要按鈕懸停混合比例。
export const PANEL_THEME_PRESSED_MIX = 0.12
// 陰影色必須夠暗、高光色必須夠亮，才不會變成一層有色的霧蓋住文字。
export const PANEL_THEME_SHADOW_MAX_LUMINANCE = 0.05
export const PANEL_THEME_HIGHLIGHT_MIN_LUMINANCE = 0.7

export const PANEL_THEME_STATE_TINT_ALPHA = 0.12

const TEXT_KEYS = ['text', 'textSecondary', 'textMuted', 'accentText', 'dangerText', 'successText', 'warnText', 'infoText'] as const
type ColorKey = PluginPanelThemeColorKey

// 依元件實際用法決定每個表面會出現哪些文字。bg 排在最後：同時失敗時先指出卡片表面。
interface SurfaceSpec {
  name: string
  reads: readonly ColorKey[]
  color(colors: ColorSet): PanelThemeRgba
  blame?: ColorKey
  pill: boolean
  focus: boolean
  text: readonly ColorKey[]
}

// 鼠尾草文字只出現在面板，不在寵物介面。
const PANEL_TEXT_KEYS: readonly ColorKey[] = [...TEXT_KEYS, 'sageDeep', 'sageDark']
const OPAQUE_SURFACES: ReadonlyArray<readonly [ColorKey, readonly ColorKey[]]> = [
  ['surface', PANEL_TEXT_KEYS],
  ['surface2', PANEL_TEXT_KEYS],
  ['surfaceWarm', ['text', 'accentText']],
  ['surfaceSage', ['text', 'sageDeep', 'sageDark']],
  ['surfaceSageSoft', ['text', 'sageDark']],
  ['bg', PANEL_TEXT_KEYS],
]
// 懸停底的文字繼承自所在列，所以依列的實際組合檢查；失敗時指向 accentOnHover。
const HOVER_WASH_SURFACES: ReadonlyArray<readonly [ColorKey, readonly ColorKey[]]> = [
  ['surface', TEXT_KEYS],
  ['surface2', ['text', 'textSecondary']],
  ['surfaceWarm', ['text', 'accentText']],
  ['surfaceSage', ['text', 'sageDark']],
]
const STATE_TINT_KEYS = ['dangerText', 'successText', 'warnText'] as const
const STATE_TINT_BASES: readonly ColorKey[] = ['surface', 'surface2', 'bg']
const DESKTOPS = [['black', PANEL_THEME_BLACK], ['white', PANEL_THEME_WHITE]] as const

function surfaceSpecs(): SurfaceSpec[] {
  const surfaces: SurfaceSpec[] = OPAQUE_SURFACES.map(([key, text]) => ({ name: key, reads: [key], color: colors => colors[key], pill: false, focus: true, text }))
  for (const [base, text] of HOVER_WASH_SURFACES) {
    surfaces.push({ name: `accentOnHover over ${base}`, reads: ['accentOnHover', base], color: colors => compositeColor(colors.accentOnHover, colors[base]), blame: 'accentOnHover', pill: false, focus: true, text })
  }
  // 同色文字放在 12% 的同色底上；底愈濃對比愈低，所以以上限檢查。
  for (const key of STATE_TINT_KEYS) {
    for (const base of STATE_TINT_BASES) {
      surfaces.push({
        name: `${key} at ${PANEL_THEME_STATE_TINT_ALPHA} over ${base} (state chip)`,
        reads: [key, base],
        color: colors => compositeColor(withAlphaUnrounded(colors[key], PANEL_THEME_STATE_TINT_ALPHA), colors[base]),
        pill: false,
        focus: false,
        text: [key],
      })
    }
  }
  const translucent: ReadonlyArray<readonly [string, number, boolean]> = [
    ['pet bubble', PET_BUBBLE_SURFACE_ALPHA, false],
    ['pet status pill', PET_PILL_SURFACE_ALPHA, true],
    ['pet overlay', PET_OVERLAY_SURFACE_ALPHA, false],
  ]
  for (const [label, alpha, pill] of translucent) {
    for (const [desktop, base] of DESKTOPS) {
      surfaces.push({ name: `${label} over a ${desktop} desktop`, reads: ['surface'], color: colors => compositeColor(withAlphaUnrounded(colors.surface, alpha), base), pill, focus: true, text: TEXT_KEYS })
    }
  }
  // 危險按鈕懸停（Button.vue）：面板對話框已由上面的狀態晶片檢查，寵物視窗的對話框是半透明的，另外檢查。
  for (const [desktop, base] of DESKTOPS) {
    surfaces.push({
      name: `dangerText at ${PANEL_THEME_STATE_TINT_ALPHA} over the pet overlay over a ${desktop} desktop (danger button hover)`,
      reads: ['dangerText', 'surface'],
      color: colors => compositeColor(withAlphaUnrounded(colors.dangerText, PANEL_THEME_STATE_TINT_ALPHA), compositeColor(withAlphaUnrounded(colors.surface, PET_OVERLAY_SURFACE_ALPHA), base)),
      pill: false,
      focus: true,
      text: ['dangerText'],
    })
  }
  return surfaces
}

// `reads` 讓主題編輯器的建議值搜尋只重跑讀到被換鍵的配對。
interface InvariantCheck { reads: readonly ColorKey[]; failure(colors: ColorSet): ContrastFailure | null }

function invariantChecks(): InvariantCheck[] {
  const checks: InvariantCheck[] = []
  const pair = (
    foreground: ColorKey,
    reads: readonly ColorKey[],
    background: (colors: ColorSet) => PanelThemeRgba,
    minimum: number,
    names: { foreground: string; background: string; blame?: string },
  ) => {
    checks.push({
      reads: [...new Set([foreground, ...reads])],
      failure: colors => {
        const ratio = contrastRatio(colors[foreground], background(colors))
        return ratio >= minimum ? null : { ...names, ratio, minimum }
      },
    })
  }
  for (const surface of surfaceSpecs()) {
    const blame = surface.blame ? { blame: surface.blame } : {}
    for (const key of surface.text) pair(key, surface.reads, surface.color, 4.5, { foreground: key, background: surface.name, ...blame })
    // 焦點環不會畫在狀態晶片上（晶片不可聚焦）。
    if (surface.focus) pair('accentText', surface.reads, surface.color, 3, { foreground: 'accentText', background: `${surface.name} (focus ring)`, ...blame })
    if (!surface.pill) continue
    const track = (colors: ColorSet) => compositeColor(withAlphaUnrounded(colors.text, PET_PILL_TRACK_ALPHA), surface.color(colors))
    for (const key of ['sageDeep', 'accentText', 'warnText', 'dangerText'] as const) {
      pair(key, surface.reads, surface.color, 3, { foreground: key, background: `${surface.name} (quota fill)` })
      pair(key, ['text', ...surface.reads], track, 3, { foreground: key, background: `the quota track on the ${surface.name}` })
    }
  }
  const pairs: ReadonlyArray<readonly [ColorKey, readonly ColorKey[], (colors: ColorSet) => PanelThemeRgba, number, string]> = [
    ['textFaint', ['surface'], colors => colors.surface, 3, 'surface'],
    ['textFaint', ['bg'], colors => colors.bg, 3, 'bg'],
    ['accent', ['surface'], colors => colors.surface, 3, 'surface'],
    ['onAccent', ['accent'], colors => colors.accent, 3, 'accent'],
    ['onAccent', ['accentHover'], colors => colors.accentHover, 4.5, 'accentHover'],
    ['onAccent', ['accentHover', 'text'], colors => mixColor(colors.accentHover, colors.text, PANEL_THEME_PRESSED_MIX), 4.5, 'accentHover mixed 12% toward text (hovered primary button)'],
    ['bg', ['dangerText'], colors => colors.dangerText, 4.5, 'dangerText (badge fill)'],
    ['bg', ['successText'], colors => colors.successText, 4.5, 'successText (badge fill)'],
    ['bg', ['warnText'], colors => colors.warnText, 4.5, 'warnText (badge fill)'],
  ]
  for (const [key, reads, background, minimum, name] of pairs) pair(key, reads, background, minimum, { foreground: key, background: name })
  return checks
}

const INVARIANT_CHECKS: readonly InvariantCheck[] = invariantChecks()

export function panelThemeInvariantFailure(colors: ColorSet): ContrastFailure | null {
  return firstOf(panelThemeInvariantFailures(colors))
}

// 固定順序：同一組輸入一定得到同一個診斷。
export function* panelThemeInvariantFailures(colors: ColorSet): Generator<ContrastFailure> {
  for (const check of INVARIANT_CHECKS) {
    const failure = check.failure(colors)
    if (failure) yield failure
  }
}

function imageBackdrops(colors: ColorSet, overlay: PanelThemeRgba, overlayOpacity: number, imageOpacity: number, label: string): Backdrop[] {
  return [PANEL_THEME_BLACK, PANEL_THEME_WHITE].map((extreme, index) => {
    const painted = compositeColor(withAlphaUnrounded(extreme, imageOpacity), colors.bg)
    return {
      name: label === 'overlay' ? `overlay over a ${index === 0 ? 'black' : 'white'} pixel` : `${index === 0 ? 'black' : 'white'} image pixel`,
      color: compositeColor(withAlphaUnrounded(overlay, overlayOpacity), painted),
    }
  })
}

function withAlphaUnrounded(color: PanelThemeRgba, alpha: number): PanelThemeRgba {
  return { r: color.r, g: color.g, b: color.b, a: alpha }
}

// 採後綴封閉：使用者之後選擇任何大於等於最小值的 dim 都保證通過（以最差情況的黑/白圖片像素計算）。
export function minimumPanelThemeOverlay(colors: ColorSet, overlay: PanelThemeRgba, imageOpacity: number): number | null {
  let minimum: number | null = null
  for (let step = 95; step >= 50; step -= 1) {
    const opacity = step / 100
    if (firstBackdropFailure(colors, imageBackdrops(colors, overlay, opacity, imageOpacity, 'overlay'))) break
    minimum = opacity
  }
  return minimum
}

function overlayIssue(colors: ColorSet, overlay: { color: PanelThemeRgba; opacity: number }, imageOpacity: number, path: string, label: string): PanelThemeIssue | null {
  const minimum = minimumPanelThemeOverlay(colors, overlay.color, imageOpacity)
  const probe = minimum === null ? PANEL_THEME_OVERLAY_CEILING : overlay.opacity
  const failure = firstBackdropFailure(colors, imageBackdrops(colors, overlay.color, probe, imageOpacity, label))
  if (minimum === null) {
    const detail = failure ? `${failure.foreground} ${ratioText(failure.ratio)}:1 < ${failure.minimum}:1 on ${failure.background}` : 'text unreadable'
    return { path: `${path}.opacity`, kind: 'overlay', problem: `no overlay up to 0.95 passes (${detail} at 0.95); change the overlay colour or text colours`, measured: overlay.opacity }
  }
  if (overlay.opacity < minimum) {
    const detail = failure ? `; ${failure.foreground} ${ratioText(failure.ratio)}:1 < ${failure.minimum}:1 on ${failure.background}` : ''
    return { path: `${path}.opacity`, kind: 'overlay', problem: `${overlay.opacity} < minimum ${minimum.toFixed(2)}${detail}`, measured: overlay.opacity, required: minimum }
  }
  return null
}

function parseOverlay(value: unknown, path: string): { color: PanelThemeRgba; opacity: number } {
  if (!isRecord(value)) fail(path, 'must be { color, opacity }')
  assertKeys(value, ['color', 'opacity'], path)
  const color = opaqueColorAt(value.color, `${path}.color`)
  const opacity = numberIn(value.opacity, PANEL_THEME_OVERLAY_FLOOR, PANEL_THEME_OVERLAY_CEILING, `${path}.opacity`)
  return { color, opacity }
}

function parseStops(value: unknown, path: string): Array<{ color: PanelThemeRgba; at: number }> {
  if (!Array.isArray(value) || value.length < 2 || value.length > PANEL_THEME_MAX_STOPS) fail(path, 'needs 2-5 stops')
  let previous = -1
  return value.map((raw, index) => {
    const stopPath = `${path}[${index}]`
    if (!isRecord(raw)) fail(stopPath, 'must be { color, at }')
    assertKeys(raw, ['color', 'at'], stopPath)
    const color = opaqueColorAt(raw.color, `${stopPath}.color`)
    const at = integerIn(raw.at, 0, 100, `${stopPath}.at`)
    if (at < previous) fail(`${stopPath}.at`, 'stops must not decrease')
    previous = at
    return { color, at }
  })
}

function parseBackground(value: unknown, path: string): ResolvedPanelThemeBackground {
  if (value === undefined) return { type: 'solid' }
  if (!isRecord(value)) fail(path, 'must be an object')
  switch (value.type) {
    case 'solid': {
      assertKeys(value, ['type'], path)
      return { type: 'solid' }
    }
    case 'gradient': {
      if (value.kind === 'linear') {
        assertKeys(value, ['type', 'kind', 'angle', 'stops'], path)
        const angle = value.angle === undefined ? 180 : integerIn(value.angle, 0, 359, `${path}.angle`)
        return { type: 'gradient', kind: 'linear', angle, stops: parseStops(value.stops, `${path}.stops`) }
      }
      if (value.kind === 'radial') {
        assertKeys(value, ['type', 'kind', 'position', 'stops'], path)
        const position = enumOf<PluginPanelThemePosition>(value.position, POSITIONS, 'center', `${path}.position`)
        return { type: 'gradient', kind: 'radial', position, stops: parseStops(value.stops, `${path}.stops`) }
      }
      return fail(`${path}.kind`, 'must be linear or radial')
    }
    case 'image': {
      assertKeys(value, ['type', 'src', 'fit', 'position', 'opacity', 'blur', 'overlay'], path)
      const src = normalizePanelThemeAssetPath(value.src, ['.png', '.webp'])
      if (!src) fail(`${path}.src`, 'must be a safe relative .png or .webp path')
      return {
        type: 'image',
        src,
        fit: enumOf<PluginPanelThemeFit>(value.fit, FITS, 'cover', `${path}.fit`),
        position: enumOf<PluginPanelThemePosition>(value.position, POSITIONS, 'center', `${path}.position`),
        opacity: value.opacity === undefined ? 1 : numberIn(value.opacity, 0.2, 1, `${path}.opacity`),
        blur: value.blur === undefined ? 0 : integerIn(value.blur, 0, 24, `${path}.blur`),
        overlay: parseOverlay(value.overlay, `${path}.overlay`),
      }
    }
    default:
      fail(`${path}.type`, 'must be solid, gradient or image')
  }
}

function contrastIssue(failure: ContrastFailure): PanelThemeIssue {
  const subject = failure.blame ? `${failure.foreground} ${ratioText(failure.ratio)}:1` : `${ratioText(failure.ratio)}:1`
  return {
    path: `colors.${failure.blame ?? failure.foreground}`,
    kind: 'contrast',
    problem: `${subject} < ${failure.minimum}:1 on ${failure.background}`,
    foreground: failure.foreground,
    background: failure.background,
    measured: failure.ratio,
    required: failure.minimum,
  }
}

export interface PanelThemeModeCheckInput {
  mode: PanelThemeMode
  colors: ColorSet
  background: ResolvedPanelThemeBackground
  userImageOverlay?: { color: PanelThemeRgba; opacity: number }
  petStatus?: Record<PetStatusColorKey, PanelThemeRgba>
}

// 問題的 `path` 一定在 `reads` 裡：編輯器替一個鍵找建議值時只重跑讀到它的檢查，其他檢查的結果不可能改變。
interface ModeCheck {
  reads: readonly string[]
  run(input: PanelThemeModeCheckInput): PanelThemeIssue | null
}

interface ModeCheckPlan {
  checks: readonly ModeCheck[]
  byRead: ReadonlyMap<string, readonly ModeCheck[]>
}

const colorRead = (key: ColorKey): string => `colors.${key}`
const petStatusRead = (key: PetStatusColorKey): string => `petStatus.${key}`

function contrastCheck(check: InvariantCheck): ModeCheck {
  return {
    reads: check.reads.map(colorRead),
    run: ({ colors }) => {
      const failure = check.failure(colors)
      return failure ? contrastIssue(failure) : null
    },
  }
}

function backdropChecks(name: string, reads: readonly ColorKey[], color: (input: PanelThemeModeCheckInput) => PanelThemeRgba): ModeCheck[] {
  return BACKDROP_PAIRS.map(([key, minimum]) => ({
    reads: [...new Set([key, ...reads])].map(colorRead),
    run: input => {
      const ratio = contrastRatio(input.colors[key], color(input))
      return ratio >= minimum ? null : contrastIssue({ foreground: key, background: name, ratio, minimum })
    },
  }))
}

function staticModeChecks(): ModeCheck[] {
  const checks: ModeCheck[] = PANEL_THEME_COLOR_TOKENS.map(token => {
    const [min, max] = ALPHA_RANGES[token.alpha]
    const problem = token.alpha === 'opaque' ? 'must be opaque' : `alpha must be ${min}-${max}`
    return {
      reads: [colorRead(token.key)],
      run: ({ colors }) => {
        const alpha = colors[token.key].a
        return alpha < min || alpha > max ? { path: `colors.${token.key}`, kind: 'alpha', problem, measured: alpha, required: min } : null
      },
    }
  })
  checks.push({
    reads: [colorRead('bg'), colorRead('text')],
    run: ({ mode, colors }) => {
      const bgLuminance = relativeLuminance(colors.bg)
      const textLuminance = relativeLuminance(colors.text)
      if (mode === 'light' && !(textLuminance < bgLuminance && bgLuminance >= 0.45)) {
        return { path: 'colors.bg', kind: 'direction', problem: 'light mode needs a light bg (luminance >= 0.45) and darker text', measured: bgLuminance, required: 0.45 }
      }
      if (mode === 'dark' && !(textLuminance > bgLuminance && bgLuminance <= 0.12)) {
        return { path: 'colors.bg', kind: 'direction', problem: 'dark mode needs a dark bg (luminance <= 0.12) and lighter text', measured: bgLuminance, required: 0.12 }
      }
      return null
    },
  })
  checks.push({
    reads: [colorRead('shadow')],
    run: ({ colors }) => {
      const luminance = relativeLuminance(colors.shadow)
      return luminance > PANEL_THEME_SHADOW_MAX_LUMINANCE
        ? { path: 'colors.shadow', kind: 'luminance', problem: `luminance ${luminance.toFixed(3)} > ${PANEL_THEME_SHADOW_MAX_LUMINANCE} (a shadow must be dark)`, measured: luminance, required: PANEL_THEME_SHADOW_MAX_LUMINANCE }
        : null
    },
  })
  checks.push({
    reads: [colorRead('highlight')],
    run: ({ colors }) => {
      const luminance = relativeLuminance(colors.highlight)
      return luminance < PANEL_THEME_HIGHLIGHT_MIN_LUMINANCE
        ? { path: 'colors.highlight', kind: 'luminance', problem: `luminance ${luminance.toFixed(3)} < ${PANEL_THEME_HIGHLIGHT_MIN_LUMINANCE} (a highlight must be light)`, measured: luminance, required: PANEL_THEME_HIGHLIGHT_MIN_LUMINANCE }
        : null
    },
  })
  for (const [key, ranges] of Object.entries(PANEL_THEME_STATE_HUES) as Array<[keyof typeof PANEL_THEME_STATE_HUES, readonly HueRange[]]>) {
    const allowed = ranges.map(([from, to]) => `${from}–${to}°`).join(' or ')
    checks.push({
      reads: [colorRead(key)],
      run: ({ colors }) => {
        const { c, h } = rgbToOklch(colors[key])
        if (c < PANEL_THEME_STATE_MIN_CHROMA) {
          return { path: `colors.${key}`, kind: 'chroma', problem: `chroma ${c.toFixed(3)} < ${PANEL_THEME_STATE_MIN_CHROMA} (too grey to read as a state colour)`, measured: c, required: PANEL_THEME_STATE_MIN_CHROMA }
        }
        if (!ranges.some(([from, to]) => h >= from && h <= to)) {
          return { path: `colors.${key}`, kind: 'hue', problem: `OKLCH hue ${Math.round(h)}° is outside ${allowed}`, measured: h, required: ranges[0]![0] }
        }
        return null
      },
    })
  }
  for (const [first, second, minimum] of STATE_DISTANCE_PAIRS) {
    checks.push({
      reads: [colorRead(first), colorRead(second)],
      run: ({ colors }) => {
        const distance = oklabDistance(colors[first], colors[second])
        return distance < minimum
          ? { path: `colors.${first}`, kind: 'distance', problem: `OKLab ΔE ${distance.toFixed(3)} to ${second} < ${minimum}`, measured: distance, required: minimum, background: second }
          : null
      },
    })
  }
  checks.push(...INVARIANT_CHECKS.map(contrastCheck))
  checks.push(...backdropChecks('bg', ['bg'], input => input.colors.bg))
  return checks
}

const STATIC_MODE_CHECKS: readonly ModeCheck[] = staticModeChecks()
// imageBackdrops 以 bg 為底；問題的 path（`…overlay.opacity`）另外加入，維持「path 一定在 reads 裡」。
const OVERLAY_READS: readonly string[] = [...BACKDROP_PAIRS.map(([key]) => key), 'bg'].map(key => colorRead(key as ColorKey))

function gradientStopColor(input: PanelThemeModeCheckInput, index: number): PanelThemeRgba {
  return input.background.type === 'gradient' ? input.background.stops[index]!.color : PANEL_THEME_BLACK
}

function petStatusChecks(): ModeCheck[] {
  const checks: ModeCheck[] = PET_STATUS_TOKENS.map(token => {
    const [min, max] = token.alpha
    const problem = min === 1 ? 'must be opaque' : `alpha must be ${min}-${max}`
    return {
      reads: [petStatusRead(token.key)],
      run: ({ petStatus }) => {
        const alpha = petStatus![token.key].a
        return alpha < min || alpha > max ? { path: `petStatus.${token.key}`, kind: 'alpha', problem, measured: alpha, required: min } : null
      },
    }
  })
  for (const [index, desktop] of [PANEL_THEME_BLACK, PANEL_THEME_WHITE].entries()) {
    const name = `pill over a ${index === 0 ? 'black' : 'white'} desktop`
    const pill = (resolved: Record<PetStatusColorKey, PanelThemeRgba>) => compositeColor(resolved.background, desktop)
    const track = (resolved: Record<PetStatusColorKey, PanelThemeRgba>) => compositeColor(resolved.quotaTrack, pill(resolved))
    const pairs: ReadonlyArray<readonly [PetStatusColorKey, readonly PetStatusColorKey[], typeof pill, string, number]> = [
      ['text', ['background'], pill, name, 4.5],
      ['textMuted', ['background'], pill, name, 4.5],
      ['quotaFill', ['background'], pill, name, 3],
      ['quotaFill', ['background', 'quotaTrack'], track, `quotaTrack on the ${name}`, 3],
      ['quotaWarn', ['background'], pill, name, 3],
      ['quotaWarn', ['background', 'quotaTrack'], track, `quotaTrack on the ${name}`, 3],
    ]
    for (const [key, reads, background, label, minimum] of pairs) {
      checks.push({
        reads: [key, ...reads].map(petStatusRead),
        run: ({ petStatus }) => {
          const ratio = contrastRatio(petStatus![key], background(petStatus!))
          return ratio >= minimum ? null : { path: `petStatus.${key}`, kind: 'contrast', problem: `${ratioText(ratio)}:1 < ${minimum}:1 on ${label}`, foreground: key, background: label, measured: ratio, required: minimum }
        },
      })
    }
  }
  return checks
}

const PET_STATUS_CHECKS: readonly ModeCheck[] = petStatusChecks()

function buildModeCheckPlan(input: PanelThemeModeCheckInput): ModeCheckPlan {
  const checks: ModeCheck[] = [...STATIC_MODE_CHECKS]
  const { background } = input
  if (background.type === 'gradient') {
    const count = background.stops.length
    for (let index = 0; index < count; index += 1) {
      checks.push(...backdropChecks(`gradient stop ${index}`, [], current => gradientStopColor(current, index)))
    }
    for (let index = 0; index + 1 < count; index += 1) {
      for (const t of [0.25, 0.5, 0.75]) {
        checks.push(...backdropChecks(`gradient between stops ${index} and ${index + 1}`, [], current => mixColor(gradientStopColor(current, index), gradientStopColor(current, index + 1), t)))
      }
    }
  }
  if (background.type === 'image') {
    checks.push({
      reads: [...OVERLAY_READS, 'background.overlay.opacity'],
      run: current => current.background.type === 'image'
        ? overlayIssue(current.colors, current.background.overlay, current.background.opacity, 'background.overlay', 'a black/white image pixel')
        : null,
    })
  }
  if (input.userImageOverlay) {
    checks.push({
      reads: [...OVERLAY_READS, 'userImage.overlay.opacity'],
      run: current => current.userImageOverlay ? overlayIssue(current.colors, current.userImageOverlay, 1, 'userImage.overlay', 'a black/white image pixel') : null,
    })
  }
  if (input.petStatus) checks.push(...PET_STATUS_CHECKS)
  const byRead = new Map<string, ModeCheck[]>()
  for (const check of checks) {
    for (const read of check.reads) {
      const list = byRead.get(read)
      if (list) list.push(check)
      else byRead.set(read, [check])
    }
  }
  return { checks, byRead }
}

const MODE_CHECK_PLANS = new Map<string, ModeCheckPlan>()

function modeCheckPlan(input: PanelThemeModeCheckInput): ModeCheckPlan {
  const { background } = input
  const shape = `${background.type}:${background.type === 'gradient' ? background.stops.length : 0}:${input.userImageOverlay ? 1 : 0}:${input.petStatus ? 1 : 0}`
  let plan = MODE_CHECK_PLANS.get(shape)
  if (!plan) {
    plan = buildModeCheckPlan(input)
    MODE_CHECK_PLANS.set(shape, plan)
  }
  return plan
}

function* runChecks(checks: readonly ModeCheck[], input: PanelThemeModeCheckInput): Generator<PanelThemeIssue> {
  for (const check of checks) {
    const issue = check.run(input)
    if (issue) yield issue
  }
}

// 驗證器取第一個，編輯器診斷走完全部，所以兩者對「哪裡錯」的判斷永遠一致。
export function panelThemeModeIssues(input: PanelThemeModeCheckInput): Generator<PanelThemeIssue> {
  return runChecks(modeCheckPlan(input).checks, input)
}

export function panelThemeModeIssuesReading(input: PanelThemeModeCheckInput, read: string): Generator<PanelThemeIssue> {
  return runChecks(modeCheckPlan(input).byRead.get(read) ?? [], input)
}

interface ParsedModeGrammar {
  input: PanelThemeModeCheckInput
  declared: Partial<Record<PluginPanelThemeColorKey, PanelThemeRgba>>
  userImageFit?: PluginPanelThemeFit
  petStatusContribution?: Partial<Record<PetStatusColorKey, string>>
}

function parseModeGrammar(value: unknown, mode: PanelThemeMode, path: string): ParsedModeGrammar {
  if (!isRecord(value)) fail(path, 'must be an object')
  assertKeys(value, ['colors', 'background', 'userImage', 'petStatus'], path)
  if (!isRecord(value.colors)) fail(`${path}.colors`, 'is required')
  const declared: Partial<Record<PluginPanelThemeColorKey, PanelThemeRgba>> = {}
  for (const [key, raw] of Object.entries(value.colors)) {
    const deprecated = Object.hasOwn(PANEL_THEME_DEPRECATED_COLOR_KEYS, key) ? PANEL_THEME_DEPRECATED_COLOR_KEYS[key]! : null
    if (deprecated) {
      const [min, max] = ALPHA_RANGES[deprecated]
      const alpha = colorAt(raw, `${path}.colors.${key}`).a
      if (alpha < min || alpha > max) fail(`${path}.colors.${key}`, `alpha must be ${min}-${max}`)
      continue
    }
    const token = TOKEN_BY_KEY.get(key)
    if (!token) fail(`${path}.colors`, 'unknown key')
    declared[token.key] = colorAt(raw, `${path}.colors.${token.key}`)
  }
  for (const token of PANEL_THEME_COLOR_TOKENS) {
    if (token.kind === 'required' && !declared[token.key]) fail(`${path}.colors.${token.key}`, 'is required')
  }
  const colors = derivePanelThemeColors(declared, mode)
  const background = parseBackground(value.background, `${path}.background`)

  let userImageFit: PluginPanelThemeFit | undefined
  let userImageOverlay: { color: PanelThemeRgba; opacity: number } | undefined
  if (value.userImage !== undefined) {
    const userPath = `${path}.userImage`
    if (!isRecord(value.userImage)) fail(userPath, 'must be an object')
    assertKeys(value.userImage, ['allowed', 'fit', 'overlay'], userPath)
    if (value.userImage.allowed !== true) fail(`${userPath}.allowed`, 'must be true')
    userImageFit = enumOf<PluginPanelThemeFit>(value.userImage.fit, FITS, 'cover', `${userPath}.fit`)
    userImageOverlay = parseOverlay(value.userImage.overlay, `${userPath}.overlay`)
  }

  let petStatus: Record<PetStatusColorKey, PanelThemeRgba> | undefined
  let petStatusContribution: Partial<Record<PetStatusColorKey, string>> | undefined
  if (value.petStatus !== undefined) {
    const parsed = parsePetStatus(value.petStatus, colors, `${path}.petStatus`)
    petStatus = parsed.resolved
    petStatusContribution = parsed.contribution
  }

  return {
    input: { mode, colors, background, ...(userImageOverlay ? { userImageOverlay } : {}), ...(petStatus ? { petStatus } : {}) },
    declared,
    ...(userImageFit ? { userImageFit } : {}),
    ...(petStatusContribution ? { petStatusContribution } : {}),
  }
}

export function panelThemeModeCheckInput(value: unknown, mode: PanelThemeMode): PanelThemeModeCheckInput {
  return parseModeGrammar(value, mode, mode).input
}

function parseMode(value: unknown, mode: PanelThemeMode, path: string): { contribution: PluginPanelThemeModeDefinition; resolved: ResolvedPanelThemeMode } {
  const { input, declared, userImageFit, petStatusContribution } = parseModeGrammar(value, mode, path)
  const { colors, background, userImageOverlay, petStatus } = input
  const issue = firstOf(panelThemeModeIssues(input))
  if (issue) fail(`${path}.${issue.path}`, issue.problem)
  let userImage: ResolvedPanelThemeMode['userImage']
  let userImageContribution: PluginPanelThemeModeDefinition['userImage']
  if (userImageOverlay) {
    const fit = userImageFit ?? 'cover'
    // 上面的覆蓋層檢查已確認最小值存在且不高於宣告值。
    userImage = { fit, overlayColor: userImageOverlay.color, defaultDim: userImageOverlay.opacity, minDim: minimumPanelThemeOverlay(colors, userImageOverlay.color, 1)! }
    userImageContribution = { allowed: true, fit, overlay: { color: formatPanelThemeColor(userImageOverlay.color), opacity: userImageOverlay.opacity } }
  }

  const contributionColors: PluginPanelThemeColors = {}
  for (const [key, color] of Object.entries(declared)) contributionColors[key as PluginPanelThemeColorKey] = formatPanelThemeColor(color)
  return {
    contribution: {
      colors: contributionColors,
      background: contributionBackground(background),
      ...(userImageContribution ? { userImage: userImageContribution } : {}),
      ...(petStatusContribution ? { petStatus: petStatusContribution } : {}),
    },
    resolved: { colors, background, ...(userImage ? { userImage } : {}), ...(petStatus ? { petStatus } : {}) },
  }
}

export function derivePetStatusColors(
  declared: Partial<Record<PetStatusColorKey, PanelThemeRgba>> & { background: PanelThemeRgba; text: PanelThemeRgba },
  modeColors: Pick<ColorSet, 'accent'>,
): Record<PetStatusColorKey, PanelThemeRgba> {
  const opaqueBackground = withAlpha(declared.background, 1)
  const warning = parsePanelThemeColor(BUILTIN_QUOTA_WARNING)
  const quotaTrack = declared.quotaTrack ?? withAlpha(declared.text, 0.18)
  return {
    background: declared.background,
    text: declared.text,
    textMuted: declared.textMuted ?? mixColor(declared.text, opaqueBackground, 0.25),
    border: declared.border ?? withAlpha(declared.text, 0.18),
    quotaTrack,
    quotaFill: declared.quotaFill ?? withAlpha(modeColors.accent, 1),
    quotaWarn: declared.quotaWarn ?? deriveQuotaWarn(warning.ok ? warning.color : PANEL_THEME_WHITE, declared, quotaTrack),
  }
}

// 都不符合時取最後一級（此時主題會被拒絕）。
function deriveQuotaWarn(amber: PanelThemeRgba, declared: { background: PanelThemeRgba; text: PanelThemeRgba }, track: PanelThemeRgba): PanelThemeRgba {
  const pill = petStatusBackdrops(declared.background)
  const backdrops = [...pill, ...pill.map(backdrop => ({ name: backdrop.name, color: compositeColor(track, backdrop.color) }))]
  let candidate = amber
  for (let step = 0; step <= 6; step += 1) {
    candidate = mixColor(amber, declared.text, step / 10)
    if (backdrops.every(backdrop => contrastRatio(candidate, backdrop.color) >= 3)) return candidate
  }
  return candidate
}

function petStatusBackdrops(background: PanelThemeRgba): Backdrop[] {
  return [PANEL_THEME_BLACK, PANEL_THEME_WHITE].map((desktop, index) => ({
    name: `pill over a ${index === 0 ? 'black' : 'white'} desktop`,
    color: compositeColor(background, desktop),
  }))
}

function parsePetStatus(value: unknown, modeColors: ColorSet, path: string) {
  if (!isRecord(value)) fail(path, 'must be an object')
  assertKeys(value, PET_STATUS_KEYS, path)
  const declared: Partial<Record<PetStatusColorKey, PanelThemeRgba>> = {}
  for (const token of PET_STATUS_TOKENS) {
    if (value[token.key] === undefined) {
      if (token.required) fail(`${path}.${token.key}`, 'is required')
      continue
    }
    declared[token.key] = colorAt(value[token.key], `${path}.${token.key}`)
  }
  const resolved = derivePetStatusColors(declared as Parameters<typeof derivePetStatusColors>[0], modeColors)
  const contribution: Partial<Record<PetStatusColorKey, string>> = {}
  for (const [key, color] of Object.entries(declared)) contribution[key as PetStatusColorKey] = formatPanelThemeColor(color)
  return { resolved, contribution }
}

function contributionBackground(background: ResolvedPanelThemeBackground): PluginPanelThemeBackground {
  if (background.type === 'solid') return { type: 'solid' }
  if (background.type === 'image') {
    return { ...background, overlay: { color: formatPanelThemeColor(background.overlay.color), opacity: background.overlay.opacity } }
  }
  const stops = background.stops.map(stop => ({ color: formatPanelThemeColor(stop.color), at: stop.at }))
  return background.kind === 'linear'
    ? { type: 'gradient', kind: 'linear', angle: background.angle, stops }
    : { type: 'gradient', kind: 'radial', position: background.position, stops }
}

function parseTheme(value: unknown, index: number): { contribution: PluginPanelThemeContribution; resolved: ResolvedPanelTheme } {
  const indexPath = `panelThemes[${index}]`
  if (!isRecord(value)) fail(indexPath, 'must be an object')
  if (typeof value.id !== 'string' || !THEME_ID.test(value.id)) fail(`${indexPath}.id`, 'must match ^[a-z0-9-]{1,32}$')
  const path = value.id
  assertKeys(value, ['id', 'displayName', 'description', 'fonts', 'typography', 'shape', 'modes'], path)
  const displayName = parseLocalized(value.displayName, 48, `${path}.displayName`)
  const description = value.description === undefined ? undefined : parseLocalized(value.description, 120, `${path}.description`)
  const fonts = parseFonts(value.fonts, `${path}.fonts`)
  const typography = parseTypography(value.typography, new Set(fonts.map(face => face.id)), `${path}.typography`)
  const shape = parseShape(value.shape, `${path}.shape`)
  if (!isRecord(value.modes)) fail(`${path}.modes`, 'needs light and/or dark')
  assertKeys(value.modes, MODES, `${path}.modes`)
  const contributionModes: PluginPanelThemeContribution['modes'] = {}
  const resolvedModes: ResolvedPanelTheme['modes'] = {}
  for (const mode of MODES) {
    if (value.modes[mode] === undefined) continue
    const parsed = parseMode(value.modes[mode], mode, `${path}.${mode}`)
    contributionModes[mode] = parsed.contribution
    resolvedModes[mode] = parsed.resolved
  }
  if (!resolvedModes.light && !resolvedModes.dark) fail(`${path}.modes`, 'needs light and/or dark')
  return {
    contribution: {
      id: value.id,
      displayName,
      ...(description ? { description } : {}),
      fonts,
      typography: typography.contribution,
      shape,
      modes: contributionModes,
    },
    resolved: {
      id: value.id,
      displayName,
      ...(description ? { description } : {}),
      fonts,
      typography: { body: typography.body, heading: typography.heading, scale: typography.scale },
      shape,
      modes: resolvedModes,
    },
  }
}

export function parsePanelThemes(value: unknown): PanelThemeParseResult {
  if (!Array.isArray(value) || value.length < 1 || value.length > PANEL_THEME_MAX_THEMES) {
    fail('panelThemes', `must be an array of 1-${PANEL_THEME_MAX_THEMES} themes`)
  }
  const contributions: PluginPanelThemeContribution[] = []
  const themes: ResolvedPanelTheme[] = []
  const ids = new Set<string>()
  const fontFiles = new Set<string>()
  const imageFiles = new Set<string>()
  value.forEach((raw, index) => {
    const parsed = parseTheme(raw, index)
    if (ids.has(parsed.resolved.id)) fail(parsed.resolved.id, 'duplicate theme id')
    ids.add(parsed.resolved.id)
    for (const face of parsed.resolved.fonts) fontFiles.add(face.src)
    for (const mode of Object.values(parsed.resolved.modes)) {
      if (mode?.background.type === 'image') imageFiles.add(mode.background.src)
    }
    contributions.push(parsed.contribution)
    themes.push(parsed.resolved)
  })
  if (fontFiles.size > PANEL_THEME_MAX_FONT_FILES) fail('panelThemes', `at most ${PANEL_THEME_MAX_FONT_FILES} distinct font files per plugin`)
  if (imageFiles.size > PANEL_THEME_MAX_IMAGE_FILES) fail('panelThemes', `at most ${PANEL_THEME_MAX_IMAGE_FILES} distinct images per plugin`)
  return { contributions, themes }
}

export function resolvePanelThemes(value: unknown): ResolvedPanelTheme[] | null {
  try {
    return parsePanelThemes(value).themes
  } catch {
    return null
  }
}

export interface PanelThemeAssetPaths {
  images: Set<string>
  fonts: Set<string>
}

export function panelThemeAssetPaths(themes: readonly Pick<PluginPanelThemeContribution, 'fonts' | 'modes'>[] | undefined): PanelThemeAssetPaths {
  const images = new Set<string>()
  const fonts = new Set<string>()
  for (const theme of themes ?? []) {
    for (const face of theme.fonts) fonts.add(face.src)
    for (const mode of Object.values(theme.modes)) {
      if (mode?.background.type === 'image') images.add(mode.background.src)
    }
  }
  return { images, fonts }
}

export function isWoff2(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x77 && bytes[1] === 0x4f && bytes[2] === 0x46 && bytes[3] === 0x32
}

export type PanelThemeImageKind = RasterImageType

export type PanelThemeImageCheck =
  | { ok: true; type: PanelThemeImageKind; width: number; height: number }
  | { ok: false; error: 'image_invalid' | 'image_too_large' | 'image_animated' }

interface ImageRules {
  maxBytes: number
  maxSide: number
  maxPixels: number
  types: ReadonlySet<PanelThemeImageKind>
  requireUpright: boolean
}

const PACKAGED_IMAGE_RULES: ImageRules = {
  maxBytes: PANEL_THEME_IMAGE_MAX_BYTES,
  maxSide: PANEL_THEME_IMAGE_MAX_SIDE,
  maxPixels: PANEL_THEME_IMAGE_MAX_PIXELS,
  types: new Set(['image/png', 'image/webp']),
  requireUpright: true,
}

const USER_IMAGE_RULES: ImageRules = {
  maxBytes: PANEL_THEME_USER_IMAGE_MAX_BYTES,
  maxSide: PANEL_THEME_USER_IMAGE_MAX_SIDE,
  maxPixels: PANEL_THEME_USER_IMAGE_MAX_PIXELS,
  types: new Set(['image/png', 'image/jpeg', 'image/webp']),
  requireUpright: false,
}

// 只檢查檔頭；不做任何解碼。
function checkImage(bytes: Uint8Array, rules: ImageRules): PanelThemeImageCheck {
  if (bytes.byteLength > rules.maxBytes) return { ok: false, error: 'image_too_large' }
  const type = rasterImageTypeIn(bytes, rules.types)
  if (!type) return { ok: false, error: 'image_invalid' }
  const size = readImageSize(bytes)
  if (!size || !Number.isSafeInteger(size.width) || !Number.isSafeInteger(size.height)) return { ok: false, error: 'image_invalid' }
  if (size.width < PANEL_THEME_IMAGE_MIN_SIDE || size.height < PANEL_THEME_IMAGE_MIN_SIDE) return { ok: false, error: 'image_invalid' }
  if (size.width > rules.maxSide || size.height > rules.maxSide || size.width * size.height > rules.maxPixels) {
    return { ok: false, error: 'image_too_large' }
  }
  if (readImageAnimated(bytes)) return { ok: false, error: 'image_animated' }
  if (rules.requireUpright && readImageOrientation(bytes) !== 1) return { ok: false, error: 'image_invalid' }
  return { ok: true, type, width: size.width, height: size.height }
}

export function checkPanelThemePackagedImage(bytes: Uint8Array): PanelThemeImageCheck {
  return checkImage(bytes, PACKAGED_IMAGE_RULES)
}

export function checkPanelThemeUserImage(bytes: Uint8Array): PanelThemeImageCheck {
  return checkImage(bytes, USER_IMAGE_RULES)
}

export interface PanelThemeSourcePlugin {
  pluginId: string
  version: string
  pluginName: PluginLocalizedText
  available: boolean
  unavailableReason?: Exclude<PanelThemeUnavailableReason, 'theme_removed'>
  themes: readonly ResolvedPanelTheme[]
}

export interface PanelThemeAssetResolver {
  packagedUrl(kind: 'image' | 'font', pluginId: string, version: string, relativePath: string): string
  fontAlias(pluginId: string, version: string, themeId: string, fontId: string): string
  userImageUrl(pluginId: string, file: string): string | null
}

function familyValue(entries: readonly PanelThemeFamilyEntry[] | null, fallback: string, alias: (fontId: string) => string): string {
  if (!entries) return fallback
  return entries.map(entry => {
    if (entry.kind === 'generic') return entry.name
    if (entry.kind === 'font') return `"${alias(entry.id)}"`
    return `"${entry.name}"`
  }).join(', ')
}

export function panelThemeSharedProperties(theme: ResolvedPanelTheme, alias: (fontId: string) => string): Partial<Record<PanelThemeSharedProperty, string>> {
  const properties: Partial<Record<PanelThemeSharedProperty, string>> = {
    '--organic-font-body': familyValue(theme.typography.body, DEFAULT_BODY_FAMILY, alias),
    '--organic-font-heading': familyValue(theme.typography.heading, DEFAULT_HEADING_FAMILY, alias),
  }
  for (const [property, base] of BASE_FONT_SIZES) {
    properties[property] = `${Math.max(FONT_FLOOR_PX, Math.round(base * theme.typography.scale))}px`
  }
  properties['--organic-radius-sm'] = `${theme.shape.radiusSm}px`
  properties['--organic-radius-md'] = `${theme.shape.radiusMd}px`
  properties['--organic-radius-lg'] = `${theme.shape.radiusLg}px`
  return properties
}

export function petStatusProperties(colors: Record<PetStatusColorKey, PanelThemeRgba>): Record<PetStatusProperty, string> {
  const properties = {} as Record<PetStatusProperty, string>
  for (const token of PET_STATUS_TOKENS) properties[token.property] = formatPanelThemeColor(colors[token.key])
  // 不透明副本，供降低透明度／增加對比的備援使用。
  properties['--pet-status-background-opaque'] = formatPanelThemeColor(withAlpha(colors.background, 1))
  return properties
}

function colorProperties(colors: ColorSet): Record<PanelThemeColorProperty, string> {
  const properties = {} as Record<PanelThemeColorProperty, string>
  for (const token of PANEL_THEME_COLOR_TOKENS) properties[token.property] = formatPanelThemeColor(colors[token.key])
  return properties
}

function backgroundState(background: ResolvedPanelThemeBackground, imageUrl: (src: string) => string): PanelThemeBackgroundState {
  if (background.type === 'solid') return { type: 'solid' }
  if (background.type === 'image') {
    return {
      type: 'image',
      url: imageUrl(background.src),
      fit: background.fit,
      position: background.position,
      opacity: background.opacity,
      blur: background.blur,
      overlay: { color: formatPanelThemeColor(background.overlay.color), opacity: background.overlay.opacity },
    }
  }
  const stops = background.stops.map(stop => ({ color: formatPanelThemeColor(stop.color), at: stop.at }))
  return background.kind === 'linear'
    ? { type: 'gradient', kind: 'linear', angle: background.angle, stops }
    : { type: 'gradient', kind: 'radial', position: background.position, stops }
}

function catalogEntry(source: PanelThemeSourcePlugin, theme: ResolvedPanelTheme, store: PanelThemeStoreData, resolver: PanelThemeAssetResolver): PanelThemeCatalogEntry {
  const alias = (fontId: string) => resolver.fontAlias(source.pluginId, source.version, theme.id, fontId)
  const modes: PanelThemeCatalogEntry['modes'] = {}
  for (const mode of MODES) {
    const resolved = theme.modes[mode]
    if (!resolved) continue
    const state: PanelThemeModeState = {
      properties: colorProperties(resolved.colors),
      ...(resolved.petStatus ? { petStatus: petStatusProperties(resolved.petStatus) } : {}),
      background: backgroundState(resolved.background, src => resolver.packagedUrl('image', source.pluginId, source.version, src)),
    }
    if (resolved.userImage) {
      const stored = store.userImages[source.pluginId]?.[theme.id]?.[mode]
      const url = stored ? resolver.userImageUrl(source.pluginId, stored.file) : null
      state.userImage = {
        minDim: resolved.userImage.minDim,
        defaultDim: resolved.userImage.defaultDim,
        fit: resolved.userImage.fit,
        overlayColor: formatPanelThemeColor(resolved.userImage.overlayColor),
        ...(stored && url ? {
          current: {
            url,
            fit: stored.fit,
            position: stored.position,
            dim: stored.dim >= resolved.userImage.minDim ? stored.dim : resolved.userImage.defaultDim,
            blur: stored.blur,
            width: stored.width,
            height: stored.height,
          },
        } : {}),
      }
    }
    modes[mode] = state
  }
  return {
    ref: { pluginId: source.pluginId, themeId: theme.id },
    pluginName: { ...source.pluginName },
    displayName: { ...theme.displayName },
    ...(theme.description ? { description: { ...theme.description } } : {}),
    shared: {
      properties: panelThemeSharedProperties(theme, alias),
      fonts: theme.fonts.map(face => ({
        alias: alias(face.id),
        url: resolver.packagedUrl('font', source.pluginId, source.version, face.src),
        weight: face.weight,
        style: face.style,
      })),
    },
    modes,
  }
}

function slotState(ref: PanelThemeRef | null, mode: PanelThemeMode, sources: ReadonlyMap<string, PanelThemeSourcePlugin>): PanelThemeSlotState {
  if (!ref) return { ref: null, status: 'builtin' }
  const source = sources.get(ref.pluginId)
  const theme = source?.themes.find(candidate => candidate.id === ref.themeId)
  if (!source || !theme || !theme.modes[mode]) return { ref: { ...ref }, status: 'unavailable', reason: 'theme_removed' }
  if (!source.available) return { ref: { ...ref }, status: 'unavailable', reason: source.unavailableReason ?? 'plugin_disabled' }
  return { ref: { ...ref }, status: 'active' }
}

export function builtinPanelThemeColors(mode: PanelThemeMode): Record<PluginPanelThemeColorKey, PanelThemeRgba> {
  const colors = {} as Record<PluginPanelThemeColorKey, PanelThemeRgba>
  for (const token of PANEL_THEME_COLOR_TOKENS) colors[token.key] = builtinColor(token, mode)
  return colors
}

export function builtinPanelThemeProperties(mode: PanelThemeMode): Record<PanelThemeColorProperty, string> {
  const properties = {} as Record<PanelThemeColorProperty, string>
  for (const token of PANEL_THEME_COLOR_TOKENS) properties[token.property] = formatPanelThemeColor(builtinColor(token, mode))
  return properties
}

const BUILTIN_PROPERTIES = { light: builtinPanelThemeProperties('light'), dark: builtinPanelThemeProperties('dark') }

export function buildPanelThemeState(
  sources: readonly PanelThemeSourcePlugin[],
  store: PanelThemeStoreData,
  resolver: PanelThemeAssetResolver,
): PanelThemeState {
  const byId = new Map(sources.map(source => [source.pluginId, source] as const))
  const themes: PanelThemeCatalogEntry[] = []
  for (const source of sources) {
    if (!source.available) continue
    for (const theme of source.themes) themes.push(catalogEntry(source, theme, store, resolver))
  }
  return {
    slots: {
      light: slotState(store.slots.light, 'light', byId),
      dark: slotState(store.slots.dark, 'dark', byId),
    },
    themes,
    builtin: { light: { ...BUILTIN_PROPERTIES.light }, dark: { ...BUILTIN_PROPERTIES.dark } },
  }
}

export function emptyPanelThemeState(): PanelThemeState {
  return {
    slots: { light: { ref: null, status: 'builtin' }, dark: { ref: null, status: 'builtin' } },
    themes: [],
    builtin: { light: { ...BUILTIN_PROPERTIES.light }, dark: { ...BUILTIN_PROPERTIES.dark } },
  }
}

export function panelThemeAllowsUserImage(sources: readonly PanelThemeSourcePlugin[], ref: PanelThemeRef, mode: PanelThemeMode): boolean {
  const theme = sources.find(source => source.pluginId === ref.pluginId)?.themes.find(candidate => candidate.id === ref.themeId)
  return Boolean(theme?.modes[mode]?.userImage)
}

export function panelThemeUserImageMinimum(sources: readonly PanelThemeSourcePlugin[], ref: PanelThemeRef, mode: PanelThemeMode): number | null {
  const theme = sources.find(source => source.pluginId === ref.pluginId)?.themes.find(candidate => candidate.id === ref.themeId)
  return theme?.modes[mode]?.userImage?.minDim ?? null
}
