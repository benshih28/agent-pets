// 寵物狀態列的所有衍生資料：額度分級／百分比／提示列、寬度預算（字寬量測）、插件徽章取捨，
// 以及額度下降時的閃爍旗標。每條線一次算成 StatusLineView，模板只查表。
import { computed, onBeforeUnmount, onMounted, ref, watch, type ComputedRef } from 'vue'
import { useAgentStore } from '@/stores/agentStore'
import { isQuotaFamilyKey, type AgentState, type QuotaFamilyKey } from '@/types/agent'
import { t, tPlural } from '@/i18n'
import type { PluginBadgeView } from '@/types/plugin'
import { quotaWindowLabel, roundQuotaPercent } from '@/utils/format'
import { stateAriaLabel } from '@/utils/state-aria'
import { stateLineLabel } from '@/utils/agent-state-presentation'
import { statusLineText, type StatusLineSource } from '@/utils/session-attention'
import { fitStatusLine, statusLineContentWidth, STATUS_TEXT_FONTS, type MeasureText, type StatusLineFit, type StatusLinePart } from '@/utils/status-line-fit'
import { formatDateParts } from '@/utils/intl-format'
import { resolvedPetTheme } from '@/composables/useTheme'
import type { PluginBadgeSummary } from '@/composables/usePetPluginBadges'

// Quota 顏色由 CSS 依 data-quota-tier 選 token（PetStatusLine.css），插件主題可透過 --pet-status-* 重新上色一般與低額度填色（危急 < 20% 維持內建），也讓 token 檢查看得到用處。
export type QuotaTier = 'low' | 'warning' | 'claude' | 'normal'

// 額度充足時的顏色：Claude 用品牌 accent，其他家族用 sage。新增有額度的家族時這張表少一格就編譯失敗。
const QUOTA_FAMILY_TIER = Object.freeze({
  codex: 'normal',
  claude: 'claude',
} as const satisfies Record<QuotaFamilyKey, QuotaTier>)

export interface StatusLineSourceRow extends StatusLineSource {
  key: string
  state: AgentState
  petId: string
}

export interface QuotaWindowRowView {
  id: string
  label: string
  percentText: string
  resetLabel: string
}

export interface QuotaView {
  tier: QuotaTier | undefined
  /** 已四捨五入的百分比字串（不含 %）。 */
  percent: string
  remainingPercent: number
  meterLabel: string
  fillWidth: string
  rows: QuotaWindowRowView[]
}

export interface StatusLineView {
  text: string
  aria: string
  /** 沒有 Quota 提示框時的 title；含被寬度預算拿掉的徽章。 */
  title: string
  fit: StatusLineFit
  /** 寬度預算內放得下的徽章。 */
  badges: PluginBadgeView[]
  /** 「+N」的 N；放不下或沒有時為 0。 */
  overflowCount: number
  quota: QuotaView | null
}

export const EMPTY_STATUS_LINE_VIEW: StatusLineView = {
  text: '',
  aria: '',
  title: '',
  fit: { showLabel: true, showReadout: true, badgeCount: 0, showOverflow: false },
  badges: [],
  overflowCount: 0,
  quota: null,
}

// 以 canvas 量字寬（不觸發版面計算），結果依字串快取；字型載入完成或主題切換時清快取重算。
// 沒有 canvas 時的保守估計（每字 8px），寧可多拿掉東西也不讓狀態被截斷。
const STATUS_TEXT_FALLBACK_CHAR_W = 8
// 快取的鍵含插件徽章文字，數量沒有上限；超過時整批清掉重量（量一次只要微秒級）。
const STATUS_TEXT_CACHE_MAX = 256

function quotaResetLabel(resetsAt?: string): string {
  if (!resetsAt) return t('resetTimeUnavailable')
  const reset = new Date(resetsAt)
  if (!Number.isFinite(reset.getTime())) return t('resetTimeUnavailable')
  // No year: the longest quota window is 7 days out, so it carries no
  // information and is the single widest chunk of the tooltip.
  return t('resetAt', { time: formatDateParts(reset, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }) })
}

