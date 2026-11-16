// 已安裝清單：搜尋、篩選與狀態排序，以及插件名稱／圖示／狀態的顯示 helper。
//
// 契約：
// - 讀：plugins、enabledGlobally、snapshot（圖示是否允許載入）、updatableIds（「有更新」篩選）。
// - 排序：需要處理的插件（崩潰、不相容）置頂；其餘維持快照順序（穩定排序）。
import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { locale, t } from '@/i18n'
import type { PluginPanelPlugin, PluginPanelSnapshot } from '@/types/plugin'
import { isKeyFingerprint } from '@/types/id-patterns'
import { resolvePluginIconUrl } from '@/utils/plugin-icon'

export type PluginInstalledFilter = 'all' | 'enabled' | 'updates' | 'issues'

export interface PluginInstalledListDeps {
  snapshot: Ref<PluginPanelSnapshot | null>
  plugins: ComputedRef<PluginPanelPlugin[]>
  enabledGlobally: ComputedRef<boolean>
  updatableIds: ComputedRef<Set<string>>
}

export function pluginDisplayName(plugin: PluginPanelPlugin): string {
  return plugin.manifest?.name[locale.value] ?? plugin.id
}

export function usePluginInstalledList(deps: PluginInstalledListDeps) {
  const { snapshot, plugins, enabledGlobally, updatableIds } = deps

  const installedSearch = ref('')
  const installedFilter = ref<PluginInstalledFilter>('all')
  const failedPluginIconIds = ref(new Set<string>())

  function pluginStatusLabel(plugin: PluginPanelPlugin): string {
    if (plugin.status === 'disabled_crashed') return t('pluginStatusCrashed')
    if (plugin.status === 'incompatible' || !plugin.manifest) return t('pluginStatusIncompatible')
    if (!plugin.preference.enabled || !enabledGlobally.value) return t('pluginStatusDisabled')
    return t('pluginStatusEnabled')
  }

  function pluginStatusTone(plugin: PluginPanelPlugin): 'success' | 'warn' | 'neutral' {
    if (plugin.status === 'disabled_crashed' || plugin.status === 'incompatible' || !plugin.manifest) return 'warn'
    return plugin.preference.enabled && enabledGlobally.value ? 'success' : 'neutral'
  }

  const filteredPlugins = computed(() => {
    const query = installedSearch.value.trim().toLocaleLowerCase()
    const filter = installedFilter.value
    const updatable = filter === 'updates' ? updatableIds.value : null
    // 每個插件的狀態只算一次，過濾與排序共用。
    const tones = new Map(plugins.value.map(plugin => [plugin.id, pluginStatusTone(plugin)]))
    const matches = plugins.value.filter(plugin => {
      if (filter === 'enabled' && !plugin.preference.enabled) return false
      if (filter === 'issues' && tones.get(plugin.id) !== 'warn') return false
      if (updatable && !updatable.has(plugin.id)) return false
      if (!query) return true
      return [plugin.id, pluginDisplayName(plugin), plugin.manifest?.author ?? ''].some(value => value.toLocaleLowerCase().includes(query))
    })
    // sort 是穩定排序，其餘維持原本順序。
    const warn = (plugin: PluginPanelPlugin) => Number(tones.get(plugin.id) === 'warn')
    return matches.sort((left, right) => warn(right) - warn(left))
  })

  function pluginIconUrl(plugin: PluginPanelPlugin): string | null {
    return resolvePluginIconUrl(
      plugin.id,
      plugin.manifest?.icon,
      plugin.preference.enabled,
      snapshot.value?.preferences.pluginsEnabled === true,
      failedPluginIconIds.value.has(plugin.id),
    )
  }

  function hidePluginIcon(pluginId: string): void {
    failedPluginIconIds.value = new Set([...failedPluginIconIds.value, pluginId])
  }

  function displayFingerprint(value: string | undefined): string {
    return isKeyFingerprint(value)
      ? value.match(/.{4}/g)?.join(' ') ?? ''
      : ''
  }

  return {
    installedSearch,
    installedFilter,
    filteredPlugins,
    failedPluginIconIds,
    pluginName: pluginDisplayName,
    pluginIconUrl,
    hidePluginIcon,
    displayFingerprint,
    pluginStatusLabel,
    pluginStatusTone,
  }
}
