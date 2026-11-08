import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  MULTI_PET_LINE_MIN_W,
  MULTI_PET_SPRITE_W,
  STATUS_LINE_GEOMETRY as g,
  STATUS_TEXT_FONTS,
  fitStatusLine,
  statusLineContentWidth,
  statusLineWidth,
  type MeasureText,
  type StatusLineFit,
  type StatusLineFitInput,
} from '../src/utils/status-line-fit.ts'

// 在隔離 Electron（macOS）以 canvas 量到的字寬；表外的文字用偏寬的每字估計。
const MEASURED: Record<string, number> = {
  'state:Idle': 20.47, 'state:Thinking': 48.43, 'state:Working': 46.48, 'state:Permission': 61.9,
  'state:Needs input': 68.3, 'state:Done': 29.67, 'state:Failed': 33.3, 'state:Offline': 37.8, 'state:·': 3.56,
  'label:Codex': 37.36, 'label:Claude': 41.2, 'label:OpenCode': 62.31, 'label:00': 16,
  'badge:Build': 27.69, 'badge:Deploy': 37.94, 'badge:+3': 14.57,
  'readout:100%': 37.28, 'readout:71%': 28.94, 'readout:40%': 28.94,
}
const PER_CHAR = { label: 7.4, state: 6.6, badge: 6.4, readout: 9.4 } as const
const measure: MeasureText = (text, part) => MEASURED[`${part}:${text}`] ?? Array.from(text).length * PER_CHAR[part]

const STATES = ['Idle', 'Thinking', 'Working', 'Permission', 'Needs input', 'Done', 'Failed', 'Offline']
const LABELS = ['Codex', 'Claude', 'OpenCode']
// store.scaledW 的單寵物視窗寬：max(round(250 × 倍率), 260)。
const SINGLE_WINDOW_W: Record<number, number> = { 0.6: 260, 0.8: 260, 1: 260, 1.2: 300, 1.5: 375 }
const FULL: StatusLineFit = { showLabel: true, showReadout: true, badgeCount: 2, showOverflow: true }

const worst = (label: string, state: string, contentWidth: number): StatusLineFitInput => ({
  contentWidth, label, state, readout: '100%', badges: ['Build', 'Deploy'], hiddenCount: 3,
})

test('content width follows the pet window (single) and the sprite column with a floor (multi)', () => {
  assert.equal(statusLineContentWidth(false, 1, 260), 226)
  assert.equal(statusLineContentWidth(false, 1.2, 300), 266)
  assert.equal(statusLineContentWidth(false, 1.5, 375), 341)
  assert.equal(statusLineContentWidth(true, 0.6, 0), 92)
  assert.ok(Math.abs(statusLineContentWidth(true, 0.8, 0) - 121.6) < 1e-9)
  assert.equal(statusLineContentWidth(true, 1, 0), 160)
  assert.equal(statusLineContentWidth(true, 1.5, 0), 256)
})

test('statusLineWidth adds up the parts, gaps and separator', () => {
  // 每字 10px、分隔點 4px：名稱 50、狀態 40、百分比 30、徽章 'Ab' 32、'Abcdefg' 封頂 42、'+3' 32。
  const flat: MeasureText = text => (text === '·' ? 4 : Array.from(text).length * 10)
  const input: StatusLineFitInput = { contentWidth: 999, label: 'Codex', state: 'Idle', readout: '40%', badges: ['Ab', 'Abcdefg'], hiddenCount: 3 }
  // 8 + 40 + (50 + 4 + 3 - 2) + 30 + (32 + 42 + 32 + 2 × 3) + 4 × 5
  assert.equal(statusLineWidth(input, FULL, flat), 265)
  // 沒有徽章時名稱只算 2ch：8 + 40 + (20 + 5) + 30 + 3 × 5
  assert.equal(statusLineWidth(input, { showLabel: true, showReadout: true, badgeCount: 0, showOverflow: false }, flat), 118)
  // 只剩點與狀態：8 + 40 + 5
  assert.equal(statusLineWidth(input, { showLabel: false, showReadout: false, badgeCount: 0, showOverflow: false }, flat), 53)
})