// 各家族的狀態列：畫面上是英文短字，提示框與可存取名稱是介面語言的完整文字。
// 沒有家族時的整體狀態列（Idle／Offline）只有英文狀態詞，提示與可存取名稱也用同一個字。
function lineText(line: StatusLineSource & { state: AgentState }): string {
  return statusLineText(line, line.label ? stateAriaLabel(line.state) : stateLineLabel(line.state))
}

/** 額度下降時的「受傷」閃爍旗標；見 flashDrain 的說明。 */
function useQuotaDrain() {
  const store = useAgentStore()
  // A quota drop is the pet "taking damage" — flash the meter for a moment so
  // a change that happened while you weren't looking still registers. Driven
  // by a class toggle (not a CSS transition) so consecutive drops re-run the
  // animation from the start instead of being swallowed mid-flight.
  const draining = ref<Record<string, boolean>>({})
  const drainTimers: Record<string, number> = {}
  const lastRemaining: Record<string, number> = {}

  function flashDrain(familyKey: string) {
    window.clearTimeout(drainTimers[familyKey])
    draining.value = { ...draining.value, [familyKey]: false }
    requestAnimationFrame(() => {
      draining.value = { ...draining.value, [familyKey]: true }
      drainTimers[familyKey] = window.setTimeout(() => {
        draining.value = { ...draining.value, [familyKey]: false }
      }, 700)
    })
  }

  watch(() => store.quotaByFamily, (quotas) => {
    for (const [familyKey, quota] of Object.entries(quotas)) {
      const previous = lastRemaining[familyKey]
      lastRemaining[familyKey] = quota.remainingPercent
      // Only a meaningful drop counts: refreshes that report the same number
      // (or a reset that refills the bar) shouldn't strobe the meter.
      if (previous !== undefined && quota.remainingPercent < previous - 0.05) {
        flashDrain(familyKey)
      }
    }
  }, { deep: true })

  onBeforeUnmount(() => {
    Object.values(drainTimers).forEach((timer) => window.clearTimeout(timer))
  })

  return draining
}

