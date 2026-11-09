import {
  formatPanelThemeColor,
  oklchToRgb,
  panelThemeSharedProperties,
  parsePanelThemeColor,
  petStatusProperties,
  rgbToOklch,
  type PanelThemeRgba,
  type ResolvedPanelTheme,
} from './panel-theme-host.ts'
import {
  PANEL_THEME_COLOR_KEY_PROPERTIES,
  PANEL_THEME_MODES,
  type PanelThemeBackgroundState,
  type PanelThemeCatalogEntry,
  type PanelThemeColorProperty,
  type PanelThemeMode,
  type PanelThemeModeState,
  type PanelThemeState,
} from '../types/panel-theme.ts'
import {
  USER_PANEL_THEME_COLOR_KEYS,
  USER_PANEL_THEME_FONT_STACKS,
  USER_PANEL_THEME_OWNER,
  USER_PANEL_THEME_PET_STATUS_KEYS,
  type PanelThemeDiagnostic,
  type PanelThemeValidation,
  type UserPanelThemeDefinition,
  type UserPanelThemeFontStackId,
  type UserPanelThemeModeDefinition,
  type UserPanelThemePetStatusKey,
} from '../types/panel-theme-user.ts'
import type { PluginPanelThemeColorKey } from '../types/plugin.ts'

// 主題編輯器的純邏輯（spec R24）：起點、草稿與復原、未儲存判斷、存檔閘門、建議值套用、
// 顏色輸入解析與 OKLCH 微調，以及把草稿畫成預覽用的目錄項目。元件只負責呈現與事件。

export const EDITOR_UNDO_LIMIT = 50
export const DEFAULT_SHAPE = { radiusSm: 8, radiusMd: 16, radiusLg: 28 } as const

const GENERIC_FAMILIES = new Set(['serif', 'sans-serif', 'monospace', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-rounded', 'ui-monospace'])
const PET_PROPERTY_TO_KEY: Record<string, UserPanelThemePetStatusKey> = {
  '--pet-status-background': 'background',
  '--pet-status-text': 'text',
  '--pet-status-text-muted': 'textMuted',
  '--pet-status-border': 'border',
  '--pet-status-quota-fill': 'quotaFill',
  '--pet-status-quota-track': 'quotaTrack',
  '--pet-status-quota-warn': 'quotaWarn',
}

// ── 起點 ─────────────────────────────────────────────────────────────

function colorsFromProperties(properties: Record<PanelThemeColorProperty, string>): Record<PluginPanelThemeColorKey, string> {
  const colors = {} as Record<PluginPanelThemeColorKey, string>
  for (const key of USER_PANEL_THEME_COLOR_KEYS) colors[key] = properties[PANEL_THEME_COLOR_KEY_PROPERTIES[key]]
  return colors
}

function backgroundFrom(background: PanelThemeBackgroundState | undefined): UserPanelThemeModeDefinition['background'] {
  // 插件套件內的圖片不能複製（使用者主題不帶圖片位元組）：改用純色，使用者可另外匯入自己的圖。
  if (!background || background.type !== 'gradient') return { type: 'solid' }
  return structuredClone(background)
}

function modeFrom(mode: PanelThemeModeState | undefined, builtin: Record<PanelThemeColorProperty, string>): UserPanelThemeModeDefinition {
  const petStatus = mode?.petStatus
    ? Object.fromEntries(Object.entries(mode.petStatus).filter(([name]) => PET_PROPERTY_TO_KEY[name]).map(([name, value]) => [PET_PROPERTY_TO_KEY[name]!, value])) as Record<UserPanelThemePetStatusKey, string>
    : null
  return {
    colors: colorsFromProperties(mode?.properties ?? builtin),
    background: backgroundFrom(mode?.background),
    image: mode?.userImage ? { fit: mode.userImage.fit, overlayColor: mode.userImage.overlayColor, dim: mode.userImage.defaultDim } : null,
    petStatus: petStatus && USER_PANEL_THEME_PET_STATUS_KEYS.every(key => petStatus[key]) ? petStatus : null,
  }
}

/** 主機輸出的 `Npx` 半徑轉回整數；不符時用預設值。 */
function radius(value: string | undefined, fallback: number): number {
  const match = value ? /^(\d{1,2})px$/.exec(value) : null
  return match ? Number(match[1]) : fallback
}

/**
 * 從內建色盤（`entry` 為 null）或任何一個目錄主題（插件主題或我的主題）建立可編輯的定義。
 * 單一模式的主題，另一個模式取內建；字型一律回到內建（插件的字型檔不能帶進使用者主題）。
 */
export function definitionFromCatalog(state: Pick<PanelThemeState, 'builtin'>, entry: PanelThemeCatalogEntry | null): UserPanelThemeDefinition {
  const shared = entry?.shared.properties ?? {}
  const shape = {
    radiusSm: radius(shared['--organic-radius-sm'], DEFAULT_SHAPE.radiusSm),
    radiusMd: radius(shared['--organic-radius-md'], DEFAULT_SHAPE.radiusMd),
    radiusLg: radius(shared['--organic-radius-lg'], DEFAULT_SHAPE.radiusLg),
  }
  return {
    typography: { body: 'builtin', heading: 'builtin', scale: 1 },
    shape,
    modes: {
      light: modeFrom(entry?.modes.light, state.builtin.light),
      dark: modeFrom(entry?.modes.dark, state.builtin.dark),
    },
  }
}

// ── 草稿、復原與閘門 ─────────────────────────────────────────────────

/** 鍵排序的 JSON：用來判斷「有沒有改過」，不受屬性順序影響。 */
export function definitionKey(definition: UserPanelThemeDefinition): string {
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>
      return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
    }
    return JSON.stringify(value) ?? 'null'
  }
  return canonical(definition)
}

