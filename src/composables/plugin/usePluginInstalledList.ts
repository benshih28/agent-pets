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
    const tones = new Map(plugins.value.map(plugin => [plugin.id, pluginStatusTone(plugin)]))
    const matches = plugins.value.filter(plugin => {
      if (filter === 'enabled' && !plugin.preference.enabled) return false
      if (filter === 'issues' && tones.get(plugin.id) !== 'warn') return false
      if (updatable && !updatable.has(plugin.id)) return false
      if (!query) return true
      return [plugin.id, pluginDisplayName(plugin), plugin.manifest?.author ?? ''].some(value => value.toLocaleLowerCase().includes(query))
    })
    // 依賴穩定排序：有問題的置頂，其餘維持快照順序。
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