export function usePetStatusLines(options: {
  lines: () => ReadonlyArray<StatusLineSourceRow>
  isMultiPet: () => boolean
  badgeSummaryFor: (petId: string) => PluginBadgeSummary
  badgeTooltip: (badge: PluginBadgeView) => string
}): { views: ComputedRef<Record<string, StatusLineView>>, draining: ReturnType<typeof useQuotaDrain> } {
  const store = useAgentStore()
  const draining = useQuotaDrain()
  const fontEpoch = ref(0)
  const textWidths = new Map<string, number>()
  let textContext: CanvasRenderingContext2D | null | undefined
  let fontSpecs: Record<StatusLinePart, string> | null = null

  function fonts(): Record<StatusLinePart, string> {
    if (fontSpecs) return fontSpecs
    const root = getComputedStyle(document.documentElement)
    const token = (name: string, fallback: string) => root.getPropertyValue(name).trim() || fallback
    fontSpecs = Object.fromEntries(Object.entries(STATUS_TEXT_FONTS).map(([part, font]) => (
      [part, `${font.weight} ${token(font.sizeVar, font.sizeFallback)} ${token(font.familyVar, 'sans-serif')}`]
    ))) as Record<StatusLinePart, string>
    return fontSpecs
  }

  const measureText: MeasureText = (text, part) => {
    const cacheKey = `${part}\u0000${text}`
    const cached = textWidths.get(cacheKey)
    if (cached !== undefined) return cached
    if (textContext === undefined) textContext = document.createElement('canvas').getContext('2d')
    let width = Array.from(text).length * STATUS_TEXT_FALLBACK_CHAR_W
    if (textContext) {
      textContext.font = fonts()[part]
      width = textContext.measureText(text).width
    }
    if (textWidths.size >= STATUS_TEXT_CACHE_MAX) textWidths.clear()
    textWidths.set(cacheKey, width)
    return width
  }

  function resetMetrics() {
    textWidths.clear()
    fontSpecs = null
    fontEpoch.value += 1
  }

  onMounted(() => {
    document.fonts?.addEventListener('loadingdone', resetMetrics)
    void document.fonts?.ready.then(resetMetrics)
  })
  onBeforeUnmount(() => {
    document.fonts?.removeEventListener('loadingdone', resetMetrics)
  })
  watch(resolvedPetTheme, resetMetrics)

  function quotaTier(familyKey: string, remainingPercent: number): QuotaTier | undefined {
    if (!isQuotaFamilyKey(familyKey)) return undefined
    if (remainingPercent < 20) return 'low'
    if (remainingPercent < 50) return 'warning'
    return QUOTA_FAMILY_TIER[familyKey]
  }

  // provider 只在額度資料更新時索引一次，每條線不再掃整份清單。
  const providersById = computed(() => new Map<string, NonNullable<typeof store.quotaUsage>['providers'][number]>(
    (store.quotaUsage?.providers ?? []).map(provider => [provider.id, provider]),
  ))

  function quotaRows(familyKey: string): QuotaWindowRowView[] {
    const provider = providersById.value.get(familyKey)
    if (!provider) return []
    const primaryWindows = provider.windows.filter((window) => {
      const identity = `${window.id} ${window.label}`.toLowerCase()
      return identity.includes('session')
        || identity.includes('weekly')
        || identity.includes('five_hour')
        || identity.includes('seven_day')
    })
    return (primaryWindows.length > 0 ? primaryWindows : provider.windows).slice(0, 4).map(window => ({
      id: window.id,
      label: quotaWindowLabel(window.id, window.label),
      percentText: t('percentRemaining', { value: String(roundQuotaPercent(window.remainingPercent)) }),
      resetLabel: quotaResetLabel(window.resetsAt),
    }))
  }

  // 每條狀態列的文字、可存取名稱、寬度取捨、徽章與額度一次算好；模板只查表，
  // 不再於每次 render 對每條線重複過濾徽章、重組文字或掃描 provider。
  const views = computed<Record<string, StatusLineView>>(() => {
    void fontEpoch.value
    const lines = options.lines()
    const contentWidth = statusLineContentWidth(options.isMultiPet(), store.petScale, store.scaledW)
    const badgesByPet = new Map<string, PluginBadgeSummary>()
    const result: Record<string, StatusLineView> = {}
    for (const line of lines) {
      let summary = badgesByPet.get(line.petId)
      if (!summary) {
        summary = options.badgeSummaryFor(line.petId)
        badgesByPet.set(line.petId, summary)
      }
      const familyQuota = store.quotaByFamily[line.key]
      const percent = familyQuota ? String(roundQuotaPercent(familyQuota.remainingPercent)) : ''
      const rows = familyQuota ? quotaRows(line.key) : []
      const fit = fitStatusLine({
        contentWidth,
        label: line.label,
        state: stateLineLabel(line.state),
        readout: familyQuota ? `${percent}%` : null,
        badges: summary.badges.map(badge => badge.text),
        hiddenCount: summary.hiddenCount,
      }, measureText)
      const text = lineText(line)
      // 被拿掉的徽章與「+N」不能從可存取名稱裡消失。
      const dropped = summary.badges.slice(fit.badgeCount).map(options.badgeTooltip)
      if (!fit.showOverflow && summary.hiddenCount > 0) dropped.push(tPlural('pluginBadgeOverflow', summary.hiddenCount))
      const quotaTitle = rows.length > 0
        ? rows.map(row => `${row.label}：${row.percentText} · ${row.resetLabel}`).join('\n')
        : ''
      result[line.key] = {
        text,
        aria: [text, quotaTitle, ...dropped].filter(Boolean).join('\n'),
        title: [text, ...dropped].join('\n'),
        fit,
        badges: summary.badges.slice(0, fit.badgeCount),
        overflowCount: fit.showOverflow ? summary.hiddenCount : 0,
        quota: familyQuota ? {
          tier: quotaTier(line.key, familyQuota.remainingPercent),
          percent,
          remainingPercent: familyQuota.remainingPercent,
          meterLabel: t('quotaRemainingAria', { provider: line.label, quota: familyQuota.label }),
          fillWidth: `${familyQuota.remainingPercent}%`,
          rows,
        } : null,
      }
    }
    return result
  })

  return { views, draining }
}
