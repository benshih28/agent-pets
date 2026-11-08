import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { axisLabelParts, axisLabelVisible, dayLabel } from '../src/utils/history-axis.ts'

const root = path.resolve(import.meta.dirname, '..')
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')

function styleSources(): Array<{ file: string; css: string }> {
  const out: Array<{ file: string; css: string }> = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(rel)
      else if (rel.endsWith('.css')) out.push({ file: rel, css: read(rel) })
      else if (rel.endsWith('.vue')) {
        const css = [...read(rel).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(match => match[1]).join('\n')
        if (css) out.push({ file: rel, css })
      }
    }
  }
  walk('src')
  return out
}

// Regression: a panel-wide `.status-panel :deep(.tab-panel) { display: flex }`
// beat the <TabPanel> primitive's `[hidden]` rule, so History rendered its
// Sessions and Overview sub-views at once, each squashed to a share of the
// height with its content spilling over the other.
test('only the TabPanel primitive styles the shared .tab-panel class', () => {
  const offenders: string[] = []
  for (const { file, css } of styleSources()) {
    if (file === path.join('src', 'components', 'ui', 'TabPanel.vue')) continue
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1]
      if (/(^|[\s,(>+~])\.tab-panel(?![\w-])/.test(selector)) offenders.push(`${file}: ${selector.trim()}`)
    }
  }
  assert.deepEqual(offenders, [])
})

test('a hidden TabPanel stays hidden whatever layout its consumer gives it', () => {
  const css = read('src/components/ui/TabPanel.vue')
  assert.match(css, /\.tab-panel\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/)
  assert.match(read('src/components/status-panel/StatusPanelHistory.vue'), /<TabPanel[^>]*:active="historyView === 'sessions'"/)
})

test('the dashboard-level panel keeps its own flex layout class', () => {
  assert.match(read('src/components/StatusPanel.css'), /\.status-panel :deep\(\.dashboard-tab-panel\)\s*\{\s*display:\s*flex;/)
  assert.match(read('src/components/status-panel/StatusPanelSessions.vue'), /id="panel-sessions"[^>]*class="dashboard-tab-panel"/)
})

test('trend axis labels split the weekday onto its own line', () => {
  assert.deepEqual(axisLabelParts('2026-11-02', true, 'zh-TW'), { date: '11/2', weekday: '週一' })
  assert.deepEqual(axisLabelParts('2026-11-02', true, 'en-US'), { date: '11/2', weekday: 'Mon' })
  assert.deepEqual(axisLabelParts('2026-11-02', false, 'en-US'), { date: '11/2', weekday: '' })
  assert.deepEqual(axisLabelParts('not-a-date', true, 'en-US'), { date: 'not-a-date', weekday: '' })
})

test('axis labels always include the newest day', () => {
  const shown = (length: number, step: number) => Array.from({ length }, (_, index) => index).filter(index => axisLabelVisible(index, length, step))
  assert.deepEqual(shown(7, 1), [0, 1, 2, 3, 4, 5, 6])
  assert.equal(shown(30, 5).at(-1), 29)
  assert.equal(shown(90, 13).at(-1), 89)
  assert.ok(shown(90, 13).length <= 7)
})

test('the chart formats its labels once per data change, not on every hover', () => {
  assert.equal(dayLabel('2026-11-02', true, 'en-US'), 'Mon, 11/2')
  assert.equal(dayLabel('2026-11-02', false, 'zh-TW'), '11/2')
  assert.equal(dayLabel('bad', true, 'en-US'), 'bad')
  const chart = read('src/components/growth/HistoryChart.vue')
  assert.match(chart, /const barAriaLabels = computed\(/)
  assert.match(chart, /const axisLabels = computed\(/)
  assert.match(chart, /:aria-label="barAriaLabels\[index\]"/)
  assert.doesNotMatch(chart, /\{\{[^}]*axisLabelParts\(/)
})

// The panel is its own window, so a viewport media query never saw the
// panel's real width; the stat tiles must follow the History view's width.
test('History stat tiles reflow by container width and never ellipsize their notes', () => {
  const css = read('src/components/StatusPanel.css')
  assert.match(css, /:deep\(\.history-view\) \{\s*container: history-view \/ inline-size;/)
  assert.match(css, /@container history-view \(max-width: 520px\) \{\s*\.status-panel :deep\(\.history-stat-grid\) \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/)
  assert.doesNotMatch(css, /@media[^{]*\{[^@]*history-stat-grid/)
  const meta = css.match(/:deep\(\.history-stat-meta\) \{([^}]*)\}/)?.[1] ?? ''
  assert.doesNotMatch(meta, /ellipsis|nowrap/)
})