export interface EditorDraft {
  /** 正在編輯的「我的主題」id；新主題為 null。 */
  id: string | null
  name: string
  definition: UserPanelThemeDefinition
  /** 上次存檔（或起點）的內容，用來判斷未儲存的變更與「重設」。 */
  baseline: { name: string; definition: UserPanelThemeDefinition }
  undo: UserPanelThemeDefinition[]
}

export function createDraft(id: string | null, name: string, definition: UserPanelThemeDefinition): EditorDraft {
  return { id, name, definition: structuredClone(definition), baseline: { name, definition: structuredClone(definition) }, undo: [] }
}

/** 套用一次變更；內容沒變時不記錄。復原堆疊有上限。 */
export function commitChange(draft: EditorDraft, next: UserPanelThemeDefinition): EditorDraft {
  if (definitionKey(next) === definitionKey(draft.definition)) return draft
  const undo = [...draft.undo, draft.definition].slice(-EDITOR_UNDO_LIMIT)
  return { ...draft, definition: next, undo }
}

export function undoChange(draft: EditorDraft): EditorDraft {
  const previous = draft.undo.at(-1)
  if (!previous) return draft
  return { ...draft, definition: previous, undo: draft.undo.slice(0, -1) }
}

/** 回到起點（或上次存檔）；這一步本身也可以復原。 */
export function resetDraft(draft: EditorDraft): EditorDraft {
  return commitChange(draft, structuredClone(draft.baseline.definition))
}

/** 名稱以去掉前後空白後比較（存檔時也是存去空白的名稱），只多打了空白不算變更。 */
function nameChanged(draft: EditorDraft): boolean {
  return draft.name.trim() !== draft.baseline.name
}

export function isDirty(draft: EditorDraft): boolean {
  return draft.id === null || nameChanged(draft) || definitionKey(draft.definition) !== definitionKey(draft.baseline.definition)
}

/**
 * 關閉時要不要提醒：已存在的主題有任何未存變更；新主題只有在使用者動過之後才算
 * （剛開啟就關掉不需要確認）。
 */
export function hasUnsavedChanges(draft: EditorDraft): boolean {
  if (draft.id !== null) return isDirty(draft)
  return nameChanged(draft) || definitionKey(draft.definition) !== definitionKey(draft.baseline.definition)
}

