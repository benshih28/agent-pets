import assert from 'node:assert/strict'
import test from 'node:test'
import { PANEL_THEME_COLOR_TOKENS, parsePanelThemes } from '../electron/plugin-panel-themes.ts'
import {
  parseUserPanelThemeDefinition,
  parseUserPanelThemeExport,
  parseUserPanelThemeName,
  parseUserPanelThemeRecord,
  userPanelThemeContribution,
  userPanelThemeExport,
} from '../electron/panel-theme-user.ts'
import { PANEL_THEME_DIAGNOSTIC_MAX_ISSUES, validateUserPanelTheme } from '../electron/panel-theme-diagnostics.ts'
import { PANEL_THEME_COLOR_KEY_PROPERTIES } from '../src/types/panel-theme.ts'
import { USER_PANEL_THEME_COLOR_KEYS, USER_PANEL_THEME_FONT_STACK_IDS } from '../src/types/panel-theme-user.ts'
import { builtinDefinition } from './support/panel-theme-fixtures.mts'

test('the editor key list and the renderer key→property map match the validator token table', () => {
  assert.deepEqual([...USER_PANEL_THEME_COLOR_KEYS].sort(), PANEL_THEME_COLOR_TOKENS.map(token => token.key).sort())
  for (const token of PANEL_THEME_COLOR_TOKENS) assert.equal(PANEL_THEME_COLOR_KEY_PROPERTIES[token.key], token.property)
})

test('a built-in definition parses, converts to a valid panelThemes entry and validates clean', () => {
  const parsed = parseUserPanelThemeDefinition(builtinDefinition())
  assert.equal(parsed.ok, true)
  const result = validateUserPanelTheme(builtinDefinition())
  assert.deepEqual(result, { valid: true, issues: [], minDim: {} })
  assert.doesNotThrow(() => parsePanelThemes([userPanelThemeContribution('u-0123456789ab', 'Mine', builtinDefinition())]))
})

test('every safe font stack is accepted by the manifest family grammar', () => {
  for (const id of USER_PANEL_THEME_FONT_STACK_IDS) {
    const definition = builtinDefinition()
    definition.typography = { body: id, heading: id, scale: 1.05 }
    assert.equal(validateUserPanelTheme(definition).valid, true, id)
  }
})

test('the definition grammar is strict: unknown, missing and malformed values reject with a path', () => {
  const cases: Array<[(definition: Record<string, any>) => void, RegExp]> = [
    [definition => { definition.extra = 1 }, /^definition\.extra$/],
    [definition => { delete definition.shape }, /^definition\.shape$/],
    [definition => { definition.modes.light.colors.bogus = '#fff' }, /^light\.colors\.bogus$/],
    [definition => { delete definition.modes.dark.colors.text }, /^dark\.colors\.text$/],
    [definition => { definition.modes.light.colors.text = 'red' }, /^light\.colors\.text$/],
    [definition => { definition.modes.light.colors.text = 'var(--x)' }, /^light\.colors\.text$/],
    [definition => { definition.modes.light.colors.text = 'rgb(0 0 0 / 1); background: url(x)' }, /^light\.colors\.text$/],
    [definition => { definition.typography.body = 'Comic Sans' }, /^typography\.body$/],
    [definition => { definition.typography.scale = 1.234 }, /^typography\.scale$/],
    [definition => { definition.shape.radiusSm = 20 }, /^shape\.radiusSm$/],
    [definition => { definition.shape = { radiusSm: 10, radiusMd: 8, radiusLg: 28 } }, /^shape$/],
    [definition => { definition.modes.light.background = { type: 'image', src: 'x.png' } }, /^light\.background\.type$/],
    [definition => { definition.modes.light.background = { type: 'gradient', kind: 'linear', angle: 10, stops: [{ color: '#fff', at: 50 }, { color: '#eee', at: 10 }] } }, /stops\[1\]\.at$/],
    [definition => { definition.modes.light.background = { type: 'gradient', kind: 'linear', angle: 10, stops: [{ color: 'rgb(0 0 0 / 0.5)', at: 0 }, { color: '#eee', at: 10 }] } }, /stops\[0\]\.color$/],
    [definition => { definition.modes.light.image = { fit: 'cover', overlayColor: '#fff', dim: 0.4 } }, /^light\.image\.dim$/],
    [definition => { definition.modes.light.image = { fit: 'cover', overlayColor: '#fff', dim: 0.9, path: '/etc/passwd' } }, /^light\.image\.path$/],
    [definition => { definition.modes.light.petStatus = { background: '#fff', text: '#000' } }, /^light\.petStatus\./],
    [definition => { definition.modes = { light: definition.modes.light } }, /^modes\.dark$/],
  ]
  for (const [mutate, path] of cases) {
    const definition = builtinDefinition() as unknown as Record<string, any>
    mutate(definition)
    const parsed = parseUserPanelThemeDefinition(definition)
    assert.equal(parsed.ok, false)
    if (!parsed.ok) assert.match(parsed.path, path)
  }
  // JSON.parse 產生的 __proto__ 是自有屬性，會被當成未知鍵拒絕。
  const polluted = JSON.parse(`{"__proto__":{"x":1},${JSON.stringify(builtinDefinition()).slice(1)}`)
  assert.equal(parseUserPanelThemeDefinition(polluted).ok, false)
})

