// 重構階段 7 改前錄下的呼叫點輸出：相對時間、時長、日期與數字格式。
// 期望值是改前實作的輸出，重構後不得變動；日期類（與時區有關）以改前的
// `toLocale*String()` 運算式當作對照。改前的呼叫點對應：通知收件匣
// `formatRelativeTime()` → `formatRelative(..., FEED_RELATIVE_TIME)`；權限倒數
// `permission-view` 的 `formatDuration()` → `formatClockDuration()`；歷史時長
// `token-format` 的 `durationParts()` → `durationParts(ms, HISTORY_DURATION)`。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  dateTimeFormatter,
  durationParts,
  FEED_RELATIVE_TIME,
  formatClockDuration,
  formatDate,
  formatDateDefault,
  formatDateParts,
  formatDateTime,
  formatDateTimeFull,
  formatDuration,
  formatNumber,
  formatRelative,
  formatTime,
  formatTimeFull,
  HISTORY_DURATION,
  numberFormatter,
} from '../src/utils/intl-format.ts'
import { formatTokens } from '../src/utils/token-format.ts'
import { axisLabelParts, dayLabel } from '../src/utils/history-axis.ts'

const formatRelativeTime = (at: number, now: number, loc: string): string => formatRelative(at, now, loc, FEED_RELATIVE_TIME)
function historyParts(ms: number): { days: number; hours: number; minutes: number } {
  const { days, hours, minutes } = durationParts(ms, HISTORY_DURATION)
  return { days, hours, minutes }
}

const NOW = Date.UTC(2026, 0, 15, 12)
const S = 1_000
const H = 3_600_000
const D = 86_400_000

// [名稱, 毫秒差]；每列再分過去（負）與未來（正）。
const OFFSETS: ReadonlyArray<readonly [string, number]> = [
  ['0', 0],
  ['59s', 59 * S],
  ['59.4s', 59_400],
  ['59.6s', 59_600],
  ['60s', 60 * S],
  ['89.4s', 89_400],
  ['90s', 90 * S],
  ['1.5h', 1.5 * H],
  ['23.5h', 23.5 * H],
  ['36h', 36 * H],
  ['6.9d', 6.9 * D],
  ['7d', 7 * D],
  ['45d', 45 * D],
  ['400d', 400 * D],
]

type RelativeRow = readonly [legacy: string, notification: string]
type RelativeTable = Record<string, { past: Record<string, RelativeRow>; future: Record<string, RelativeRow> }>

