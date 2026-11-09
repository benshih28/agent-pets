import assert from 'node:assert/strict'
import test from 'node:test'
import { PET_STATUS_TOKENS, buildPanelThemeState, emptyPanelThemeState, panelThemeModeIssues, resolvePanelThemes, type PanelThemeIssue } from '../electron/plugin-panel-themes.ts'
import { validateUserPanelTheme } from '../electron/panel-theme-diagnostics.ts'
import { userPanelThemeContribution } from '../electron/panel-theme-user.ts'
import {
  EDITOR_UNDO_LIMIT,
  applyFix,
  canSave,
  colorFromHex,
  colorFromOklch,
  colorToHex,
  colorToOklch,
  commitChange,
  createDraft,
  definitionFromCatalog,
  definitionKey,
  fixFor,
  hasUnsavedChanges,
  isDirty,
  issuesByPath,
  markSaved,
  parseColorInput,
  previewEntry,
  resetDraft,
  undoChange,
} from '../src/utils/panel-theme-editor.ts'
import { panelThemeTargetProperties } from '../src/utils/panel-theme-css.ts'
import { describeIssue, surfaceLabel } from '../src/utils/panel-theme-issue-text.ts'
import { PANEL_THEME_COLOR_PROPERTIES, PANEL_THEME_MODES } from '../src/types/panel-theme.ts'
import { USER_PANEL_THEME_COLOR_KEYS } from '../src/types/panel-theme-user.ts'
import { fillTemplate } from '../src/i18n.ts'
import themeEditorZhTW from '../src/locales/themeEditor/zh-TW.json' with { type: 'json' }
import themeEditorEnUS from '../src/locales/themeEditor/en-US.json' with { type: 'json' }
import { DARK_COLORS, LIGHT_COLORS, builtinDefinition, theme } from './support/panel-theme-fixtures.mts'

const resolver = {
  packagedUrl: () => 'agent-pets://panel-theme/00000000000000000000000000000000',
  fontAlias: () => 'apt-0000000000000000',
  userImageUrl: () => null,
}

test('starting from built-in gives a definition that validates clean and equals the built-in palettes', () => {
  const definition = definitionFromCatalog(emptyPanelThemeState(), null)
  assert.deepEqual(definition, builtinDefinition())
  assert.equal(validateUserPanelTheme(definition).valid, true)
})

test('starting from a plugin theme copies colours, gradient, radii and user-image settings; packaged images and fonts are dropped', () => {
  const themes = resolvePanelThemes([theme({
    shape: { radiusSm: 6, radiusMd: 12, radiusLg: 20 },
    fonts: [{ id: 'body', src: 'fonts/body.woff2' }],
    typography: { body: ['@body', 'sans-serif'] },
    modes: {
      light: { colors: LIGHT_COLORS, background: { type: 'gradient', kind: 'linear', angle: 135, stops: [{ color: '#eef6f6', at: 0 }, { color: '#f8fcfc', at: 100 }] }, userImage: { allowed: true, overlay: { color: '#eef6f6', opacity: 0.9 } } },
      dark: { colors: DARK_COLORS, petStatus: { background: 'rgb(16 32 34 / 0.92)', text: '#e8f6f6' } },
    },
  })])!
  const state = buildPanelThemeState([{ pluginId: 'theme-pack', version: '1.0.0', pluginName: { 'zh-TW': 'x', 'en-US': 'x' }, available: true, themes }], { version: 1, slots: { light: null, dark: null }, userImages: {} }, resolver)
  const definition = definitionFromCatalog(state, state.themes[0]!)
  assert.deepEqual(definition.shape, { radiusSm: 6, radiusMd: 12, radiusLg: 20 })
  assert.deepEqual(definition.typography, { body: 'builtin', heading: 'builtin', scale: 1 })
  assert.equal(definition.modes.light.background.type, 'gradient')
  assert.equal(definition.modes.light.image?.dim, 0.9)
  assert.equal(definition.modes.dark.petStatus?.text, 'rgb(232 246 246 / 1)')
  assert.equal(validateUserPanelTheme(definition).valid, true)
  // 同一份定義在主程序解析出的顏色，與插件主題的目錄完全相同。
  const mine = resolvePanelThemes([userPanelThemeContribution('u-0123456789ab', 'Copy', definition)])!
  assert.deepEqual(mine[0]!.modes.light!.colors, themes[0]!.modes.light!.colors)
})

