// Plugin 面板各 composable 共用的依賴：忙碌範圍、refresh 協調、競態守衛與錯誤／成功通知。
// 控制器建立一份後以參數傳給各 composable；composable 之間不互相直接改對方的 ref，
// 需要跨功能的動作一律經過這裡的介面或控制器傳入的回呼。
import { computed, ref, type ComputedRef } from 'vue'
import { t, type TranslationKey } from '@/i18n'
import { lookupOwn } from '@/utils/own-lookup'
import type { PluginNotifyInput, PluginToastAction } from '@/composables/plugin/usePluginNotify'

// --- 忙碌範圍 -----------------------------------------------------------------

export function pluginScope(pluginId: string): string {
  return `plugin:${pluginId}`
}

export interface PluginBusyScopes {
  /** 非單一插件範圍（global / catalog / install）是否有工作進行中；各插件卡片請用 pluginBusy(id)。 */
  busy: ComputedRef<boolean>
  isBusy(scope: string): boolean
  pluginBusy(pluginId: string): boolean
  setBusy(scope: string, on: boolean): void
}

// 忙碌狀態依範圍計數（global / catalog / install / plugin:{id}），UI 只鎖住相關控制項。
export function createBusyScopes(): PluginBusyScopes {
  const busyCounts = ref(new Map<string, number>())
  const busy = computed(() => [...busyCounts.value.keys()].some(scope => !scope.startsWith('plugin:')))

  function isBusy(scope: string): boolean {
    return busyCounts.value.has(scope)
  }

  function pluginBusy(pluginId: string): boolean {
    return busyCounts.value.has(pluginScope(pluginId)) || busyCounts.value.has('global')
  }

  function setBusy(scope: string, on: boolean): void {
    const next = new Map(busyCounts.value)
    const count = (next.get(scope) ?? 0) + (on ? 1 : -1)
    if (count > 0) next.set(scope, count)
    else next.delete(scope)
    busyCounts.value = next
  }

  return { busy, isBusy, pluginBusy, setBusy }
}

// --- Refresh 協調 --------------------------------------------------------------

/**
 * 進行中又被呼叫時不重複送出，而是排成「結尾再跑一次」（以 trailing 參數）。
 * 被排隊的呼叫立即返回，不等結尾那一次完成（面板快照一直是這個語意）。
 */
export function createQueuedRefresh<Options>(
  run: (options?: Options) => Promise<void>,
  trailing: Options,
): (options?: Options) => Promise<void> {
  let inFlight = false
  let queued = false
  return async function request(options?: Options): Promise<void> {
    if (inFlight) {
      queued = true
      return
    }
    inFlight = true
    try {
      await run(options)
    } finally {
      inFlight = false
      if (queued) {
        queued = false
        void request(trailing)
      }
    }
  }
}

/**
 * 同一時間的重複請求合併：進行中再被呼叫時，所有後到的呼叫共用「結尾再跑一次」，
 * 並等到那一次完成才返回，所以呼叫者 await 之後看到的一定是最新結果，
 * 而且較舊的回應不會在較新的之後才寫入（一次只有一個請求在途中）。
 */
export function createCoalescedRefresh(run: () => Promise<void>): () => Promise<void> {
  let inFlight: Promise<void> | null = null
  let trailing: Promise<void> | null = null
  function start(): Promise<void> {
    const current = run().finally(() => {
      if (inFlight === current) inFlight = null
    })
    inFlight = current
    return current
  }
  return function request(): Promise<void> {
    if (!inFlight) return start()
    trailing ??= inFlight.then(() => undefined, () => undefined).then(() => {
      trailing = null
      return start()
    })
    return trailing
  }
}

// --- 競態守衛 -----------------------------------------------------------------

export interface LatestRequest {
  /** 開始一個新請求並作廢先前的所有請求，回傳新請求的序號。 */
  next(): number
  /** 作廢所有進行中的請求（例如關閉或卸載）。 */
  invalidate(): void
  /** 目前最新的序號；請求開始時記下，回應回來時以 isCurrent 判斷是否仍有效。 */
  current(): number
  isCurrent(sequence: number): boolean
}

