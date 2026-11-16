import { locale, t } from '@/i18n'
import { roundQuotaPercent } from '@/utils/format'
import type { QuotaForecast } from '@/utils/quota-forecast'
import { quotaTone, relativeAge, resetCountdown, type QuotaTone } from '@/utils/quota-math'
import { formatDateParts, formatTime } from '@/utils/intl-format'

// Shared by the Usage tab and the Sessions quota strip so reset countdowns,
// percentage text and low-quota tones can never drift apart again.
export function useQuotaFormat(now: () => number) {
  function quotaPercent(value: number): string {
    return `${roundQuotaPercent(value)}%`
  }

  function formatReset(timestamp?: string): string {
    const countdown = resetCountdown(timestamp, now())
    switch (countdown.kind) {
      case 'unavailable': return t('resetTimeUnavailable')
      case 'soon': return t('growth.resetSoon')
      case 'minutes': return t('resetsInMinutes', { minutes: countdown.minutes })
      case 'hours': return t('resetsInHours', { hours: countdown.hours, minutes: countdown.minutes })
      case 'days': return t('resetsInDays', { days: countdown.days, hours: countdown.hours })
    }
  }

  // Short absolute time ("Wed 14:30 GMT+8"): weekday and time-of-day only
  // within a week, otherwise month/day too; never the year.
  function formatResetAt(timestamp?: string): string {
    if (!timestamp) return ''
    const reset = new Date(timestamp)
    if (!Number.isFinite(reset.getTime())) return ''
    const withinWeek = reset.getTime() - now() < 6 * 24 * 3_600_000
    return formatDateParts(reset, {
      ...(withinWeek ? { weekday: 'short' } : { month: 'numeric', day: 'numeric' }),
      hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    }, locale.value)
  }

  function formatClock(timestamp: string | number): string {
    return formatTime(new Date(timestamp), locale.value)
  }

  function formatAge(pastMs: number): string {
    const age = relativeAge(pastMs, now())
    switch (age.kind) {
      case 'now': return t('growth.ageNow')
      case 'minutes': return t('growth.ageMinutes', { minutes: age.minutes })
      case 'hours': return t('growth.ageHours', { hours: age.hours })
      case 'days': return t('growth.ageDays', { days: age.days })
    }
  }

  function usedRemaining(usedPercent: number, remainingPercent: number): string {
    return t('growth.quotaUsedRemaining', {
      used: quotaPercent(usedPercent),
      remaining: quotaPercent(remainingPercent),
    })
  }

  function toneLabel(tone: QuotaTone, overage = false): string {
    if (overage) return t('growth.quotaOverage')
    if (tone === 'critical') return t('growth.quotaCritical')
    if (tone === 'warn') return t('growth.quotaLow')
    return ''
  }

  // 預測文案：資料不足與已用完不回傳文字（用完已有獨立警示），避免顯示猜測值。
  function forecastText(forecast: QuotaForecast): string {
    switch (forecast.kind) {
      case 'idle': return t('growth.forecastIdle')
      case 'safe': return t('growth.forecastSafe')
      case 'exhausts': {
        const countdown = resetCountdown(new Date(forecast.exhaustAtMs).toISOString(), now())
        switch (countdown.kind) {
          case 'minutes': return t('growth.forecastMinutes', { minutes: countdown.minutes })
          case 'hours': return t('growth.forecastHours', { hours: countdown.hours, minutes: countdown.minutes })
          case 'days': return t('growth.forecastDays', { days: countdown.days, hours: countdown.hours })
          default: return t('growth.forecastSoon')
        }
      }
      default: return ''
    }
  }

  return { forecastText, quotaPercent, formatReset, formatResetAt, formatClock, formatAge, usedRemaining, quotaTone, toneLabel }
}