test('a single-mode plugin theme fills the other mode from built-in', () => {
  const themes = resolvePanelThemes([theme({ modes: { dark: { colors: DARK_COLORS } } })])!
  const state = buildPanelThemeState([{ pluginId: 'theme-pack', version: '1.0.0', pluginName: { 'zh-TW': 'x', 'en-US': 'x' }, available: true, themes }], { version: 1, slots: { light: null, dark: null }, userImages: {} }, resolver)
  const definition = definitionFromCatalog(state, state.themes[0]!)
  assert.deepEqual(definition.modes.light, builtinDefinition().modes.light)
})

test('drafts track changes, undo the last steps, reset to the starting point and know when they are dirty', () => {
  let draft = createDraft('u-0123456789ab', 'Mine', builtinDefinition())
  assert.equal(isDirty(draft), false)
  const changed = structuredClone(draft.definition)
  changed.modes.light.colors.accent = 'rgb(10 120 200 / 1)'
  draft = commitChange(draft, changed)
  assert.equal(isDirty(draft), true)
  assert.equal(commitChange(draft, structuredClone(changed)), draft, 'no-op changes are not recorded')
  draft = undoChange(draft)
  assert.equal(isDirty(draft), false)
  assert.equal(undoChange(draft), draft)
  draft = commitChange(draft, changed)
  draft = resetDraft(draft)
  assert.equal(definitionKey(draft.definition), definitionKey(builtinDefinition()))
  assert.equal(undoChange(draft).definition.modes.light.colors.accent, 'rgb(10 120 200 / 1)', 'reset can be undone')
  for (let index = 0; index < EDITOR_UNDO_LIMIT + 10; index += 1) {
    const next = structuredClone(draft.definition)
    next.shape.radiusLg = 28 + (index % 4)
    draft = commitChange(draft, next)
  }
  assert.ok(draft.undo.length <= EDITOR_UNDO_LIMIT)
  // 新主題永遠算未儲存；存檔後以目前內容為新基準。
  const fresh = createDraft(null, 'New', builtinDefinition())
  assert.equal(isDirty(fresh), true)
  // 關閉提醒：剛開啟的新主題不需要確認，動過之後才需要。
  assert.equal(hasUnsavedChanges(fresh), false)
  assert.equal(hasUnsavedChanges({ ...fresh, name: 'Other' }), true)
  assert.equal(hasUnsavedChanges(commitChange(fresh, changed)), true)
  assert.equal(hasUnsavedChanges(draft), isDirty(draft))
  const saved = markSaved(fresh, 'u-ffffffffffff', { name: 'New', definition: fresh.definition })
  assert.equal(isDirty(saved), false)
  assert.equal(isDirty({ ...saved, name: 'Renamed' }), true)
  assert.equal(isDirty({ ...saved, name: '  New ' }), false, 'surrounding spaces are not a rename (the saved name is trimmed)')
})

