import assert from 'node:assert/strict'
import test from 'node:test'
import {
  forecastQuota, recordQuotaSample, QUOTA_SAMPLE_CAP, type QuotaSample, type QuotaSeries,
} from '../src/utils/quota-forecast.ts'

const MIN = 60_000
const T0 = Date.UTC(2026, 10, 10, 4, 0, 0)
const RESET = T0 + 5 * 60 * MIN

// 每 2 分鐘一筆、每筆增加 `step` 個百分點
function ramp(count: number, start: number, step: number): QuotaSample[] {
  return Array.from({ length: count }, (_, i) => ({ atMs: T0 + i * 2 * MIN, usedPercent: start + i * step }))
}
const nowOf = (samples: QuotaSample[]) => samples[samples.length - 1].atMs

test('too few samples or too short a span is insufficient, not a guess', () => {
  assert.deepEqual(forecastQuota([], RESET, T0), { kind: 'insufficient' })
  assert.deepEqual(forecastQuota(ramp(2, 10, 5), RESET, T0 + 2 * MIN), { kind: 'insufficient' })
  // 3 筆但跨度只有 4 分鐘
  assert.deepEqual(forecastQuota(ramp(3, 10, 5), RESET, T0 + 4 * MIN), { kind: 'insufficient' })
})

test('steady consumption projects an exhaust time before reset', () => {
  const samples = ramp(6, 10, 5) // 2.5%/min，最後 35% 於 T0+10min
  const result = forecastQuota(samples, RESET, nowOf(samples))
  assert.equal(result.kind, 'exhausts')
  if (result.kind === 'exhausts') assert.ok(Math.abs(result.exhaustAtMs - (T0 + 10 * MIN + 26 * MIN)) < 1_000)
})

test('slow consumption is safe and reports the projection at reset', () => {
  const samples = ramp(6, 10, 0.1)
  const result = forecastQuota(samples, RESET, nowOf(samples))
  assert.equal(result.kind, 'safe')
  if (result.kind === 'safe') assert.ok(result.projectedAtReset < 100 && result.projectedAtReset > 10)
})

test('zero or negative rate is idle (or the series is cut), never an exhaust time', () => {
  const flat = ramp(6, 40, 0)
  assert.deepEqual(forecastQuota(flat, RESET, nowOf(flat)), { kind: 'idle' })
  const falling = ramp(6, 40, -0.5) // 在容忍內的下降抖動
  const result = forecastQuota(falling, RESET, nowOf(falling))
  assert.ok(result.kind === 'idle' || result.kind === 'insufficient')
})

test('a usage drop splits the window: only the tail after it counts', () => {
  const before = ramp(4, 80, 5)
  const after = ramp(3, 5, 1).map(s => ({ ...s, atMs: s.atMs + 8 * 2 * MIN }))
  const samples = [...before, ...after]
  // 重置後只有 3 筆、跨度 4 分鐘，不夠
  assert.deepEqual(forecastQuota(samples, RESET, nowOf(samples)), { kind: 'insufficient' })
})

test('clock going backwards discards the stale prefix', () => {
  const good = ramp(5, 10, 3)
  const regress = [...good, { atMs: T0 + 1 * MIN, usedPercent: 40 }]
  assert.deepEqual(forecastQuota(regress, RESET, T0 + 3 * MIN), { kind: 'insufficient' })
})

test('depleted quota reports depleted regardless of rate', () => {
  const samples = ramp(6, 90, 2)
  assert.deepEqual(forecastQuota(samples, RESET, nowOf(samples)), { kind: 'depleted' })
  assert.deepEqual(forecastQuota([{ atMs: T0, usedPercent: 100 }], RESET, T0), { kind: 'depleted' })
})

test('missing, past or invalid reset time is insufficient', () => {
  const samples = ramp(6, 10, 5)
  const now = nowOf(samples)
  assert.deepEqual(forecastQuota(samples, null, now), { kind: 'insufficient' })
  assert.deepEqual(forecastQuota(samples, undefined, now), { kind: 'insufficient' })
  assert.deepEqual(forecastQuota(samples, now - 1, now), { kind: 'insufficient' })
  assert.deepEqual(forecastQuota(samples, Number.NaN, now), { kind: 'insufficient' })
})