test('colours in any manifest grammar are re-emitted in the host canonical format', () => {
  const definition = builtinDefinition() as unknown as Record<string, any>
  definition.modes.light.colors.text = '#201e1d'
  const parsed = parseUserPanelThemeDefinition(definition)
  assert.equal(parsed.ok && parsed.value.modes.light.colors.text, 'rgb(32 30 29 / 1)')
})

test('names are cleaned and bounded', () => {
  assert.equal(parseUserPanelThemeName('  Sakura <b>night</b>\u0000 '), 'Sakura b night /b')
  assert.equal(parseUserPanelThemeName(''), null)
  assert.equal(parseUserPanelThemeName('x'.repeat(49)), null)
  assert.equal(parseUserPanelThemeName(42), null)
})

test('diagnostics list every failing pair with measured, required and a suggestion that fixes it', () => {
  const definition = builtinDefinition()
  definition.modes.light.colors.textMuted = 'rgb(170 160 150 / 1)'
  definition.modes.dark.colors.dangerText = 'rgb(60 200 60 / 1)'
  const result = validateUserPanelTheme(definition)
  assert.equal(result.valid, false)
  const muted = result.issues.filter(issue => issue.mode === 'light' && issue.path === 'colors.textMuted')
  assert.ok(muted.length >= 2, 'textMuted fails on several surfaces')
  for (const issue of muted) {
    assert.equal(issue.kind, 'contrast')
    assert.ok(typeof issue.measured === 'number' && issue.measured < 4.5)
    assert.equal(issue.required, 4.5)
    assert.match(issue.problem, /^\d\.\d\d:1 < 4\.5:1 on /)
  }
  const hue = result.issues.find(issue => issue.mode === 'dark' && issue.path === 'colors.dangerText')
  assert.equal(hue?.kind, 'hue')
  // 採用每個建議值之後，定義完全通過。
  for (const issue of result.issues) {
    if (typeof issue.suggested !== 'string') continue
    const [, key] = issue.path.split('.') as [string, keyof typeof definition.modes.light.colors]
    definition.modes[issue.mode].colors[key] = issue.suggested
  }
  assert.equal(validateUserPanelTheme(definition).valid, true)
})

test('the first diagnostic is the one the manifest validator reports', () => {
  const definition = builtinDefinition()
  definition.modes.light.colors.textSecondary = 'rgb(180 180 180 / 1)'
  const first = validateUserPanelTheme(definition).issues[0]!
  assert.throws(() => parsePanelThemes([userPanelThemeContribution('u-0123456789ab', 'Mine', definition)]), error => {
    assert.equal((error as { diagnostic: string }).diagnostic, `u-0123456789ab.light.${first.path}: ${first.problem}`)
    return true
  })
})

