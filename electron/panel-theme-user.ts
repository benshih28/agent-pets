// 「我的主題」的定義文法（spec R20）。純函式：不 import Electron 或 Node。
//
// 使用者主題不是 CSS，也不是插件 manifest：它是一份封閉的結構（31 個顏色鍵、可選的寵物膠囊、
// 純色或漸層背景、可選的使用者背景圖設定、系統字型組合 id、圓角），每個值都在這裡逐一檢查並
// 重新輸出成主機標準格式。存檔、套用與匯入前都會再轉成 panelThemes 宣告，交給與插件主題相同的
// 驗證器（parsePanelThemes），所以使用者主題不可能繞過任何對比或語意規則。

import { formatPanelThemeColor, parsePanelThemeColor } from './panel-theme-color.ts'
import { normalizePanelThemePlainText } from './plugin-panel-themes.ts'
import {
  PANEL_THEME_FITS,
  PANEL_THEME_MODES,
  PANEL_THEME_POSITIONS,
  type PanelThemeFit,
  type PanelThemeGradientStop,
  type PanelThemeMode,
  type PanelThemePosition,
} from '../src/types/panel-theme.ts'
import {
  USER_PANEL_THEME_COLOR_KEYS,
  USER_PANEL_THEME_EXPORT_FORMAT,
  USER_PANEL_THEME_FONT_STACK_IDS,
  USER_PANEL_THEME_FONT_STACKS,
  USER_PANEL_THEME_NAME_MAX,
  USER_PANEL_THEME_PET_STATUS_KEYS,
  USER_PANEL_THEME_SCHEMA_VERSION,
  isUserPanelThemeId,
  type UserPanelThemeBackground,
  type UserPanelThemeDefinition,
  type UserPanelThemeExport,
  type UserPanelThemeFontStackId,
  type UserPanelThemeImageSettings,
  type UserPanelThemeModeDefinition,
  type UserPanelThemePetStatusKey,
  type UserPanelThemeRecord,
} from '../src/types/panel-theme-user.ts'
import type { PluginPanelThemeColorKey } from '../src/types/plugin.ts'
import { isRecord } from './value-guards.ts'

export type UserThemeParseResult<T> = { ok: true; value: T } | { ok: false; path: string; problem: string }

class UserThemeSchemaError extends Error {
  readonly path: string
  readonly problem: string

  constructor(path: string, problem: string) {
    super(`${path}: ${problem}`)
    this.path = path
    this.problem = problem
  }
}