/** 非同步回應只在它仍是最新請求時才寫入狀態，較舊的回應不得覆蓋較新的狀態。 */
export function createLatestRequest(): LatestRequest {
  let sequence = 0
  return {
    next: () => ++sequence,
    invalidate: () => { sequence += 1 },
    current: () => sequence,
    isCurrent: value => value === sequence,
  }
}

// --- 錯誤與成功通知 -------------------------------------------------------------

// 主程序回傳的錯誤碼 → 面板文字。以 lookupOwn 查表，`constructor` 之類的原型名稱不會被當成 key。
const PLUGIN_ERROR_COPY = {
  disabled: 'pluginPanelUnavailable',
  host_unavailable: 'pluginCommandHostUnavailable',
  not_permitted: 'pluginCommandNotPermitted',
  rate_limited: 'pluginCommandRateLimited',
  panel_unavailable: 'pluginPanelViewUnavailable',
  panel_load_failed: 'pluginPanelViewLoadFailed',
  panel_crashed: 'pluginPanelViewCrashed',
  panel_closed: 'pluginPanelViewClosed',
  preferences_unsafe: 'pluginPreferencesUnsafe',
  plugin_service_unavailable: 'pluginServiceUnavailable',
  archive_too_large: 'pluginArchiveTooLarge',
  signature_invalid: 'pluginSignatureInvalid',
  signature_confirmation_required: 'pluginSignatureConfirmationRequired',
  invalid_archive: 'pluginInvalidArchive',
  invalid_manifest: 'pluginInvalidArchive',
  invalid_panel_theme: 'plugins.errInvalidPanelTheme',
  incompatible: 'pluginIncompatible',
  permission_reconsent_required: 'pluginReconsentRequired',
  filesystem_unsafe: 'pluginFilesystemUnsafe',
  plan_not_found: 'pluginPlanExpired',
  plugin_not_found: 'pluginNotFound',
  report_unavailable: 'pluginReportUnavailable',
  invalid_request: 'plugins.errInvalidRequest',
  secret_unavailable: 'pluginSecretUnavailable',
  secret_not_found: 'pluginSecretNotFound',
  secret_consent_required: 'pluginSecretConsentRequired',
  settings_invalid: 'pluginSettingsInvalid',
  dialog_unavailable: 'plugins.errDialogUnavailable',
  install_failed: 'plugins.errInstallFailed',
  registry_unavailable: 'plugins.errRegistryUnavailable',
  catalog_disabled: 'pluginCatalogDisabledError',
  catalog_url_invalid: 'pluginCatalogUrlInvalid',
  catalog_unavailable: 'pluginCatalogUnavailable',
  catalog_not_found: 'pluginCatalogNotFound',
  catalog_invalid: 'pluginCatalogInvalid',
  download_mismatch: 'pluginCatalogDownloadMismatch',
  signature_mismatch: 'pluginCatalogSignatureMismatch',
  plugin_not_in_catalog: 'pluginCatalogUnavailable',
  host_not_allowed: 'pluginCatalogHostNotAllowed',
} as const satisfies Record<string, TranslationKey>

export interface PluginPanelFeedback {
  notify(input: PluginNotifyInput): number
  localizedError(code: string): string
  /** 錯誤一律只帶錯誤碼（與開發者模式安裝的已清理提示），不帶使用者輸入的值。 */
  setError(code: string, retry?: () => void, diagnostic?: string): void
  setStatus(text: string, action?: PluginToastAction): void
}

export function createPluginPanelFeedback(
  notify: (input: PluginNotifyInput) => number,
  maxEnabledPlugins: () => number,
): PluginPanelFeedback {
  function localizedError(code: string): string {
    if (code === 'too_many_enabled') return t('pluginTooManyEnabled', { limit: String(maxEnabledPlugins()) })
    return t(lookupOwn(PLUGIN_ERROR_COPY, code) ?? 'pluginActionFailed')
  }

  function setError(code: string, retry?: () => void, diagnostic?: string): void {
    notify({
      tone: 'error',
      text: localizedError(code),
      // 開發者模式安裝會從主程序帶入經清理的作者提示（<= 200 字元）。
      detail: diagnostic ? `${code}: ${diagnostic}` : code,
      action: retry ? { label: t('plugins.retry'), run: retry } : undefined,
    })
  }

  function setStatus(text: string, action?: PluginToastAction): void {
    notify({ tone: 'success', text, action })
  }

  return { notify, localizedError, setError, setStatus }
}
