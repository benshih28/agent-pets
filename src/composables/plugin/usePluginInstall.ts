import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import { locale, t, type TranslationKey } from '@/i18n'
import type { PluginInstallPlan, PluginPanelPlugin } from '@/types/plugin'
import type { PluginCatalogPanelItem } from '@/types/plugin-catalog'
import { installAcknowledgementReasons, permissionUnitsOfPlan } from '@/utils/plugin-permissions'
import { toPermissionGroupViews, type PermissionGroupView } from '@/utils/plugin-permission-copy'
import { pluginScope, type PluginBusyScopes, type PluginPanelFeedback } from '@/composables/plugin/panel-deps'

export interface PluginInstallDeps {
  enabledGlobally: ComputedRef<boolean>
  catalogLoadedAt: Ref<number | null>
  updatableItems: ComputedRef<PluginCatalogPanelItem[]>
  busy: Pick<PluginBusyScopes, 'isBusy' | 'setBusy'>
  feedback: Pick<PluginPanelFeedback, 'setError' | 'setStatus'>
  pluginName(plugin: PluginPanelPlugin): string
  loadPluginCatalog(options?: { silent?: boolean }): Promise<void>
  enableInstalledPlugin(pluginId: string): Promise<void>
  refreshPanel(): Promise<void>
}

const PLAN_KIND_LABELS = {
  new: 'pluginInstallNew',
  update: 'pluginInstallUpdate',
  downgrade: 'pluginInstallDowngrade',
  reinstall: 'pluginInstallReinstall',
  incompatible: 'pluginIncompatible',
} as const satisfies Record<PluginInstallPlan['kind'], TranslationKey>

