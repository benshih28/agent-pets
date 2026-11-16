// 插件目錄（探索分頁）：載入、搜尋過濾與可更新項目索引。
//
// 契約：
// - 讀：onlineCatalogEnabled（未啟用不載入）；忙碌範圍 'catalog'；錯誤以 inline 的 catalogError 呈現。
// - 寫：只改自己的目錄狀態；安裝／更新由 usePluginInstall 讀取這裡的索引後處理。
import { computed, ref, type ComputedRef } from 'vue'
import { locale, t } from '@/i18n'
import type { PluginCatalogPanelItem } from '@/types/plugin-catalog'
import type { PluginBusyScopes, PluginPanelFeedback } from '@/composables/plugin/panel-deps'

export interface PluginCatalogDeps {
  onlineCatalogEnabled: ComputedRef<boolean>
  busy: Pick<PluginBusyScopes, 'isBusy' | 'setBusy'>
  feedback: Pick<PluginPanelFeedback, 'setStatus'>
}

export function usePluginCatalog(deps: PluginCatalogDeps) {
  const { onlineCatalogEnabled } = deps
  const { isBusy, setBusy } = deps.busy
  const { setStatus } = deps.feedback

  const catalogItems = ref<PluginCatalogPanelItem[]>([])
  const catalogCheckComplete = ref(false)
  const catalogLoadedAt = ref<number | null>(null)
  const catalogError = ref('')
  const catalogSearch = ref('')

  const catalogById = computed(() => new Map(catalogItems.value.map(item => [item.plugin.id, item])))
  const updatableItems = computed(() => catalogItems.value.filter(item => item.updateAvailable))
  // 已安裝清單的「有更新」過濾用它查成員，避免每次過濾都重掃目錄。
  const updatableIds = computed(() => new Set(updatableItems.value.map(item => item.plugin.id)))

  const filteredCatalogItems = computed(() => {
    const query = catalogSearch.value.trim().toLocaleLowerCase()
    if (!query) return catalogItems.value
    return catalogItems.value.filter(item => [
      item.plugin.id,
      item.plugin.name[locale.value],
      item.plugin.description[locale.value],
      item.plugin.author,
    ].some(value => value.toLocaleLowerCase().includes(query)))
  })

  function catalogItemFor(pluginId: string): PluginCatalogPanelItem | undefined {
    return catalogById.value.get(pluginId)
  }

  function resetCatalog(): void {
    catalogItems.value = []
    catalogCheckComplete.value = false
    catalogLoadedAt.value = null
  }

  // 目錄載入失敗以 inline 錯誤 + 重試呈現（catalogError），不再只丟 Toast。
  // silent：自動載入（進入探索分頁、背景同步）不顯示成功訊息。
  async function loadPluginCatalog(options: { silent?: boolean } = {}): Promise<void> {
    const scope = 'catalog'
    if (isBusy(scope) || !onlineCatalogEnabled.value) return
    setBusy(scope, true)
    catalogError.value = ''
    try {
      const result = await window.electronAPI?.listPluginCatalog()
      if (!result?.ok) {
        catalogError.value = result && !result.ok ? result.error : 'catalog_unavailable'
        return
      }
      catalogItems.value = result.value
      catalogCheckComplete.value = true
      catalogLoadedAt.value = Date.now()
      if (!options.silent) {
        setStatus(t('pluginCatalogChecked', {
          entries: String(result.value.length),
          updates: String(updatableItems.value.length),
        }))
      }
    } catch {
      catalogError.value = 'catalog_unavailable'
    } finally {
      setBusy(scope, false)
    }
  }

  // 進入探索分頁時：目錄已啟用且尚未載入才自動載入一次（已載入的結果沿用，使用者可手動重新檢查）。
  async function ensureCatalogLoaded(): Promise<void> {
    if (!onlineCatalogEnabled.value || catalogLoadedAt.value !== null || isBusy('catalog')) return
    await loadPluginCatalog({ silent: true })
  }

  return {
    catalogItems,
    catalogCheckComplete,
    catalogLoadedAt,
    catalogError,
    catalogSearch,
    updatableItems,
    updatableIds,
    filteredCatalogItems,
    catalogItemFor,
    resetCatalog,
    loadPluginCatalog,
    ensureCatalogLoaded,
  }
}
