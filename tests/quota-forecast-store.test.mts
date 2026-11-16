import assert from 'node:assert/strict'
import test from 'node:test'
import { createAgentStoreHarness, START_TIME } from './support/agent-store-harness.mts'
const { setLocale } = await import('../src/i18n.ts')
const { useQuotaFormat } = await import('../src/composables/useQuotaFormat.ts')

function usage(atMs: number, used: number, extra: Record<string, unknown> = {}) {
  return {
    updatedAt: new Date(atMs).toISOString(),
    providers: [{
      id: 'claude', name: 'Claude', fetchedAt: new Date(atMs).toISOString(),
      windows: [{ id: 'session', label: 'Session', usedPercent: used, remainingPercent: 100 - used, resetsAt: new Date(START_TIME + 5 * 3_600_000).toISOString() }],
      ...extra,
    }],
  }
}

test('store builds a forecast from consecutive quota updates and hides it until enough data', () => {
  const h = createAgentStoreHarness()
  try {
    const at = (min: number) => START_TIME + min * 60_000
    h.store.setQuotaUsage(usage(at(0), 10))
    assert.equal(h.store.quotaForecast('claude', 'session', at(0)).kind, 'insufficient')
    h.store.setQuotaUsage(usage(at(6), 20))
    h.store.setQuotaUsage(usage(at(12), 30))
    const forecast = h.store.quotaForecast('claude', 'session', at(12))
    assert.equal(forecast.kind, 'exhausts')
    // 用量下降（視窗重置）清空樣本
    h.store.setQuotaUsage(usage(at(14), 2))
    assert.equal(h.store.quotaForecast('claude', 'session', at(14)).kind, 'insufficient')
    // 錯誤的服務商與不存在的視窗不產生預測
    assert.equal(h.store.quotaForecast('claude', 'nope', at(14)).kind, 'insufficient')
  } finally { h.dispose() }
})

test('stale or errored providers do not add samples', () => {
  const h = createAgentStoreHarness()
  try {
    const at = (min: number) => START_TIME + min * 60_000
    h.store.setQuotaUsage(usage(at(0), 10))
    h.store.setQuotaUsage(usage(at(6), 20))
    h.store.setQuotaUsage(usage(at(12), 30, { stale: true, error: 'x' }))
    assert.equal(h.store.quotaForecast('claude', 'session', at(12)).kind, 'insufficient')
  } finally { h.dispose() }
})

test('forecast copy exists in both locales and covers each visible kind', () => {
  const { forecastText } = useQuotaFormat(() => START_TIME)
  for (const locale of ['zh-TW', 'en-US'] as const) {
    setLocale(locale)
    const key = (ms: number) => forecastText({ kind: 'exhausts', exhaustAtMs: START_TIME + ms })
    for (const text of [key(30_000), key(20 * 60_000), key(130 * 60_000), key(30 * 3_600_000), forecastText({ kind: 'safe', projectedAtReset: 50 }), forecastText({ kind: 'idle' })]) {
      assert.ok(text.length > 0 && !text.startsWith('growth.'), `${locale}: ${text}`)
    }
    assert.equal(forecastText({ kind: 'insufficient' }), '')
    assert.equal(forecastText({ kind: 'depleted' }), '')
  }
  setLocale('zh-TW')
  assert.ok(forecastText({ kind: 'exhausts', exhaustAtMs: START_TIME + 130 * 60_000 }).includes('2 小時 10 分'))
})