// legacy = intl-format formatRelative（trunc、無日期）；notification = 插件通知收件匣（round、<1 分鐘「現在」、≥7 天日期）。
// 「DATE」表示改顯示 dateStyle: medium 的日期，以 toLocaleDateString 對照。
const RELATIVE: RelativeTable = {
  'zh-TW': {
    past: {
      '0': ['現在', '現在'],
      '59s': ['59 秒前', '現在'],
      '59.4s': ['59 秒前', '現在'],
      '59.6s': ['1 分鐘前', '現在'],
      '60s': ['1 分鐘前', '1 分鐘前'],
      '89.4s': ['1 分鐘前', '1 分鐘前'],
      '90s': ['1 分鐘前', '1 分鐘前'],
      '1.5h': ['1 小時前', '1 小時前'],
      '23.5h': ['23 小時前', '23 小時前'],
      '36h': ['昨天', '昨天'],
      '6.9d': ['6 天前', '7 天前'],
      '7d': ['7 天前', 'DATE'],
      '45d': ['上個月', 'DATE'],
      '400d': ['去年', 'DATE'],
    },
    future: {
      '0': ['現在', '現在'],
      '59s': ['59 秒後', '現在'],
      '59.4s': ['59 秒後', '現在'],
      '59.6s': ['1 分鐘後', '現在'],
      '60s': ['1 分鐘後', '1 分鐘後'],
      '89.4s': ['1 分鐘後', '1 分鐘後'],
      '90s': ['1 分鐘後', '2 分鐘後'],
      '1.5h': ['1 小時後', '2 小時後'],
      '23.5h': ['23 小時後', '24 小時後'],
      '36h': ['明天', '後天'],
      '6.9d': ['6 天後', '7 天後'],
      '7d': ['7 天後', 'DATE'],
      '45d': ['下個月', 'DATE'],
      '400d': ['明年', 'DATE'],
    },
  },
  'en-US': {
    past: {
      '0': ['now', 'now'],
      '59s': ['59 seconds ago', 'now'],
      '59.4s': ['59 seconds ago', 'now'],
      '59.6s': ['1 minute ago', 'now'],
      '60s': ['1 minute ago', '1 minute ago'],
      '89.4s': ['1 minute ago', '1 minute ago'],
      '90s': ['1 minute ago', '1 minute ago'],
      '1.5h': ['1 hour ago', '1 hour ago'],
      '23.5h': ['23 hours ago', '23 hours ago'],
      '36h': ['yesterday', 'yesterday'],
      '6.9d': ['6 days ago', '7 days ago'],
      '7d': ['7 days ago', 'DATE'],
      '45d': ['last month', 'DATE'],
      '400d': ['last year', 'DATE'],
    },
    future: {
      '0': ['now', 'now'],
      '59s': ['in 59 seconds', 'now'],
      '59.4s': ['in 59 seconds', 'now'],
      '59.6s': ['in 1 minute', 'now'],
      '60s': ['in 1 minute', 'in 1 minute'],
      '89.4s': ['in 1 minute', 'in 1 minute'],
      '90s': ['in 1 minute', 'in 2 minutes'],
      '1.5h': ['in 1 hour', 'in 2 hours'],
      '23.5h': ['in 23 hours', 'in 24 hours'],
      '36h': ['tomorrow', 'in 2 days'],
      '6.9d': ['in 6 days', 'in 7 days'],
      '7d': ['in 7 days', 'DATE'],
      '45d': ['next month', 'DATE'],
      '400d': ['next year', 'DATE'],
    },
  },
}

const LOCALES = ['zh-TW', 'en-US'] as const

test('relative time: legacy formatRelative and the notification inbox keep their pre-refactor output', () => {
  for (const loc of LOCALES) {
    for (const direction of ['past', 'future'] as const) {
      const sign = direction === 'past' ? -1 : 1
      for (const [name, offset] of OFFSETS) {
        const at = NOW + sign * offset
        const [legacy, notification] = RELATIVE[loc][direction][name]
        const label = `${loc} ${direction} ${name}`
        assert.equal(formatRelative(at, NOW, loc), legacy, `legacy ${label}`)
        const expected = notification === 'DATE'
          ? new Date(at).toLocaleDateString(loc, { dateStyle: 'medium' })
          : notification
        assert.equal(formatRelativeTime(at, NOW, loc), expected, `notification ${label}`)
      }
    }
  }
})

test('relative time: Date stamps and a non-finite notification timestamp keep their output', () => {
  assert.equal(formatRelative(new Date(NOW - 5 * 60_000), new Date(NOW), 'en-US'), '5 minutes ago')
  assert.equal(formatRelativeTime(Number.NaN, NOW, 'en-US'), 'now')
})

// [毫秒, 精簡時長, 權限倒數 m:ss, 歷史 天/時/分]
const DURATIONS: ReadonlyArray<readonly [number, string, string, readonly [number, number, number]]> = [
  [-5, '0s', '0:00', [0, 0, 0]],
  [0, '0s', '0:00', [0, 0, 0]],
  [1, '0s', '0:01', [0, 0, 1]],
  [999, '0s', '0:01', [0, 0, 1]],
  [1_000, '1s', '0:01', [0, 0, 1]],
  [1_001, '1s', '0:02', [0, 0, 1]],
  [20_000, '20s', '0:20', [0, 0, 1]],
  [59_000, '59s', '0:59', [0, 0, 1]],
  [59_999, '59s', '1:00', [0, 0, 1]],
  [60_000, '1m 00s', '1:00', [0, 0, 1]],
  [89_999, '1m 29s', '1:30', [0, 0, 1]],
  [90_000, '1m 30s', '1:30', [0, 0, 2]],
  [1_829_999, '30m 29s', '30:30', [0, 0, 30]],
  [1_830_000, '30m 30s', '30:30', [0, 0, 31]],
  [1.5 * H, '1h 30m', '90:00', [0, 1, 30]],
  [23.5 * H, '23h 30m', '1410:00', [0, 23, 30]],
  [24 * H - 1, '23h 59m', '1440:00', [1, 0, 0]],
  [25.5 * H, '25h 30m', '1530:00', [1, 1, 30]],
  [6.9 * D, '165h 36m', '9936:00', [6, 21, 36]],
  [7 * D, '168h 00m', '10080:00', [7, 0, 0]],
]

