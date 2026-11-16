// Quota（訂閱額度）：主程序查詢、renderer 只保存「已驗證過」的快照並提供各家族的額度條資料。
//
// - 事件輸入：`refreshQuota()`（App.vue 的輪詢與面板的手動刷新）、`setQuotaUsage()`（主程序廣播）、
//   `quotaStaleSignal`（由 session 模組在 Codex/Claude 進入終態時遞增，App.vue 監聽後排一次延後刷新）。
// - 計時器：無；輪詢與延後刷新的計時器在 App.vue，這裡只匯出 `QUOTA_*_MS` 常數。
// - storage：無。
// - 跨視窗同步：不同步；每個視窗各自向主程序取（主程序有 TTL 快取）。
import { computed, ref, shallowRef } from 'vue'
import { t, translateBackendError } from '@/i18n'
import { isQuotaFamilyKey } from '@/types/agent'
import { forecastQuota, recordQuotaSample, type QuotaForecast, type QuotaSeries } from '@/utils/quota-forecast'

// Kept at/below the main process' quota cache TTL so a poll that arrives on
// schedule actually reaches the usage API instead of being answered from a
// still-warm cache — otherwise the two throttles stack and the meter lags by
// up to twice this interval.
export const QUOTA_REFRESH_MS = 2 * 60_000
// A session that just finished has spent quota the usage API needs a moment
// to account for, so settle before asking rather than re-reading a stale
// number and then waiting a full poll interval for the real one. This is what
// actually keeps the meter current; the interval above is only a backstop.
export const QUOTA_SETTLE_DELAY_MS = 8_000
// Floor between two session-driven refreshes, so a batch of agents finishing
// one after another can't turn the settle hook into a tight polling loop.
export const QUOTA_SETTLE_MIN_INTERVAL_MS = 45_000
const MAX_QUOTA_WINDOWS = 32
const MAX_QUOTA_TEXT_LENGTH = 96

type QuotaUsage = Awaited<ReturnType<NonNullable<Window['electronAPI']>['getQuotaUsage']>>
type QuotaProviderErrorKind = NonNullable<QuotaUsage['providers'][number]['errorKind']>
const QUOTA_ERROR_KINDS = new Set<string>(['not-signed-in', 'expired', 'timeout', 'rate-limited', 'unavailable'])

function normalizeQuotaUsage(value: unknown): QuotaUsage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (typeof raw.updatedAt !== 'string' || !Number.isFinite(Date.parse(raw.updatedAt))) return null
  if (!Array.isArray(raw.providers)) return null

  const providers: QuotaUsage['providers'] = []
  const seen = new Set<string>()
  for (const candidate of raw.providers.slice(0, 2)) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    const provider = candidate as Record<string, unknown>
    if (!isQuotaFamilyKey(provider.id) || seen.has(provider.id)) continue
    if (typeof provider.name !== 'string' || !Array.isArray(provider.windows)) continue
    const windows: QuotaUsage['providers'][number]['windows'] = []
    for (const candidateWindow of provider.windows.slice(0, MAX_QUOTA_WINDOWS)) {
      if (!candidateWindow || typeof candidateWindow !== 'object' || Array.isArray(candidateWindow)) continue
      const window = candidateWindow as Record<string, unknown>
      if (typeof window.id !== 'string' || typeof window.label !== 'string') continue
      if (typeof window.usedPercent !== 'number' || !Number.isFinite(window.usedPercent)) continue
      if (typeof window.remainingPercent !== 'number' || !Number.isFinite(window.remainingPercent)) continue
      // Clamp rather than drop: an over-quota reading must show as exhausted.
      const usedPercent = Math.min(100, Math.max(0, window.usedPercent))
      const remainingPercent = Math.min(100, Math.max(0, window.remainingPercent))
      const resetsAt = typeof window.resetsAt === 'string' && Number.isFinite(Date.parse(window.resetsAt))
        ? new Date(window.resetsAt).toISOString()
        : undefined
      windows.push({
        id: window.id.slice(0, MAX_QUOTA_TEXT_LENGTH),
        label: window.label.slice(0, MAX_QUOTA_TEXT_LENGTH),
        usedPercent,
        remainingPercent,
        ...(window.overage === true || window.usedPercent > 100 ? { overage: true } : {}),
        ...(resetsAt ? { resetsAt } : {}),
      })
    }
    seen.add(provider.id)
    providers.push({
      id: provider.id,
      name: provider.name.slice(0, MAX_QUOTA_TEXT_LENGTH),
      ...(typeof provider.plan === 'string' ? { plan: provider.plan.slice(0, MAX_QUOTA_TEXT_LENGTH) } : {}),
      windows,
      ...(typeof provider.error === 'string' ? { error: provider.error.slice(0, 240) } : {}),
      ...(QUOTA_ERROR_KINDS.has(provider.errorKind as string) ? { errorKind: provider.errorKind as QuotaProviderErrorKind } : {}),
      ...(typeof provider.fetchedAt === 'string' && Number.isFinite(Date.parse(provider.fetchedAt))
        ? { fetchedAt: new Date(provider.fetchedAt).toISOString() }
        : {}),
      ...(provider.stale === true ? { stale: true } : {}),
    })
  }
  return { updatedAt: new Date(raw.updatedAt).toISOString(), providers }
}