test('a user background image reports the minimum dim and suggests it for a too-low default', () => {
  const definition = builtinDefinition()
  // 內建淺色的 textMuted 與 accent 在圖片上過不了（文件也這樣寫），先換深一點。
  definition.modes.light.colors.textMuted = 'rgb(80 72 60 / 1)'
  definition.modes.light.colors.accent = 'rgb(120 60 140 / 1)'
  definition.modes.light.image = { fit: 'cover', overlayColor: definition.modes.light.colors.bg, dim: 0.5 }
  const result = validateUserPanelTheme(definition)
  const overlay = result.issues.find(issue => issue.path === 'userImage.overlay.opacity')
  assert.equal(overlay?.kind, 'overlay')
  assert.equal(typeof overlay?.suggested, 'number')
  assert.equal(result.minDim.light, overlay?.suggested)
  definition.modes.light.image.dim = overlay!.suggested as number
  const fixed = validateUserPanelTheme(definition)
  assert.equal(fixed.valid, true)
  assert.equal(fixed.minDim.light, overlay?.suggested)
})

test('pet pill colours are validated over black and white desktops with suggestions', () => {
  const definition = builtinDefinition()
  definition.modes.dark.petStatus = {
    background: 'rgb(41 36 32 / 0.92)', text: 'rgb(90 90 90 / 1)', textMuted: 'rgb(200 190 180 / 1)', border: 'rgb(243 237 228 / 0.18)',
    quotaFill: 'rgb(217 134 82 / 1)', quotaTrack: 'rgb(243 237 228 / 0.18)', quotaWarn: 'rgb(240 200 102 / 1)',
  }
  const result = validateUserPanelTheme(definition)
  const text = result.issues.find(issue => issue.path === 'petStatus.text')
  assert.equal(text?.kind, 'contrast')
  assert.match(text!.background!, /pill over a (black|white) desktop/)
  for (const issue of result.issues) {
    assert.match(issue.path, /^petStatus\./)
    assert.equal(typeof issue.suggested, 'string', issue.path)
    definition.modes.dark.petStatus[issue.path.slice('petStatus.'.length) as 'text'] = issue.suggested as string
  }
  assert.equal(validateUserPanelTheme(definition).valid, true)
})

test('diagnostics are bounded and deterministic', () => {
  const definition = builtinDefinition()
  for (const key of USER_PANEL_THEME_COLOR_KEYS) definition.modes.light.colors[key] = 'rgb(128 128 128 / 1)'
  const first = validateUserPanelTheme(definition)
  assert.ok(first.issues.length <= PANEL_THEME_DIAGNOSTIC_MAX_ISSUES)
  assert.deepEqual(validateUserPanelTheme(definition), first)
})

test('export and import round-trip only name and definition; import is strict', () => {
  const record = { schemaVersion: 1 as const, id: 'u-0123456789ab', name: 'Mine', createdAt: '2026-11-08T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z', definition: builtinDefinition() }
  const exported = userPanelThemeExport(record)
  assert.deepEqual(Object.keys(exported).sort(), ['definition', 'format', 'name', 'schemaVersion'])
  const imported = parseUserPanelThemeExport(JSON.parse(JSON.stringify(exported)))
  assert.equal(imported.ok, true)
  if (imported.ok) assert.deepEqual(imported.value, { name: 'Mine', definition: record.definition })
  assert.equal(parseUserPanelThemeExport({ ...exported, id: 'u-0123456789ab' }).ok, false)
  assert.equal(parseUserPanelThemeExport({ ...exported, format: 'other' }).ok, false)
  assert.equal(parseUserPanelThemeExport({ ...exported, schemaVersion: 2 }).ok, false)
  assert.equal(parseUserPanelThemeExport({ ...exported, name: '' }).ok, false)
  assert.equal(parseUserPanelThemeRecord(record, record.id)?.name, 'Mine')
  assert.equal(parseUserPanelThemeRecord(record, 'u-ffffffffffff'), null)
  assert.equal(parseUserPanelThemeRecord({ ...record, extra: 1 }, record.id), null)
})
