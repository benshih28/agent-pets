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