/**
 * 存檔完成後：基準換成「送出去的那一份」（`saved`），目前的內容與名稱維持原樣。存檔要等 IPC
 * 往返，期間使用者可能又改了顏色或名稱；那些變更沒有存到，所以必須保留並繼續算未儲存。
 * 保留復原堆疊，讓使用者仍可退回。
 */
export function markSaved(draft: EditorDraft, id: string, saved: { name: string; definition: UserPanelThemeDefinition }): EditorDraft {
  return { ...draft, id, baseline: { name: saved.name, definition: structuredClone(saved.definition) } }
}

export interface SaveGate {
  /** 驗證結果對應的是目前的草稿（debounce 中或請求中為 false）。 */
  validationCurrent: boolean
  validation: PanelThemeValidation | null
  busy: boolean
  nameValid: boolean
}

/** 存檔／套用只在「目前草稿已驗證且完全通過」時可用。 */
export function canSave(gate: SaveGate): boolean {
  return gate.validationCurrent && !gate.busy && gate.nameValid && gate.validation?.valid === true
}

// ── 問題與建議值 ─────────────────────────────────────────────────────

/** 一個模式中，每個欄位路徑的問題（依驗證器順序）。 */
export function issuesByPath(validation: PanelThemeValidation | null, mode: PanelThemeMode): Map<string, PanelThemeDiagnostic[]> {
  const result = new Map<string, PanelThemeDiagnostic[]>()
  for (const issue of validation?.issues ?? []) {
    if (issue.mode !== mode) continue
    const list = result.get(issue.path) ?? []
    list.push(issue)
    result.set(issue.path, list)
  }
  return result
}

/**
 * 一個問題可用的修正：自己的建議值優先；沒有時（例如懸停底被歸咎、其實是前景文字不夠深）
 * 改用前景鍵的建議值。回傳要改的路徑與值。
 */
export function fixFor(issue: PanelThemeDiagnostic, validation: PanelThemeValidation | null): { path: string; value: string | number } | null {
  if (issue.suggested !== undefined) return { path: issue.path, value: issue.suggested }
  if (!issue.foreground) return null
  const prefix = issue.path.startsWith('petStatus.') ? 'petStatus' : 'colors'
  const path = `${prefix}.${issue.foreground}`
  const other = validation?.issues.find(candidate => candidate.mode === issue.mode && candidate.path === path && candidate.suggested !== undefined)
  return other ? { path, value: other.suggested! } : null
}

/** 把一個修正寫進定義（回傳新物件）；路徑不認得時原樣回傳。 */
export function applyFix(definition: UserPanelThemeDefinition, mode: PanelThemeMode, path: string, value: string | number): UserPanelThemeDefinition {
  const next = structuredClone(definition)
  const target = next.modes[mode]
  const [group, key] = path.split('.') as [string, string]
  if (group === 'colors' && typeof value === 'string' && (USER_PANEL_THEME_COLOR_KEYS as readonly string[]).includes(key)) {
    target.colors[key as PluginPanelThemeColorKey] = value
  } else if (group === 'petStatus' && typeof value === 'string' && target.petStatus && (USER_PANEL_THEME_PET_STATUS_KEYS as readonly string[]).includes(key)) {
    target.petStatus[key as UserPanelThemePetStatusKey] = value
  } else if (path === 'userImage.overlay.opacity' && typeof value === 'number' && target.image) {
    target.image.dim = value
  } else {
    return definition
  }
  return next
}

// ── 顏色輸入 ─────────────────────────────────────────────────────────

/** 文字欄位：接受 manifest 的所有顏色文法（#hex、rgb()、hsl()、oklch()），回傳主機標準格式。 */
export function parseColorInput(text: string): string | null {
  const parsed = parsePanelThemeColor(text.trim())
  return parsed.ok ? formatPanelThemeColor(parsed.color) : null
}

function rgbaOf(canonical: string): PanelThemeRgba {
  const parsed = parsePanelThemeColor(canonical)
  return parsed.ok ? parsed.color : { r: 0, g: 0, b: 0, a: 1 }
}

