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

// 顏色由 CSS 依 data-quota-tier 選 token；插件主題可用 --pet-status-* 重新上色一般與低額度填色（危急 < 20% 維持內建）。
export type QuotaTier = 'low' | 'warning' | 'claude' | 'normal'

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
  percent: string
  remainingPercent: number
  meterLabel: string
  fillWidth: string
  rows: QuotaWindowRowView[]
}

export interface StatusLineView {
  text: string
  aria: string
  /** 含被寬度預算拿掉的徽章。 */
  title: string
  fit: StatusLineFit
  badges: PluginBadgeView[]
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

// 沒有 canvas 時的保守估計：寧可多拿掉徽章也不讓狀態被截斷。
const STATUS_TEXT_FALLBACK_CHAR_W = 8
// 快取鍵含插件徽章文字、數量無上限，超過就整批清掉。
const STATUS_TEXT_CACHE_MAX = 256

function quotaResetLabel(resetsAt?: string): string {
  if (!resetsAt) return t('resetTimeUnavailable')
  const reset = new Date(resetsAt)
  if (!Number.isFinite(reset.getTime())) return t('resetTimeUnavailable')
  return t('resetAt', { time: formatDateParts(reset, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }) })
}

// 有家族標籤時，提示與可存取名稱用介面語言的完整文字；整體狀態列（Idle／Offline）則沿用英文狀態詞。
function lineText(line: StatusLineSource & { state: AgentState }): string {
  return statusLineText(line, line.label ? stateAriaLabel(line.state) : stateLineLabel(line.state))
}

function useQuotaDrain() {
  const store = useAgentStore()
  // class toggle 而非 CSS transition：連續下降才會從頭重播動畫。
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
      // 同值刷新或重置補滿不算下降，避免閃爍。
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
