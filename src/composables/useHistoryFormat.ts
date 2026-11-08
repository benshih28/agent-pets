import { locale, t } from '@/i18n'
import { durationParts, formatTokens, type TokenFormatMode } from '@/utils/token-format'

// One place for how History numbers and durations read, so the stat tiles,
// chart, tooltips and agent list never disagree.
export function useHistoryFormat() {
  function tokens(value: number, mode: TokenFormatMode = 'compact'): string {
    return formatTokens(value, locale.value, mode)
  }

  function duration(ms: number): string {
    const { days, hours, minutes } = durationParts(ms)
    if (days > 0) return t('growth.durationDays', { days, hours })
    if (hours > 0) return t('growth.durationHours', { hours, minutes })
    return t('growth.durationMinutes', { minutes })
  }

  return { tokens, duration }
}