test('durations: compact, permission countdown and history parts keep their pre-refactor output', () => {
  for (const [ms, compact, clock, [days, hours, minutes]] of DURATIONS) {
    assert.equal(formatDuration(ms), compact, `compact ${ms}`)
    assert.equal(formatClockDuration(ms), clock, `clock ${ms}`)
    assert.deepEqual(historyParts(ms), { days, hours, minutes }, `parts ${ms}`)
  }
  // 非有限值：倒數與歷史一律當 0。
  for (const ms of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(formatClockDuration(ms), '0:00')
    assert.deepEqual(historyParts(ms), { days: 0, hours: 0, minutes: 0 })
  }
})

// 各呼叫點實際傳入的 Intl 選項。
const CALL_SITE_PARTS: ReadonlyArray<Intl.DateTimeFormatOptions> = [
  { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }, // DesktopPet 額度重設
  { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }, // useQuotaFormat 一週內
  { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }, // useQuotaFormat 一週後
  { month: 'numeric', day: 'numeric' }, // GrowthOverview
  { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }, // SettingsDesktop
  { hour: '2-digit', minute: '2-digit', second: '2-digit' }, // usePluginPanelController
]

const STAMPS = [
  Date.UTC(2026, 0, 15, 4, 5, 9),
  Date.UTC(2026, 10, 10, 23, 59, 59),
  Date.UTC(2025, 5, 1, 0, 0, 0),
]