test('saving keeps edits made while the save was in flight: only the id and baseline move', () => {
  const opened = createDraft('u-0123456789ab', 'Mine', builtinDefinition())
  // 存檔先取快照，送出 IPC；回應回來之前使用者又改了一個顏色與名稱。
  const firstEdit = structuredClone(opened.definition)
  firstEdit.modes.light.colors.accent = 'rgb(10 120 200 / 1)'
  const beforeSave = commitChange(opened, firstEdit)
  const snapshot = { name: beforeSave.name.trim(), definition: structuredClone(beforeSave.definition) }
  const secondEdit = structuredClone(beforeSave.definition)
  secondEdit.modes.dark.colors.accent = 'rgb(200 120 10 / 1)'
  const during = { ...commitChange(beforeSave, secondEdit), name: 'Mine, renamed' }

  const saved = markSaved(during, 'u-0123456789ab', snapshot)
  assert.equal(saved.definition.modes.dark.colors.accent, 'rgb(200 120 10 / 1)', 'the edit made during the round trip is kept')
  assert.equal(saved.name, 'Mine, renamed', 'a name typed during the round trip is kept')
  assert.equal(definitionKey(saved.baseline.definition), definitionKey(snapshot.definition), 'the baseline is what was actually saved')
  assert.equal(saved.baseline.name, 'Mine')
  assert.equal(isDirty(saved), true, 'the unsaved edit still counts as unsaved')
  assert.equal(hasUnsavedChanges(saved), true)
  assert.equal(saved.undo.length, during.undo.length, 'undo history survives a save')
  // 基準是複本：之後改動快照不會改到草稿。
  snapshot.definition.modes.light.colors.accent = 'rgb(0 0 0 / 1)'
  assert.equal(saved.baseline.definition.modes.light.colors.accent, 'rgb(10 120 200 / 1)')
  // 沒有在途變更時，存檔後就是乾淨的。
  assert.equal(isDirty(markSaved(beforeSave, 'u-0123456789ab', { name: 'Mine', definition: beforeSave.definition })), false)
})

test('save and apply are gated on a current, fully valid validation', () => {
  const valid = validateUserPanelTheme(builtinDefinition())
  const broken = builtinDefinition()
  broken.modes.light.colors.text = 'rgb(220 220 220 / 1)'
  const invalid = validateUserPanelTheme(broken)
  assert.equal(canSave({ validationCurrent: true, validation: valid, busy: false, nameValid: true }), true)
  assert.equal(canSave({ validationCurrent: false, validation: valid, busy: false, nameValid: true }), false)
  assert.equal(canSave({ validationCurrent: true, validation: invalid, busy: false, nameValid: true }), false)
  assert.equal(canSave({ validationCurrent: true, validation: null, busy: false, nameValid: true }), false)
  assert.equal(canSave({ validationCurrent: true, validation: valid, busy: true, nameValid: true }), false)
  assert.equal(canSave({ validationCurrent: true, validation: valid, busy: false, nameValid: false }), false)
})

test('"Use suggested" applies the fix for a pair, falling back to the foreground key when the blamed wash has none', () => {
  const definition = builtinDefinition()
  definition.modes.light.colors.textMuted = 'rgb(170 160 150 / 1)'
  let validation = validateUserPanelTheme(definition)
  const byPath = issuesByPath(validation, 'light')
  assert.ok(byPath.get('colors.textMuted')!.length > 1)
  assert.equal(issuesByPath(validation, 'dark').size, 0)
  const wash = validation.issues.find(issue => issue.path === 'colors.accentOnHover')
  if (wash) assert.equal(fixFor(wash, validation)?.path, 'colors.textMuted')
  const fix = fixFor(byPath.get('colors.textMuted')![0]!, validation)!
  const next = applyFix(definition, 'light', fix.path, fix.value)
  assert.notEqual(next, definition)
  validation = validateUserPanelTheme(next)
  assert.equal(validation.valid, true)
  // 不認得的路徑不改任何東西。
  assert.equal(applyFix(definition, 'light', 'colors.nope', 'rgb(0 0 0 / 1)'), definition)
  assert.equal(applyFix(definition, 'light', 'userImage.overlay.opacity', 0.9), definition, 'no image settings to change')
})

test('colour inputs accept every manifest grammar and round-trip through the native picker and OKLCH controls', () => {
  assert.equal(parseColorInput(' #1f7a80 '), 'rgb(31 122 128 / 1)')
  assert.equal(parseColorInput('rgb(10, 20, 30)'), 'rgb(10 20 30 / 1)')
  assert.equal(parseColorInput('oklch(0.6 0.1 200)')?.startsWith('rgb('), true)
  assert.equal(parseColorInput('red'), null)
  assert.equal(parseColorInput('url(x)'), null)
  assert.equal(colorToHex('rgb(31 122 128 / 0.5)'), '#1f7a80')
  assert.equal(colorFromHex('#ffffff', 'rgb(0 0 0 / 0.16)'), 'rgb(255 255 255 / 0.16)', 'the picker keeps the alpha')
  assert.equal(colorFromHex('fff', 'rgb(0 0 0 / 1)'), null)
  const oklch = colorToOklch('rgb(31 122 128 / 1)')
  assert.equal(colorFromOklch(oklch, 'rgb(0 0 0 / 1)'), 'rgb(31 122 128 / 1)')
  // 超出色域時降低色度而不是拒絕。
  assert.match(colorFromOklch({ l: 0.9, c: 0.4, h: 140 }, 'rgb(0 0 0 / 1)'), /^rgb\(\d+ \d+ \d+ \/ 1\)$/)
})

