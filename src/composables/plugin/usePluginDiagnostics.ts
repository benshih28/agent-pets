// 詳情頁的診斷：broker 日誌、被拒絕的呼叫，以及給人看的文字。
//
// 契約：
// - 讀：目前選取的插件 id 與資源上限（控制器擁有），不寫入它們；換插件時由控制器呼叫 refreshDiagnostics。
// - 競態：每次載入都作廢先前的載入，較舊的回應不會覆蓋目前插件的診斷。
// - 原始的 method／code 只放在 diagnosticTechnical，由畫面收在 title 與技術細節。
import { ref, type Ref } from 'vue'
import { locale, t, type TranslationKey } from '@/i18n'
import type { PluginBrokerDiagnostic, PluginBrokerLogEntry } from '@/types/plugin'
import { formatDateParts } from '@/utils/intl-format'
import { lookupOwn } from '@/utils/own-lookup'
import { createLatestRequest, type PluginPanelFeedback } from '@/composables/plugin/panel-deps'

export interface PluginDiagnosticsDeps {
  selectedPluginId: Readonly<Ref<string>>
  maxEnabledPlugins(): number
  feedback: Pick<PluginPanelFeedback, 'setError'>
}

const REJECTION_REASONS = {
  not_permitted: 'plugins.reasonNotPermitted',
  rate_limited: 'plugins.reasonRateLimited',
  disabled: 'plugins.reasonDisabled',
} as const satisfies Record<string, TranslationKey>

export function usePluginDiagnostics(deps: PluginDiagnosticsDeps) {
  const { selectedPluginId, maxEnabledPlugins } = deps
  const { setError } = deps.feedback

  const logs = ref<PluginBrokerLogEntry[]>([])
  const diagnostics = ref<PluginBrokerDiagnostic[]>([])
  const diagnosticsLoad = createLatestRequest()

  async function refreshDiagnostics(pluginId = selectedPluginId.value): Promise<void> {
    const request = diagnosticsLoad.next()
    logs.value = []
    diagnostics.value = []
    if (!pluginId) return
    try {
      const result = await window.electronAPI?.getPluginDiagnostics(pluginId)
      if (!diagnosticsLoad.isCurrent(request)) return
      if (result?.ok) {
        logs.value = result.value.logs
        diagnostics.value = result.value.diagnostics
      } else if (result && !result.ok) setError(result.error)
    } catch {
      if (diagnosticsLoad.isCurrent(request)) setError('plugin_action_failed')
    }
  }

  function diagnosticTime(timestamp: number): string {
    return formatDateParts(timestamp, { hour: '2-digit', minute: '2-digit', second: '2-digit' }, locale.value)
  }

  function diagnosticCodeLabel(item: PluginBrokerDiagnostic): string {
    if (item.code === 'host_unavailable') return t('pluginHostUnavailableTitle')
    if (item.code === 'too_many_enabled') {
      if (item.method === 'plugin.tray') return t('pluginTrayOverflowDiagnostic')
      return t('pluginTooManyEnabled', { limit: String(maxEnabledPlugins()) })
    }
    return t('plugins.diagnosticRejectedHuman', { reason: t(lookupOwn(REJECTION_REASONS, item.code) ?? 'plugins.reasonOther') })
  }

  function diagnosticTechnical(item: PluginBrokerDiagnostic): string {
    return item.method ? `${item.code} · ${item.method}` : item.code
  }

  return {
    logs,
    diagnostics,
    refreshDiagnostics,
    diagnosticTime,
    diagnosticCodeLabel,
    diagnosticTechnical,
  }
}