test('the chosen fit always fits, with quota and two badges plus +N, at every pet size in both layouts', () => {
  const widths = [
    ...Object.entries(SINGLE_WINDOW_W).map(([scale, windowW]) => statusLineContentWidth(false, Number(scale), windowW)),
    ...[0.6, 0.8, 1, 1.2, 1.5].map(scale => statusLineContentWidth(true, scale, 0)),
  ]
  for (const contentWidth of widths) {
    for (const label of LABELS) {
      for (const state of STATES) {
        const input = worst(label, state, contentWidth)
        const fit = fitStatusLine(input, measure)
        assert.ok(statusLineWidth(input, fit, measure) <= contentWidth - g.slack, `${contentWidth}px ${label} ${state}: ${JSON.stringify(fit)}`)
      }
    }
  }
})

test('single pet: the wider XL / XXL windows keep more; the default size gives up +N, then the last badge', () => {
  for (const label of LABELS) {
    const xxl = fitStatusLine(worst(label, 'Needs input', statusLineContentWidth(false, 1.5, SINGLE_WINDOW_W[1.5])), measure)
    assert.deepEqual(xxl, FULL, `1.5 ${label}`)
    const xl = fitStatusLine(worst(label, 'Needs input', statusLineContentWidth(false, 1.2, SINGLE_WINDOW_W[1.2])), measure)
    assert.equal(xl.showLabel && xl.showReadout && xl.badgeCount >= 1, true, `1.2 ${label}: ${JSON.stringify(xl)}`)
  }
  // XL 比預設尺寸多 40px：預設尺寸放不下的兩個徽章，在 XL 放得下。
  const both = (scale: number) => fitStatusLine({
    contentWidth: statusLineContentWidth(false, scale, SINGLE_WINDOW_W[scale]), label: 'Claude', state: 'Working', readout: '71%', badges: ['Build', 'Deploy'], hiddenCount: 0,
  }, measure).badgeCount
  assert.equal(both(1), 1)
  assert.equal(both(1.2), 2)
  const contentWidth = statusLineContentWidth(false, 1, SINGLE_WINDOW_W[1])
  const one = (state: string, badges: string[], hiddenCount: number) =>
    fitStatusLine({ contentWidth, label: 'Claude', state, readout: '71%', badges, hiddenCount }, measure)
  assert.deepEqual(one('Idle', ['Build', 'Deploy'], 3), { showLabel: true, showReadout: true, badgeCount: 2, showOverflow: false })
  assert.deepEqual(one('Permission', ['Build', 'Deploy'], 3), { showLabel: true, showReadout: true, badgeCount: 1, showOverflow: false })
})

test('things are given up in order: +N, badges from the end, the name, the quota number', () => {
  const seen: StatusLineFit[] = []
  for (let width = 400; width >= 60; width -= 1) {
    const fit = fitStatusLine(worst('OpenCode', 'Needs input', width), measure)
    const prev = seen.at(-1)
    if (!prev || JSON.stringify(prev) !== JSON.stringify(fit)) seen.push(fit)
  }
  assert.deepEqual(seen, [
    FULL,
    { showLabel: true, showReadout: true, badgeCount: 2, showOverflow: false },
    { showLabel: true, showReadout: true, badgeCount: 1, showOverflow: false },
    { showLabel: true, showReadout: true, badgeCount: 0, showOverflow: false },
    { showLabel: false, showReadout: true, badgeCount: 0, showOverflow: false },
    { showLabel: false, showReadout: false, badgeCount: 0, showOverflow: false },
  ])
})

test('multi pet: the name shows at the large size; below it the name, then the quota number give way', () => {
  const at = (scale: number, state: string) => fitStatusLine({
    contentWidth: statusLineContentWidth(true, scale, 0), label: 'Codex', state, readout: '40%', badges: ['Build'], hiddenCount: 0,
  }, measure)
  assert.deepEqual(at(1, 'Permission'), { showLabel: true, showReadout: true, badgeCount: 0, showOverflow: false })
  assert.deepEqual(at(0.8, 'Permission'), { showLabel: false, showReadout: true, badgeCount: 0, showOverflow: false })
  assert.deepEqual(at(0.6, 'Permission'), { showLabel: false, showReadout: false, badgeCount: 0, showOverflow: false })
  assert.deepEqual(at(0.6, 'Idle'), { showLabel: false, showReadout: true, badgeCount: 0, showOverflow: false })
})