test('the preview entry uses the same property map as the panel and passes the renderer allowlist', () => {
  const definition = builtinDefinition()
  definition.typography = { body: 'rounded', heading: 'serif', scale: 1.1 }
  definition.modes.dark.petStatus = {
    background: 'rgb(41 36 32 / 0.92)', text: 'rgb(243 237 228 / 1)', textMuted: 'rgb(207 197 182 / 1)', border: 'rgb(243 237 228 / 0.18)',
    quotaFill: 'rgb(217 134 82 / 1)', quotaTrack: 'rgb(243 237 228 / 0.18)', quotaWarn: 'rgb(240 200 102 / 1)',
  }
  const entry = previewEntry(definition, 'Mine', null)
  for (const mode of ['light', 'dark'] as const) {
    const { properties } = panelThemeTargetProperties(entry, mode, { forcedColors: false, highContrast: false })
    for (const property of PANEL_THEME_COLOR_PROPERTIES) assert.equal(properties.get(property), entry.modes[mode]!.properties[property], property)
    assert.equal(properties.get('--organic-font-body'), 'ui-rounded, "Hiragino Maru Gothic ProN", system-ui, sans-serif')
    assert.equal(properties.get('--organic-font-body-md'), '14px')
  }
  assert.equal(entry.modes.dark!.petStatus!['--pet-status-text'], 'rgb(243 237 228 / 1)')
  assert.equal(entry.modes.dark!.petStatus!['--pet-status-background-opaque'], 'rgb(41 36 32 / 1)')
})

test('validator surface names become readable phrases, recursively and for every issue kind', () => {
  const tr = (key: string, params: Record<string, string | number> = {}) => `${key}(${Object.entries(params).map(([name, value]) => `${name}=${value}`).join(',')})`
  const label = (key: string) => (key.startsWith('surface') || key === 'bg' || key.endsWith('Text') ? `<${key}>` : null)
  assert.equal(surfaceLabel('accentOnHover over surface2 (focus ring)', label, tr), 'themeEditor.surface.focus(base=themeEditor.surface.hover(base=<surface2>))')
  assert.equal(surfaceLabel('dangerText at 0.12 over bg (state chip)', label, tr), 'themeEditor.surface.chip(state=<dangerText>,base=<bg>)')
  assert.equal(surfaceLabel('the quota track on the pet status pill over a white desktop', label, tr), 'themeEditor.surface.quotaTrack(base=themeEditor.surface.petPill(desktop=themeEditor.desktop.white()))')
  assert.equal(surfaceLabel('gradient between stops 0 and 1', label, tr), 'themeEditor.surface.gradientBetween(from=1,to=2)')
  assert.equal(surfaceLabel('something new', label, tr), 'themeEditor.surface.other()', 'an unknown name never reaches the user in English')
  const definition = builtinDefinition()
  definition.modes.light.colors.textMuted = 'rgb(200 190 180 / 1)'
  definition.modes.dark.colors.dangerText = 'rgb(60 200 60 / 1)'
  definition.modes.dark.colors.shadow = 'rgb(200 200 200 / 1)'
  definition.modes.light.image = { fit: 'cover', overlayColor: 'rgb(245 234 216 / 1)', dim: 0.5 }
  for (const issue of validateUserPanelTheme(definition).issues) {
    const text = describeIssue(issue, label, tr)
    assert.match(text, /^themeEditor\.issue\./, `${issue.kind} ${issue.path}`)
    assert.doesNotMatch(text, /undefined/)
  }
})