function fail(path: string, problem: string): never {
  throw new UserThemeSchemaError(path, problem)
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${path}.${key}`, 'unknown key')
  for (const key of keys) if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, 'is required')
}

function recordAt(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) fail(path, 'must be an object')
  return value
}

/** 任何 manifest 顏色文法都接受，一律重新輸出成 `rgb(R G B / A)`。 */
function colorAt(value: unknown, path: string, opaque = false): string {
  const parsed = parsePanelThemeColor(value)
  if (!parsed.ok) fail(path, 'not an allowed colour')
  if (opaque && parsed.color.a !== 1) fail(path, 'must be opaque')
  return formatPanelThemeColor(parsed.color)
}

function integerAt(value: unknown, min: number, max: number, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) fail(path, `must be an integer ${min}-${max}`)
  return value
}

/** 最多兩位小數、落在範圍內的數字（與 manifest 的 scale、dim 規則相同）。 */
function decimalAt(value: unknown, min: number, max: number, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || !/^\d+(?:\.\d{1,2})?$/.test(String(value))) {
    fail(path, `must be a number ${min}-${max} with at most 2 decimals`)
  }
  return value
}

function enumAt<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) fail(path, 'is not an allowed value')
  return value as T
}

function parseStops(value: unknown, path: string): PanelThemeGradientStop[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 5) fail(path, 'needs 2-5 stops')
  let previous = 0
  return value.map((raw, index) => {
    const stopPath = `${path}[${index}]`
    const stop = recordAt(raw, stopPath)
    exactKeys(stop, ['color', 'at'], stopPath)
    const at = integerAt(stop.at, 0, 100, `${stopPath}.at`)
    if (at < previous) fail(`${stopPath}.at`, 'stops must not decrease')
    previous = at
    return { color: colorAt(stop.color, `${stopPath}.color`, true), at }
  })
}

function parseBackground(value: unknown, path: string): UserPanelThemeBackground {
  const background = recordAt(value, path)
  if (background.type === 'solid') {
    exactKeys(background, ['type'], path)
    return { type: 'solid' }
  }
  if (background.type === 'gradient' && background.kind === 'linear') {
    exactKeys(background, ['type', 'kind', 'angle', 'stops'], path)
    return { type: 'gradient', kind: 'linear', angle: integerAt(background.angle, 0, 359, `${path}.angle`), stops: parseStops(background.stops, `${path}.stops`) }
  }
  if (background.type === 'gradient' && background.kind === 'radial') {
    exactKeys(background, ['type', 'kind', 'position', 'stops'], path)
    return {
      type: 'gradient',
      kind: 'radial',
      position: enumAt<PanelThemePosition>(background.position, PANEL_THEME_POSITIONS, `${path}.position`),
      stops: parseStops(background.stops, `${path}.stops`),
    }
  }
  fail(`${path}.type`, 'must be solid or a linear/radial gradient')
}

function parseImage(value: unknown, path: string): UserPanelThemeImageSettings | null {
  if (value === null) return null
  const image = recordAt(value, path)
  exactKeys(image, ['fit', 'overlayColor', 'dim'], path)
  return {
    fit: enumAt<PanelThemeFit>(image.fit, PANEL_THEME_FITS, `${path}.fit`),
    overlayColor: colorAt(image.overlayColor, `${path}.overlayColor`, true),
    dim: decimalAt(image.dim, 0.5, 0.95, `${path}.dim`),
  }
}

function parsePetStatus(value: unknown, path: string): Record<UserPanelThemePetStatusKey, string> | null {
  if (value === null) return null
  const status = recordAt(value, path)
  exactKeys(status, USER_PANEL_THEME_PET_STATUS_KEYS, path)
  const result = {} as Record<UserPanelThemePetStatusKey, string>
  for (const key of USER_PANEL_THEME_PET_STATUS_KEYS) result[key] = colorAt(status[key], `${path}.${key}`)
  return result
}

function parseMode(value: unknown, path: string): UserPanelThemeModeDefinition {
  const mode = recordAt(value, path)
  exactKeys(mode, ['colors', 'background', 'image', 'petStatus'], path)
  const rawColors = recordAt(mode.colors, `${path}.colors`)
  exactKeys(rawColors, USER_PANEL_THEME_COLOR_KEYS, `${path}.colors`)
  const colors = {} as Record<PluginPanelThemeColorKey, string>
  for (const key of USER_PANEL_THEME_COLOR_KEYS) colors[key] = colorAt(rawColors[key], `${path}.colors.${key}`)
  return {
    colors,
    background: parseBackground(mode.background, `${path}.background`),
    image: parseImage(mode.image, `${path}.image`),
    petStatus: parsePetStatus(mode.petStatus, `${path}.petStatus`),
  }
}

function parseDefinitionStrict(value: unknown): UserPanelThemeDefinition {
  const definition = recordAt(value, 'definition')
  exactKeys(definition, ['typography', 'shape', 'modes'], 'definition')
  const typography = recordAt(definition.typography, 'typography')
  exactKeys(typography, ['body', 'heading', 'scale'], 'typography')
  const shape = recordAt(definition.shape, 'shape')
  exactKeys(shape, ['radiusSm', 'radiusMd', 'radiusLg'], 'shape')
  const radiusSm = integerAt(shape.radiusSm, 0, 16, 'shape.radiusSm')
  const radiusMd = integerAt(shape.radiusMd, 0, 24, 'shape.radiusMd')
  const radiusLg = integerAt(shape.radiusLg, 0, 32, 'shape.radiusLg')
  if (radiusSm > radiusMd || radiusMd > radiusLg) fail('shape', 'radii must satisfy radiusSm <= radiusMd <= radiusLg')
  const modes = recordAt(definition.modes, 'modes')
  exactKeys(modes, PANEL_THEME_MODES, 'modes')
  return {
    typography: {
      body: enumAt<UserPanelThemeFontStackId>(typography.body, USER_PANEL_THEME_FONT_STACK_IDS, 'typography.body'),
      heading: enumAt<UserPanelThemeFontStackId>(typography.heading, USER_PANEL_THEME_FONT_STACK_IDS, 'typography.heading'),
      scale: decimalAt(typography.scale, 0.92, 1.15, 'typography.scale'),
    },
    shape: { radiusSm, radiusMd, radiusLg },
    modes: { light: parseMode(modes.light, 'light'), dark: parseMode(modes.dark, 'dark') },
  }
}

function attempt<T>(parse: () => T): UserThemeParseResult<T> {
  try {
    return { ok: true, value: parse() }
  } catch (error) {
    if (error instanceof UserThemeSchemaError) return { ok: false, path: error.path, problem: error.problem }
    throw error
  }
}

/** 嚴格解析一份定義：多出或缺少的鍵、文法錯誤都拒絕；顏色重新輸出成標準格式。 */
export function parseUserPanelThemeDefinition(value: unknown): UserThemeParseResult<UserPanelThemeDefinition> {
  return attempt(() => parseDefinitionStrict(value))
}

/**
 * 正規化之前的名稱長度上限（UTF-16 單位）。NFKC 與空白收合只會讓合理的名稱變短或稍長，
 * 先擋下過長的輸入，不讓任意大的字串進到正規化。
 */
export const USER_PANEL_THEME_NAME_INPUT_MAX = USER_PANEL_THEME_NAME_MAX * 4

/** 主題名稱：與 manifest 顯示名稱相同的清理（NFKC、去除控制字元與角括號），1–48 字元。 */
export function parseUserPanelThemeName(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > USER_PANEL_THEME_NAME_INPUT_MAX) return null
  return normalizePanelThemePlainText(value, USER_PANEL_THEME_NAME_MAX)
}

function modeContribution(mode: UserPanelThemeModeDefinition): Record<string, unknown> {
  return {
    colors: { ...mode.colors },
    background: structuredClone(mode.background),
    ...(mode.image ? { userImage: { allowed: true, fit: mode.image.fit, overlay: { color: mode.image.overlayColor, opacity: mode.image.dim } } } : {}),
    ...(mode.petStatus ? { petStatus: { ...mode.petStatus } } : {}),
  }
}

function familyList(id: UserPanelThemeFontStackId): string[] | undefined {
  const stack = USER_PANEL_THEME_FONT_STACKS[id]
  return stack ? [...stack] : undefined
}

/** 轉成一筆 panelThemes 宣告，交給插件主題的驗證器（顯示名稱兩種語系相同）。 */
export function userPanelThemeContribution(id: string, name: string, definition: UserPanelThemeDefinition): Record<string, unknown> {
  const body = familyList(definition.typography.body)
  const heading = familyList(definition.typography.heading)
  return {
    id,
    displayName: { 'zh-TW': name, 'en-US': name },
    typography: { ...(body ? { body } : {}), ...(heading ? { heading } : {}), scale: definition.typography.scale },
    shape: { ...definition.shape },
    modes: Object.fromEntries(PANEL_THEME_MODES.map(mode => [mode, modeContribution(definition.modes[mode])])) as Record<PanelThemeMode, unknown>,
  }
}

/**
 * 由較新版本寫入的記錄（降級後才會遇到）：看不懂它的內容，但它不是損毀，
 * 絕不能改名備份或修剪——升級回去之後要原封不動地還在。
 */
export function isFutureUserPanelThemeRecord(value: unknown): boolean {
  return isRecord(value) && typeof value.schemaVersion === 'number' && Number.isSafeInteger(value.schemaVersion) && value.schemaVersion > USER_PANEL_THEME_SCHEMA_VERSION
}

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/** 解析磁碟上的一筆記錄；任何欄位不符（包括 id 與檔名不一致）都回傳 null。 */
export function parseUserPanelThemeRecord(value: unknown, expectedId: string): UserPanelThemeRecord | null {
  if (!isRecord(value)) return null
  const keys = Object.keys(value)
  if (keys.length !== 6 || value.schemaVersion !== USER_PANEL_THEME_SCHEMA_VERSION || value.id !== expectedId || !isUserPanelThemeId(value.id)) return null
  if (typeof value.createdAt !== 'string' || !ISO_8601.test(value.createdAt) || typeof value.updatedAt !== 'string' || !ISO_8601.test(value.updatedAt)) return null
  const name = parseUserPanelThemeName(value.name)
  if (!name || name !== value.name) return null
  const definition = parseUserPanelThemeDefinition(value.definition)
  if (!definition.ok) return null
  return { schemaVersion: USER_PANEL_THEME_SCHEMA_VERSION, id: value.id, name, createdAt: value.createdAt, updatedAt: value.updatedAt, definition: definition.value }
}

export function userPanelThemeExport(record: Pick<UserPanelThemeRecord, 'name' | 'definition'>): UserPanelThemeExport {
  return { format: USER_PANEL_THEME_EXPORT_FORMAT, schemaVersion: USER_PANEL_THEME_SCHEMA_VERSION, name: record.name, definition: structuredClone(record.definition) }
}

/** 匯入檔：只接受 format／schemaVersion／name／definition 四個鍵（沒有 id、時間、圖片或路徑）。 */
export function parseUserPanelThemeExport(value: unknown): UserThemeParseResult<{ name: string; definition: UserPanelThemeDefinition }> {
  return attempt(() => {
    const file = recordAt(value, 'file')
    exactKeys(file, ['format', 'schemaVersion', 'name', 'definition'], 'file')
    if (file.format !== USER_PANEL_THEME_EXPORT_FORMAT) fail('file.format', `must be "${USER_PANEL_THEME_EXPORT_FORMAT}"`)
    if (file.schemaVersion !== USER_PANEL_THEME_SCHEMA_VERSION) fail('file.schemaVersion', `must be ${USER_PANEL_THEME_SCHEMA_VERSION}`)
    const name = parseUserPanelThemeName(file.name)
    if (!name) fail('file.name', `needs 1-${USER_PANEL_THEME_NAME_MAX} characters`)
    return { name, definition: parseDefinitionStrict(file.definition) }
  })
}