test('the geometry and fonts match DesktopPet.css and the tokens', () => {
  const css = readFileSync(new URL('../src/components/DesktopPet.css', import.meta.url), 'utf8')
  const tokens = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8')
  const rule = (selector: string) => {
    const start = css.indexOf(`\n${selector} {`)
    assert.ok(start >= 0, selector)
    return css.slice(start, css.indexOf('}', start))
  }
  const has = (selector: string, declaration: string) => assert.ok(rule(selector).includes(declaration), `${selector}: ${declaration}`)
  has('.status-line', `padding: 3px ${g.paddingX}px;`)
  has('.status-line', `border: ${g.borderX}px solid`)
  has('.status-line', `gap: ${g.gap}px;`)
  has('.status-line', `max-width: calc(var(--pet-w, 250px) - ${g.petInsetX}px);`)
  has('.multi-pet-status-line', `width: max(calc(${MULTI_PET_SPRITE_W}px * var(--pet-scale, 1) - ${g.multiPetInsetX}px), ${MULTI_PET_LINE_MIN_W}px);`)
  has('.line-dot', `width: ${g.dot}px;`)
  has('.line-sep', `margin-left: ${g.sepMarginLeft}px;`)
  has('.line-text + .line-state', `margin-left: -${g.statePullBack}px;`)
  has('.plugin-status-badges', `gap: ${g.badgeGap}px;`)
  has('.plugin-badge-anchor', 'flex: 0 1 auto;')
  has('.plugin-badge-anchor', `max-width: ${g.badgeMax}px;`)
  has('.plugin-badge-pill', `padding: 0 ${g.badgePaddingX}px;`)
  has('.plugin-badge-pill', `border: ${g.borderX}px solid`)
  has('.plugin-badge-overflow', `max-width: ${g.overflowMax}px;`)
  has('.quota-readout', `min-width: ${g.readoutMin}px;`)

  const { label, state, badge, readout } = STATUS_TEXT_FONTS
  // 狀態與名稱繼承 .status-line 的字體與字級；名稱另設字重，狀態維持預設 400。
  has('.status-line', `font-family: var(${state.familyVar});`)
  has('.status-line', `font-size: var(${state.sizeVar});`)
  assert.doesNotMatch(rule('.status-line'), /font-weight/)
  assert.equal(state.weight, 400)
  assert.equal(label.sizeVar, state.sizeVar)
  assert.equal(label.familyVar, state.familyVar)
  has('.line-label', `font-weight: ${label.weight};`)
  has('.plugin-badge-pill', `font-size: var(${badge.sizeVar});`)
  has('.plugin-badge-pill', `font-weight: ${badge.weight};`)
  has('.quota-readout', `font-family: var(${readout.familyVar});`)
  has('.quota-readout', `font-size: var(${readout.sizeVar});`)
  has('.quota-readout', `font-weight: ${readout.weight};`)
  for (const font of Object.values(STATUS_TEXT_FONTS)) {
    assert.ok(tokens.includes(`${font.sizeVar}: ${font.sizeFallback};`), `${font.sizeVar} fallback`)
  }
})

test('quota colours are chosen in CSS by data-quota-tier, not built as strings in script', () => {
  const css = readFileSync(new URL('../src/components/DesktopPet.css', import.meta.url), 'utf8')
  const vue = readFileSync(new URL('../src/components/DesktopPet.vue', import.meta.url), 'utf8')
  const tiers: Record<string, string> = {
    low: '--organic-quota-error', warning: '--organic-quota-warning', claude: '--organic-accent', normal: '--organic-quota-sage',
  }
  for (const [tier, token] of Object.entries(tiers)) {
    assert.match(css, new RegExp(`\\.status-line\\[data-quota-tier='${tier}'\\] \\{\\n  --quota-color: var\\(${token}\\);`), tier)
    assert.match(vue, new RegExp(`return [^\\n]*'${tier}'`), `quotaTier returns ${tier}`)
  }
  assert.equal(vue.match(/:data-quota-tier="quotaTier\(line\.key\)"/g)?.length, 2)
  assert.doesNotMatch(vue.split('<template>')[0], /'var\(--/)
})
