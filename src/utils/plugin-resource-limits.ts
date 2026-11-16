// 插件資源上限的顯示單位：每個欄位一列，輸入換算（位元組欄位以 KB 輸入）與範圍文字都從這張表推導。
// 範圍本身的驗證與套用仍在主程序。
import { locale, t } from '@/i18n'
import type { PluginResourceLimits } from '@/types/plugin'
import { formatNumber } from '@/utils/intl-format'

type ResourceUnit = 'count' | 'megabytes' | 'bytes' | 'seconds' | 'perMinute' | 'perTenMinutes'

export const PLUGIN_RESOURCE_UNITS = {
  maxEnabledPlugins: 'count',
  memoryMbPerPlugin: 'megabytes',
  netMaxResponseBytes: 'bytes',
  netTimeoutSeconds: 'seconds',
  netRequestsPerMinute: 'perMinute',
  storageBytesPerPlugin: 'bytes',
  globalFeedPer10Min: 'perTenMinutes',
  scheduleMinIntervalSeconds: 'seconds',
} as const satisfies Record<keyof PluginResourceLimits, ResourceUnit>

const KIB = 1024
const MIB = 1024 * 1024

function inputScale(key: keyof PluginResourceLimits): number {
  return PLUGIN_RESOURCE_UNITS[key] === 'bytes' ? KIB : 1
}

/** 輸入框的數字 → 要送給主程序的值。 */
export function resourceValueFromInput(key: keyof PluginResourceLimits, parsed: number): number {
  return parsed * inputScale(key)
}

/** 目前的值 → 輸入框顯示的數字。 */
export function resourceInputValue(key: keyof PluginResourceLimits, value: number): string {
  return String(value / inputScale(key))
}

export function resourceBoundText(key: keyof PluginResourceLimits, value: number): string {
  const number = (amount: number) => formatNumber(amount, locale.value, { maximumFractionDigits: 1 })
  const unit = (amount: number, name: 'megabyte' | 'kilobyte') =>
    formatNumber(amount, locale.value, { style: 'unit', unit: name, unitDisplay: 'short', maximumFractionDigits: 1 })
  switch (PLUGIN_RESOURCE_UNITS[key]) {
    case 'megabytes': return unit(value, 'megabyte')
    case 'bytes': return value % MIB === 0 ? unit(value / MIB, 'megabyte') : unit(value / KIB, 'kilobyte')
    case 'seconds': return t('plugins.unitSeconds', { value: number(value) })
    case 'perMinute': return t('plugins.unitPerMinute', { value: number(value) })
    case 'perTenMinutes': return t('plugins.unitPerTenMinutes', { value: number(value) })
    case 'count': return number(value)
  }
}