/** `<input type="color">` 只吃 #rrggbb（不含 alpha）。 */
export function colorToHex(canonical: string): string {
  const { r, g, b } = rgbaOf(canonical)
  return `#${[r, g, b].map(value => value.toString(16).padStart(2, '0')).join('')}`
}

/** 從原生取色器的 #rrggbb 換回標準格式，保留原本的 alpha（半透明的鍵不會被取色器變成不透明）。 */
export function colorFromHex(hex: string, alphaFrom: string): string | null {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null
  const color = rgbaOf(hex)
  return formatPanelThemeColor({ ...color, a: rgbaOf(alphaFrom).a })
}

export function colorAlpha(canonical: string): number {
  return rgbaOf(canonical).a
}

export interface OklchValue { l: number; c: number; h: number }

export function colorToOklch(canonical: string): OklchValue {
  const { l, c, h } = rgbToOklch(rgbaOf(canonical))
  return { l: Math.round(l * 10000) / 10000, c: Math.round(c * 10000) / 10000, h: c < 0.002 ? 0 : Math.round(h * 10) / 10 }
}

/** OKLCH 微調：超出 sRGB 時降低色度（確定性），alpha 沿用原值。 */
export function colorFromOklch(value: OklchValue, alphaFrom: string): string {
  return formatPanelThemeColor(oklchToRgb(value.l, value.c, value.h, rgbaOf(alphaFrom).a))
}

// ── 預覽 ─────────────────────────────────────────────────────────────

function familyEntries(id: UserPanelThemeFontStackId) {
  const stack = USER_PANEL_THEME_FONT_STACKS[id]
  return stack ? stack.map(name => (GENERIC_FAMILIES.has(name) ? { kind: 'generic' as const, name } : { kind: 'local' as const, name })) : null
}

function petStatusPreview(status: Record<UserPanelThemePetStatusKey, string> | null): PanelThemeModeState['petStatus'] {
  if (!status) return undefined
  const colors = Object.fromEntries(USER_PANEL_THEME_PET_STATUS_KEYS.map(key => [key, rgbaOf(status[key])])) as Parameters<typeof petStatusProperties>[0]
  return petStatusProperties(colors)
}

/**
 * 把草稿畫成預覽用的目錄項目（與面板相同的屬性對應，所以 PanelThemePreview 與編輯器的
 * 預覽元件可以直接套用）。背景圖沿用已存檔主題目前的圖片，遮罩用草稿的值。
 */
export function previewEntry(definition: UserPanelThemeDefinition, name: string, saved: PanelThemeCatalogEntry | null): PanelThemeCatalogEntry {
  const theme = {
    typography: { body: familyEntries(definition.typography.body), heading: familyEntries(definition.typography.heading), scale: definition.typography.scale },
    shape: definition.shape,
  } as unknown as ResolvedPanelTheme
  const modes: PanelThemeCatalogEntry['modes'] = {}
  for (const mode of PANEL_THEME_MODES) {
    const source = definition.modes[mode]
    const properties = {} as Record<PanelThemeColorProperty, string>
    for (const key of USER_PANEL_THEME_COLOR_KEYS) properties[PANEL_THEME_COLOR_KEY_PROPERTIES[key]] = source.colors[key]
    const current = source.image ? saved?.modes[mode]?.userImage?.current : undefined
    const petStatus = petStatusPreview(source.petStatus)
    modes[mode] = {
      properties,
      ...(petStatus ? { petStatus } : {}),
      background: structuredClone(source.background),
      ...(source.image ? {
        userImage: {
          minDim: 0.5,
          defaultDim: source.image.dim,
          fit: source.image.fit,
          overlayColor: source.image.overlayColor,
          ...(current ? { current: { ...current, dim: Math.max(current.dim, source.image.dim) } } : {}),
        },
      } : {}),
    }
  }
  return {
    ref: { pluginId: USER_PANEL_THEME_OWNER, themeId: 'draft' },
    pluginName: { 'zh-TW': name, 'en-US': name },
    displayName: { 'zh-TW': name, 'en-US': name },
    shared: { properties: panelThemeSharedProperties(theme, () => ''), fonts: [] },
    modes,
  }
}
