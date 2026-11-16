// 插件安裝與移除：選檔／資料夾／目錄項目產生安裝計畫、確認 Sheet 的衍生狀態、「全部更新」佇列與移除確認。
//
// 契約：
// - 讀：enabledGlobally、pluginName（成功訊息）、catalogLoadedAt（安裝後是否重新檢查目錄）。
// - 寫：pendingPlan／updateQueue／pendingRemove／keepData 為此處所有；安裝成功後呼叫 refreshPanel。
// - 排序：'install' 範圍同時間只允許一個動作；更新佇列在計畫被關閉（確認或取消）後才接續下一個，絕不跳過同意。
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

  // 更新時：新增權限單獨置頂，既有權限折疊；新安裝時所有權限都是「新增」。
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

  // 三種來源（封存檔、開發者資料夾、目錄項目）共用：忙碌範圍、清空舊計畫與錯誤處理。
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

  // 「全部更新」：逐一為每個可更新項目產生安裝計畫並開啟同一個確認 Sheet，絕不跳過同意。
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
