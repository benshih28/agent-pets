// 控制面板視窗的導航：一個 route 狀態機（utils/panel-route.ts）決定目前的畫面與覆蓋層，
// 每次轉換都順便算出視窗該不該改尺寸。面板在自己的 always-on-top 視窗（見 electron/main.ts），
// 所以開關或改尺寸都不會動到寵物視窗。
//
// - 事件輸入：面板元件呼叫 open／close／back；主程序在面板從隱藏變成顯示時呼叫 `handlePanelOpened()`。
// - 計時器：無。`panelModalOpen` 的 watch 隨 store 的 effect scope 結束。
// - storage：無（最後的儀表板分頁與設定群組由 StatusPanel.vue 自己存）。
// - 跨視窗同步：無；只有面板視窗會導航，主程序以 IPC 收尺寸與 blur lock。
import { computed, reactive, ref, watch } from 'vue'
import {
  INITIAL_PANEL_ROUTE,
  panelResizeRequest,
  reducePanelRoute,
  type PanelRouteAction,
  type PanelRouteState,
} from '@/utils/panel-route'

export function usePanelNavigation() {
  const panelRoute = ref<PanelRouteState>(INITIAL_PANEL_ROUTE)
  const panelView = computed(() => panelRoute.value.view)
  const showWizard = computed(() => panelRoute.value.overlay === 'wizard')
  const showProjectMcpPanel = computed(() => panelRoute.value.overlay === 'mcp')

  // Pinning and in-progress modal flows (wizard, MCP setup, confirmations)
  // suspend the main process's hide-on-blur so the panel stays for reference.
  const panelPinned = ref(false)
  const panelModalLocks = reactive(new Set<string>())
  const panelModalOpen = computed(() => showWizard.value || showProjectMcpPanel.value || panelModalLocks.size > 0)
  watch(panelModalOpen, open => window.electronAPI?.setPanelBlurLock?.({ modal: open }))

  // 每次面板從隱藏變成顯示都加一（含 restore），StatusPanel 與插件分頁以此重新整理內容。
  const panelOpenCount = ref(0)

  function togglePanel() {
    window.electronAPI?.togglePanel()
  }

  function setPanelPinned(pinned: boolean) {
    panelPinned.value = pinned
    window.electronAPI?.setPanelBlurLock?.({ pinned })
  }

  function setPanelModalLock(key: string, open: boolean) {
    if (open) panelModalLocks.add(key)
    else panelModalLocks.delete(key)
  }

  // Every transition goes through here so the window size always follows the route.
  function navigatePanel(action: PanelRouteAction, options: { resize?: boolean } = {}) {
    const next = reducePanelRoute(panelRoute.value, action)
    const request = panelResizeRequest(panelRoute.value, next)
    panelRoute.value = next
    if (options.resize !== false && request) window.electronAPI?.resizePanel(request)
  }

  function closePanel() {
    const before = panelRoute.value
    navigatePanel({ type: 'close-overlay' }, { resize: false })
    window.electronAPI?.hidePanel()
    // Hide first, then drop an overlay's minimum size, so the window never visibly resizes on close.
    if (before.overlay) window.electronAPI?.resizePanel({ release: true })
  }

  const openSettings = () => navigatePanel({ type: 'open-settings' })
  const openSetupWizard = () => navigatePanel({ type: 'open-overlay', overlay: 'wizard' })
  const closeSetupWizard = () => navigatePanel({ type: 'close-overlay' })
  const openProjectMcpPanel = () => navigatePanel({ type: 'open-overlay', overlay: 'mcp' })
  const closeProjectMcpPanel = () => navigatePanel({ type: 'close-overlay' })
  const backToSessions = () => navigatePanel({ type: 'back-to-sessions' })

  // A restore keeps the previous screen (including a suspended plugin panel);
  // any other open goes back to the Sessions view (the main process already
  // sized the window for it).
  function handlePanelOpened(options?: { restore?: boolean }) {
    panelOpenCount.value += 1
    if (options?.restore) return
    navigatePanel({ type: 'reset' }, { resize: false })
  }

  return {
    panelRoute,
    panelView,
    showWizard,
    showProjectMcpPanel,
    panelPinned,
    panelOpenCount,
    togglePanel,
    setPanelPinned,
    setPanelModalLock,
    closePanel,
    openSettings,
    openSetupWizard,
    closeSetupWizard,
    openProjectMcpPanel,
    closeProjectMcpPanel,
    backToSessions,
    handlePanelOpened,
  }
}