test('NaN and Infinity never leak into a result', () => {
  const samples = ramp(6, 10, 5)
  assert.deepEqual(forecastQuota(samples, Infinity, nowOf(samples)), { kind: 'insufficient' })
  assert.deepEqual(forecastQuota(samples, RESET, Number.NaN), { kind: 'insufficient' })
  const poisoned = [...samples, { atMs: Number.NaN, usedPercent: 50 }]
  assert.deepEqual(forecastQuota(poisoned, RESET, nowOf(samples)), { kind: 'insufficient' })
  const inf = [...samples.slice(0, 5), { atMs: nowOf(samples), usedPercent: Infinity }]
  assert.deepEqual(forecastQuota(inf, RESET, nowOf(samples)), { kind: 'insufficient' })
})

test('a stale last reading is not extrapolated', () => {
  const samples = ramp(6, 10, 5)
  assert.deepEqual(forecastQuota(samples, RESET, nowOf(samples) + 30 * MIN), { kind: 'insufficient' })
})

test('exhaust time is never earlier than now', () => {
  const samples = ramp(6, 10, 5)
  const now = nowOf(samples) + 15 * MIN
  const result = forecastQuota(samples, RESET, now)
  assert.equal(result.kind, 'exhausts')
  if (result.kind === 'exhausts') assert.ok(result.exhaustAtMs >= now)
})

test('recordQuotaSample bounds the series and ignores duplicates', () => {
  const series: QuotaSeries = { resetsAtMs: null, samples: [] }
  for (let i = 0; i < QUOTA_SAMPLE_CAP * 3; i++) recordQuotaSample(series, { atMs: T0 + i * MIN, usedPercent: i % 50 }, RESET)
  assert.ok(series.samples.length <= QUOTA_SAMPLE_CAP)
  const length = series.samples.length
  assert.equal(recordQuotaSample(series, { ...series.samples[length - 1] }, RESET), false)
  assert.equal(series.samples.length, length)
})

test('recordQuotaSample clears on reset change, usage drop, clock regress; tolerates jitter', () => {
  const series: QuotaSeries = { resetsAtMs: null, samples: [] }
  recordQuotaSample(series, { atMs: T0, usedPercent: 10 }, RESET)
  recordQuotaSample(series, { atMs: T0 + 2 * MIN, usedPercent: 12 }, RESET + 30_000) // 秒級抖動
  assert.equal(series.samples.length, 2)
  recordQuotaSample(series, { atMs: T0 + 4 * MIN, usedPercent: 3 }, RESET) // 用量下降
  assert.equal(series.samples.length, 1)
  recordQuotaSample(series, { atMs: T0 + 6 * MIN, usedPercent: 5 }, RESET + 5 * 60 * MIN) // 新視窗
  assert.equal(series.samples.length, 1)
  recordQuotaSample(series, { atMs: T0 + 1 * MIN, usedPercent: 6 }, RESET + 5 * 60 * MIN) // 時鐘倒退
  assert.equal(series.samples.length, 1)
  assert.equal(recordQuotaSample(series, { atMs: Number.NaN, usedPercent: 1 }, null), false)
})

test('large sample counts stay linear and fast', () => {
  const samples = Array.from({ length: 200_000 }, (_, i) => ({ atMs: T0 + i * 1000, usedPercent: i / 4000 }))
  const result = forecastQuota(samples, T0 + 400_000 * 1000, nowOf(samples))
  assert.notEqual(result.kind, 'insufficient')
  // 線性時 200k 筆約 1～2 ms；退化成平方是 4×10¹⁰ 次運算，至少數十秒。單次 500 ms 的舊門檻在三個全量測試
  // 同時跑時曾被 GC 與 CPU 爭用打破（F2），所以取 3 次最快值、門檻放到 5 秒：仍與平方差兩個數量級以上。
  let best = Number.POSITIVE_INFINITY
  for (let run = 0; run < 3; run += 1) {
    const start = performance.now()
    forecastQuota(samples, T0 + 400_000 * 1000, nowOf(samples))
    best = Math.min(best, performance.now() - start)
  }
  assert.ok(best < 5_000, `200k samples took ${best.toFixed(1)} ms`)
})