test('date formats match the pre-refactor toLocale*String() expressions', () => {
  for (const loc of LOCALES) {
    for (const stamp of STAMPS) {
      const date = new Date(stamp)
      assert.equal(formatDateTime(stamp, loc), date.toLocaleString(loc, { dateStyle: 'short', timeStyle: 'short' }))
      assert.equal(formatDate(stamp, loc), date.toLocaleDateString(loc, { year: 'numeric', month: '2-digit', day: '2-digit' }))
      assert.equal(formatTime(date, loc), date.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' }))
      assert.equal(formatTimeFull(stamp, loc), date.toLocaleTimeString(loc))
      assert.equal(formatDateTimeFull(stamp, loc), date.toLocaleString(loc))
      assert.equal(formatDateDefault(stamp, loc), date.toLocaleDateString(loc))
      for (const options of CALL_SITE_PARTS) {
        assert.equal(formatDateParts(stamp, options, loc), date.toLocaleString(loc, options), JSON.stringify(options))
      }
    }
  }
})

test('date formats keep "Invalid Date" for an invalid stamp', () => {
  const invalid = new Date(Number.NaN)
  assert.equal(formatDateTime(Number.NaN, 'en-US'), invalid.toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' }))
  assert.equal(formatTimeFull(Number.NaN, 'en-US'), invalid.toLocaleTimeString('en-US'))
  assert.equal(formatDateParts(invalid, { month: 'numeric', day: 'numeric' }, 'zh-TW'), invalid.toLocaleString('zh-TW', { month: 'numeric', day: 'numeric' }))
})

test('number formats match the pre-refactor toLocaleString() expressions', () => {
  const options: ReadonlyArray<Intl.NumberFormatOptions | undefined> = [
    undefined,
    { maximumFractionDigits: 1 }, // PluginCatalog MB、usePluginPanelController
    { maximumFractionDigits: 0 }, // PluginCatalog KB
    { minimumFractionDigits: 1, maximumFractionDigits: 1 }, // SetupWizard 經過秒數
    { style: 'unit', unit: 'kilobyte', unitDisplay: 'short', maximumFractionDigits: 1 }, // usePluginPanelController
  ]
  for (const loc of LOCALES) {
    for (const value of [0, 1.25, 1234567.891, -3.05, Number.NaN]) {
      for (const option of options) {
        assert.equal(formatNumber(value, loc, option), value.toLocaleString(loc, option), `${loc} ${value} ${JSON.stringify(option)}`)
      }
    }
  }
  const tokens: ReadonlyArray<readonly [number, string, string]> = [
    [0, '0', '0'],
    [999, '999', '999'],
    [1_000, '1K', '1K'],
    [1_250, '1.3K', '1.3K'],
    [123_456, '123K', '123K'],
    [1_234_567, '1.2M', '1.2M'],
    [2_500_000_000, '2.5B', '2.5B'],
  ]
  for (const [value, zh, en] of tokens) {
    assert.equal(formatTokens(value, 'zh-TW'), zh)
    assert.equal(formatTokens(value, 'en-US'), en)
    assert.equal(formatTokens(value, 'en-US', 'full'), value.toLocaleString('en-US'))
  }
})

test('history axis labels match Intl.DateTimeFormat with the same options', () => {
  for (const loc of [...LOCALES, undefined]) {
    const noon = new Date('2026-11-02T12:00:00')
    assert.deepEqual(axisLabelParts('2026-11-02', true, loc), {
      date: new Intl.DateTimeFormat(loc, { month: 'numeric', day: 'numeric' }).format(noon),
      weekday: new Intl.DateTimeFormat(loc, { weekday: 'short' }).format(noon),
    })
    assert.equal(dayLabel('2026-11-02', true, loc), new Intl.DateTimeFormat(loc, { weekday: 'short', month: 'numeric', day: 'numeric' }).format(noon))
    assert.equal(dayLabel('2026-11-02', false, loc), new Intl.DateTimeFormat(loc, { month: 'numeric', day: 'numeric' }).format(noon))
  }
  assert.equal(dayLabel('not-a-date', true, 'en-US'), 'not-a-date')
})

test('formatters are created once per locale and options', () => {
  assert.equal(dateTimeFormatter('en-US', { month: 'numeric', day: 'numeric' }), dateTimeFormatter('en-US', { month: 'numeric', day: 'numeric' }))
  assert.notEqual(dateTimeFormatter('en-US', { month: 'numeric' }), dateTimeFormatter('zh-TW', { month: 'numeric' }))
  assert.notEqual(dateTimeFormatter('en-US', { month: 'numeric' }), dateTimeFormatter('en-US', { month: 'long' }))
  assert.notEqual(dateTimeFormatter(undefined), dateTimeFormatter('en-US'))
  assert.equal(numberFormatter('zh-TW', { maximumFractionDigits: 1 }), numberFormatter('zh-TW', { maximumFractionDigits: 1 }))
  assert.notEqual(numberFormatter('zh-TW'), numberFormatter('zh-TW', { maximumFractionDigits: 1 }))
})

test('durationParts options cover each breakdown', () => {
  assert.deepEqual(durationParts(90_061_500), { days: 1, hours: 1, minutes: 1, seconds: 1 })
  assert.deepEqual(durationParts(90_061_500, { largest: 'hour' }), { days: 0, hours: 25, minutes: 1, seconds: 1 })
  assert.deepEqual(durationParts(90_061_500, { largest: 'minute', rounding: 'ceil' }), { days: 0, hours: 0, minutes: 1501, seconds: 2 })
  assert.deepEqual(durationParts(30_000, HISTORY_DURATION), { days: 0, hours: 0, minutes: 1, seconds: 0 })
  assert.deepEqual(durationParts(30_000, { smallest: 'minute' }), { days: 0, hours: 0, minutes: 0, seconds: 0 })
})