export function useQuota() {
  // shallowRef: quotaUsage is always replaced wholesale (never mutated via a
  // nested property write), so deep reactivity tracking on its providers/
  // windows arrays would just be wasted work on every quota refresh.
  const quotaUsage = shallowRef<QuotaUsage | null>(null)
  const quotaLoading = ref(false)
  const quotaError = ref('')
  // Seconds a forced refresh must wait (cooldown answer from the main
  // process), or null. Lets the UI say "wait N s" instead of silently no-op.
  const quotaThrottleSec = ref<number | null>(null)
  // When the last refresh request completed (ms), for "next auto refresh".
  const quotaCheckedAt = ref(0)
  // Bumped whenever a Codex/Claude session reaches a terminal state, i.e.
  // right after quota was actually spent. App.vue watches this and schedules
  // one settled refresh, so the meter tracks real usage instead of only the
  // fixed poll interval.
  const quotaStaleSignal = ref(0)
  let quotaRequestedAt = 0

  // Built-in pets ship as bundled assets, so "removing" one just hides it

  const quotaByFamily = computed<Record<string, { label: string; remainingPercent: number; resetsAt?: string }>>(() => {
    const result: Record<string, { label: string; remainingPercent: number; resetsAt?: string }> = {}
    for (const provider of quotaUsage.value?.providers ?? []) {
      if (provider.error || !isQuotaFamilyKey(provider.id)) continue
      // Prefer the short session window. Some Codex accounts currently only
      // receive a weekly window, so fall back instead of hiding the meter.
      const quotaWindow = provider.windows.find(
        (window) => window.id === 'session' || window.label.toLowerCase() === 'session',
      ) ?? provider.windows.find(
        (window) => window.id === 'weekly' || window.label.toLowerCase() === 'weekly',
      ) ?? provider.windows[0]
      if (!quotaWindow || !Number.isFinite(quotaWindow.remainingPercent)) continue
      result[provider.id] = {
        label: quotaWindow.label,
        remainingPercent: Math.max(0, Math.min(100, quotaWindow.remainingPercent)),
        ...(quotaWindow.resetsAt ? { resetsAt: quotaWindow.resetsAt } : {}),
      }
    }
    return result
  })

  // 近期用量樣本（每個「服務商:視窗」各一條，有界）。只存在 renderer 記憶體，不另開 IPC；
  // 面板隱藏時仍會收到寵物視窗輪詢後的廣播，renderer 重新載入才會從零累積。
  const quotaSeries = new Map<string, QuotaSeries>()

  function recordSamples(usage: QuotaUsage): void {
    const live = new Set<string>()
    for (const provider of usage.providers) {
      for (const window of provider.windows) {
        const key = `${provider.id}:${window.id}`
        live.add(key)
        // 出錯或沿用舊讀數時沒有新資料；重複記同一筆只會讓斜率偏向舊值。
        if (provider.error || provider.stale) continue
        let series = quotaSeries.get(key)
        if (!series) {
          series = { resetsAtMs: null, samples: [] }
          quotaSeries.set(key, series)
        }
        recordQuotaSample(
          series,
          { atMs: Date.parse(provider.fetchedAt ?? usage.updatedAt), usedPercent: window.usedPercent },
          window.resetsAt ? Date.parse(window.resetsAt) : null,
        )
      }
    }
    for (const key of quotaSeries.keys()) if (!live.has(key)) quotaSeries.delete(key)
  }

  // 依 quotaUsage 讀 resetsAt，所以在 computed 內呼叫時會跟著額度更新重算。
  function quotaForecast(providerId: string, windowId: string, nowMs: number): QuotaForecast {
    const provider = quotaUsage.value?.providers.find(candidate => candidate.id === providerId)
    const window = provider?.windows.find(candidate => candidate.id === windowId)
    const series = quotaSeries.get(`${providerId}:${windowId}`)
    if (!provider || !window || !series || provider.error) return { kind: 'insufficient' }
    return forecastQuota(series.samples, window.resetsAt ? Date.parse(window.resetsAt) : null, nowMs)
  }

  function setQuotaUsage(usage: unknown): boolean {
    const normalized = normalizeQuotaUsage(usage)
    if (!normalized) return false
    recordSamples(normalized)
    quotaUsage.value = normalized
    quotaError.value = ''
    return true
  }

  async function refreshQuota(force = false) {
    if (!window.electronAPI?.getQuotaUsage || quotaLoading.value) return quotaUsage.value
    const now = Date.now()
    if (!force && quotaUsage.value && now - quotaRequestedAt < QUOTA_REFRESH_MS) return quotaUsage.value
    quotaLoading.value = true
    quotaError.value = ''
    quotaThrottleSec.value = null
    quotaRequestedAt = now
    try {
      const usage = await window.electronAPI.getQuotaUsage(force)
      const throttled = (usage as { throttled?: { retryInSec?: unknown } } | null)?.throttled?.retryInSec
      if (typeof throttled === 'number' && Number.isFinite(throttled)) quotaThrottleSec.value = Math.max(1, Math.round(throttled))
      if (!setQuotaUsage(usage)) {
        quotaError.value = 'Quota service returned invalid data.'
      }
      quotaCheckedAt.value = Date.now()
      return quotaUsage.value
    } catch (error) {
      quotaError.value = translateBackendError(error instanceof Error ? error.message : t('quotaLoadFailed'))
      return quotaUsage.value
    } finally {
      quotaLoading.value = false
    }
  }

  return {
    quotaUsage,
    quotaLoading,
    quotaError,
    quotaThrottleSec,
    quotaCheckedAt,
    quotaByFamily,
    quotaStaleSignal,
    quotaForecast,
    setQuotaUsage,
    refreshQuota,
  }
}