/**
 * 驗證器能產生的每一種表面名稱：所有顏色都相同時，每一組對比都失敗，所以不變量、懸停底、
 * 狀態晶片、泡泡與膠囊（含焦點框、額度條與軌道）、徽章、按下的按鈕、最多 5 個色標的漸層、
 * 寵物膠囊的每個配對、色差的比較對象都會出現一次。兩個模式都跑。
 */
function everyValidatorIssue(): Array<PanelThemeIssue & { mode: 'light' | 'dark' }> {
  const gray = { r: 128, g: 128, b: 128, a: 1 }
  const colors = Object.fromEntries(USER_PANEL_THEME_COLOR_KEYS.map(key => [key, gray])) as Parameters<typeof panelThemeModeIssues>[0]['colors']
  const petStatus = Object.fromEntries(PET_STATUS_TOKENS.map(token => [token.key, gray])) as NonNullable<Parameters<typeof panelThemeModeIssues>[0]['petStatus']>
  const stops = [0, 0.25, 0.5, 0.75, 1].map(at => ({ color: gray, at }))
  return PANEL_THEME_MODES.flatMap(mode => [...panelThemeModeIssues({
    mode,
    colors,
    background: { type: 'gradient', kind: 'linear', angle: 180, stops },
    userImageOverlay: { color: gray, opacity: 0.5 },
    petStatus,
  })].map(issue => ({ ...issue, mode })))
}

const CATALOGS = { 'zh-TW': themeEditorZhTW, 'en-US': themeEditorEnUS } as const
/** 驗證器內部的英文識別字：駝峰式的鍵名、surface2、bg、alpha 與混色比例等內部寫法。 */
const RAW_NAME = /[a-z][A-Z]|\bsurface2\b|\bbg\b|\(state chip\)|\(badge fill\)|\bat 0\.|\bmixed 12%/

test('every surface name the validator can emit has a translated label in en-US and zh-TW', () => {
  const issues = everyValidatorIssue()
  const names = new Set(issues.flatMap(issue => (issue.background ? [issue.background] : [])))
  assert.ok(names.size >= 50, `expected the full surface matrix, got ${names.size}`)
  for (const name of ['the quota track on the pet status pill over a black desktop', 'gradient between stops 3 and 4', 'quotaTrack on the pill over a white desktop', 'accentHover mixed 12% toward text (hovered primary button)']) {
    assert.ok(names.has(name), `the enumeration covers ${name}`)
  }
  for (const [locale, catalog] of Object.entries(CATALOGS)) {
    const strings = catalog as Record<string, string>
    const translate = (key: string, params?: Record<string, string | number>) => {
      assert.ok(key in strings, `${locale} has ${key}`)
      return fillTemplate(strings[key]!, params)
    }
    const keyLabel = (key: string) => ((USER_PANEL_THEME_COLOR_KEYS as readonly string[]).includes(key) ? translate(`themeEditor.key.${key}`) : null)
    const fallback = translate('themeEditor.surface.other')
    for (const name of names) {
      const text = surfaceLabel(name, keyLabel, translate)
      assert.notEqual(text, fallback, `${locale}: "${name}" has its own label`)
      assert.doesNotMatch(text, /[{}]|undefined/, `${locale}: "${name}" fills every placeholder`)
      assert.doesNotMatch(text, RAW_NAME, `${locale}: "${name}" → "${text}" shows no validator identifier`)
      if (locale === 'zh-TW') assert.doesNotMatch(text, /[A-Za-z]{2,}/, `zh-TW: "${name}" → "${text}" has no English`)
    }
    // 整句也一樣：每個問題（含「懸停底上的某段文字」這種前景與背景不同的句子）都沒有內部名稱。
    for (const issue of issues) {
      const text = describeIssue(issue, keyLabel, translate)
      assert.doesNotMatch(text, RAW_NAME, `${locale}: ${issue.path} ${issue.kind} → "${text}"`)
      if (locale === 'zh-TW') assert.doesNotMatch(text.replace(/OKLCH|OKLab/g, ''), /[A-Za-z]{2,}/, `zh-TW: ${issue.path} ${issue.kind} → "${text}"`)
    }
  }
})
