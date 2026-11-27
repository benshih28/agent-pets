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

  // Pinning and modal flows suspend main's hide-on-blur.
  const panelPinned = ref(false)
  const panelModalLocks = reactive(new Set<string>())
  const panelModalOpen = computed(() => showWizard.value || showProjectMcpPanel.value || panelModalLocks.size > 0)
  watch(panelModalOpen, open => window.electronAPI?.setPanelBlurLock?.({ modal: open }))

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

  // A restore keeps the previous screen (including a suspended plugin panel).
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