export function usePluginInstall(deps: PluginInstallDeps) {
  const { enabledGlobally, catalogLoadedAt, updatableItems, pluginName, loadPluginCatalog, enableInstalledPlugin, refreshPanel } = deps
  const { isBusy, setBusy } = deps.busy
  const { setError, setStatus } = deps.feedback

  const pendingPlan = ref<PluginInstallPlan | null>(null)
  const updateQueue = ref<PluginCatalogPanelItem[]>([])
  const pendingRemove = ref<PluginPanelPlugin | null>(null)
  const keepData = ref(false)

  const hasCompatiblePlan = computed(() => Boolean(pendingPlan.value && pendingPlan.value.kind !== 'incompatible'))
  const pendingPluginName = computed(() => pendingPlan.value?.name?.[locale.value] ?? pendingPlan.value?.pluginId ?? '')

  function planKindLabel(plan: PluginInstallPlan): string {
    return t(PLAN_KIND_LABELS[plan.kind])
  }

  const pendingPermissionSections = computed(() => {
    const plan = pendingPlan.value
    if (!plan) return { isUpdate: false, added: [] as PermissionGroupView[], existing: [] as PermissionGroupView[], existingCount: 0 }
    const units = permissionUnitsOfPlan(plan)
    const isUpdate = plan.requiresReconsent && plan.addedPermissions.length > 0
    if (!isUpdate) return { isUpdate: false, added: toPermissionGroupViews(units), existing: [], existingCount: 0 }
    const added = new Set(plan.addedPermissions)
    const existingUnits = units.filter(unit => !added.has(unit))
    return {
      isUpdate: true,
      added: toPermissionGroupViews(plan.addedPermissions),
      existing: toPermissionGroupViews(existingUnits),
      existingCount: existingUnits.length,
    }
  })
  const installAcknowledgements = computed(() => installAcknowledgementReasons(pendingPlan.value))

  async function planFrom(
    pick: () => Promise<
      | { ok: true; value: PluginInstallPlan }
      | { ok: false; error: string; cancelled?: boolean; diagnostic?: string }
      | undefined
    >,
    options: { clearPlan: boolean; withDiagnostic?: boolean },
  ): Promise<void> {
    const scope = 'install'
    if (isBusy(scope)) return
    setBusy(scope, true)
    if (options.clearPlan) pendingPlan.value = null
    try {
      const result = await pick()
      if (!result?.ok) {
        if (result && !result.ok && !result.cancelled) setError(result.error, undefined, options.withDiagnostic ? result.diagnostic : undefined)
        return
      }
      pendingPlan.value = result.value
    } catch {
      setError('plugin_action_failed')
    } finally {
      setBusy(scope, false)
    }
  }

  async function selectArchive(): Promise<void> {
    await planFrom(async () => window.electronAPI?.selectPluginArchive(), { clearPlan: true })
  }

  async function selectDeveloperFolder(): Promise<void> {
    await planFrom(async () => window.electronAPI?.selectPluginFolder(), { clearPlan: true, withDiagnostic: true })
  }

  async function installCatalogPlugin(item: PluginCatalogPanelItem): Promise<void> {
    await planFrom(
      async () => window.electronAPI?.installPluginFromCatalog(item.plugin.id, item.latestVersion.version),
      { clearPlan: false },
    )
  }

  // 更新佇列逐一開啟確認 Sheet，絕不跳過同意。
  async function installNextQueuedUpdate(): Promise<void> {
    const next = updateQueue.value[0]
    if (!next) return
    updateQueue.value = updateQueue.value.slice(1)
    await installCatalogPlugin(next)
  }

  async function updateAllCatalogPlugins(): Promise<void> {
    if (pendingPlan.value) return
    updateQueue.value = updatableItems.value
    await installNextQueuedUpdate()
  }

  watch(pendingPlan, plan => {
    if (!plan && updateQueue.value.length) void installNextQueuedUpdate()
  })

  async function confirmInstall(): Promise<void> {
    const plan = pendingPlan.value
    const scope = 'install'
    if (!plan || plan.kind === 'incompatible' || isBusy(scope)) return
    setBusy(scope, true)
    try {
      const result = await window.electronAPI?.installPluginPlan(
        plan.token,
        plan.requiresReconsent,
        plan.requiresSignatureConfirmation === true,
      )
      if (!result?.ok) {
        if (result && !result.ok) setError(result.error)
        return
      }
      pendingPlan.value = null
      if (catalogLoadedAt.value) void loadPluginCatalog({ silent: true })
      const installed = result.value
      setStatus(
        enabledGlobally.value
          ? t('pluginInstallSucceeded', { name: pluginName(installed) })
          : t('plugins.installSucceededGlobalOff', { name: pluginName(installed) }),
        { label: t(enabledGlobally.value ? 'plugins.enableNow' : 'plugins.enableAll'), run: () => void enableInstalledPlugin(installed.id) },
      )
      await refreshPanel()
    } catch {
      setError('plugin_action_failed')
    } finally {
      setBusy(scope, false)
    }
  }

  function requestRemove(plugin: PluginPanelPlugin): void {
    pendingRemove.value = plugin
    keepData.value = true
  }

  async function confirmRemove(): Promise<void> {
    const plugin = pendingRemove.value
    const scope = pluginScope(plugin?.id ?? '')
    if (!plugin || isBusy(scope)) return
    setBusy(scope, true)
    try {
      const result = await window.electronAPI?.removeInstalledPlugin(plugin.id, keepData.value)
      if (!result?.ok) {
        if (result && !result.ok) setError(result.error)
        return
      }
      pendingRemove.value = null
      setStatus(t('pluginRemoveSucceeded'))
      await refreshPanel()
    } catch {
      setError('plugin_action_failed')
    } finally {
      setBusy(scope, false)
    }
  }

  return {
    pendingPlan,
    updateQueue,
    pendingRemove,
    keepData,
    hasCompatiblePlan,
    pendingPluginName,
    pendingPermissionSections,
    installAcknowledgements,
    planKindLabel,
    selectArchive,
    selectDeveloperFolder,
    installCatalogPlugin,
    updateAllCatalogPlugins,
    confirmInstall,
    requestRemove,
    confirmRemove,
  }
}
