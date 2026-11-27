import { computed, nextTick, onMounted, onUnmounted, ref, watch, type Ref } from 'vue'
import type { PluginPanelPlugin, PluginPanelViewClosedEvent } from '@/types/plugin'
import {
  isCurrentPluginPanelViewClose,
  maximizedPluginPanelWindowSize,
  pluginPanelViewCloseError,
  shouldResetPluginPanelMaximized,
} from '@/utils/plugin-panel-view'
import { createLatestRequest } from '@/composables/plugin/panel-deps'

export interface PluginPanelViewDeps {
  pluginById(pluginId: string): PluginPanelPlugin | null
  enabledGlobally: Readonly<Ref<boolean>>
  selectPlugin(pluginId: string): void
  setError(code: string): void
}

interface Bounds { x: number; y: number; width: number; height: number }

function toBounds(rect: DOMRect): Bounds {
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
}

export function usePluginPanelView(deps: PluginPanelViewDeps) {
  const { pluginById, enabledGlobally, selectPlugin, setError } = deps

  const panelViewPluginId = ref('')
  const panelViewOpenToken = ref(0)
  const panelViewFrame = ref<HTMLElement | null>(null)
  const panelViewContent = ref<HTMLElement | null>(null)
  const panelViewMaximized = ref(false)
  const panelViewError = ref('')
  const panelViewPlugin = computed(() => pluginById(panelViewPluginId.value))
  const openRequest = createLatestRequest()
  let panelViewReturnFocus: HTMLElement | null = null
  let panelViewBoundsObserver: ResizeObserver | null = null
  let panelViewScrollContainer: HTMLElement | null = null
  let panelViewScrollTop: number | null = null
  let panelViewWindowSizeBeforeMaximize: { width: number; height: number } | null = null
  let removePanelClosedListener: (() => void) | null = null

  function readPluginPanelViewBounds(): { frame: DOMRect; content: DOMRect } | null {
    const frame = panelViewFrame.value?.getBoundingClientRect()
    const content = panelViewContent.value?.getBoundingClientRect()
    if (!frame || !content || frame.width < 1 || frame.height < 1 || content.width < 1 || content.height < 1) return null
    return { frame, content }
  }

  function sendPluginPanelViewBounds(): void {
    const openToken = panelViewOpenToken.value
    const bounds = readPluginPanelViewBounds()
    if (!openToken || !bounds) return
    window.electronAPI?.setPluginPanelViewBounds(
      openToken,
      toBounds(bounds.frame),
      toBounds(bounds.content),
      { width: window.innerWidth, height: window.innerHeight },
    )
  }

  function stopWatchingBounds(): void {
    panelViewBoundsObserver?.disconnect()
    panelViewBoundsObserver = null
    window.removeEventListener('resize', sendPluginPanelViewBounds)
    window.removeEventListener('scroll', sendPluginPanelViewBounds, true)
  }

  // resizePanel 只送暫時的最小尺寸，不覆寫使用者調整的大小；插件頁已被主行程關閉時由主行程還原尺寸。
  async function restorePluginPanelViewMaximized(restoreWindowSize = false): Promise<void> {
    if (!panelViewMaximized.value) return
    panelViewMaximized.value = false
    const previousSize = panelViewWindowSizeBeforeMaximize
    panelViewWindowSizeBeforeMaximize = null
    if (restoreWindowSize && previousSize) window.electronAPI?.resizePanel({ release: true })
    const scrollContainer = panelViewScrollContainer
    const scrollTop = panelViewScrollTop
    panelViewScrollContainer = null
    panelViewScrollTop = null
    await nextTick()
    if (scrollContainer?.isConnected && scrollTop !== null) scrollContainer.scrollTop = scrollTop
    sendPluginPanelViewBounds()
  }

  function setPluginPanelViewMaximized(maximized: boolean): void {
    if (!panelViewPluginId.value || panelViewMaximized.value === maximized) return
    if (!maximized) {
      void restorePluginPanelViewMaximized(true)
      return
    }
    panelViewScrollContainer = panelViewFrame.value?.closest<HTMLElement>('.settings-content') ?? null
    panelViewScrollTop = panelViewScrollContainer?.scrollTop ?? null
    const current = { width: window.outerWidth, height: window.outerHeight }
    const target = maximizedPluginPanelWindowSize(current, { width: window.screen.availWidth, height: window.screen.availHeight })
    if (target.width !== current.width || target.height !== current.height) {
      panelViewWindowSizeBeforeMaximize = current
      window.electronAPI?.resizePanel(target.height, target.width)
    }
    panelViewMaximized.value = true
    void nextTick(() => sendPluginPanelViewBounds())
  }

  function togglePluginPanelViewMaximized(): void {
    setPluginPanelViewMaximized(!panelViewMaximized.value)
  }

  function onPluginPanelViewKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || event.defaultPrevented || !panelViewPluginId.value) return
    if (document.querySelector('[aria-modal="true"]')) return
    event.preventDefault()
    event.stopPropagation()
    if (panelViewMaximized.value) void restorePluginPanelViewMaximized(true)
    else closePluginPanelView()
  }

  async function openPluginPanelView(pluginId: string): Promise<void> {
    const plugin = pluginById(pluginId)
    if (!plugin?.manifest?.contributes.panelView || !plugin.preference.enabled || !enabledGlobally.value) {
      setError('disabled')
      return
    }
    const request = openRequest.next()
    if (!panelViewPluginId.value && document.activeElement instanceof HTMLElement) panelViewReturnFocus = document.activeElement
    panelViewError.value = ''
    const previousOpenToken = panelViewOpenToken.value
    panelViewOpenToken.value = 0
    if (previousOpenToken) window.electronAPI?.closePluginPanelView(previousOpenToken)
    if (panelViewMaximized.value) await restorePluginPanelViewMaximized(true)
    if (!openRequest.isCurrent(request)) return
    selectPlugin(pluginId)
    panelViewPluginId.value = pluginId
    await nextTick()
    if (!openRequest.isCurrent(request)) return
    const bounds = readPluginPanelViewBounds()
    if (!bounds) {
      panelViewPluginId.value = ''
      setError('panel_unavailable')
      return
    }
    try {
      const result = await window.electronAPI?.openPluginPanelView(pluginId, toBounds(bounds.frame), toBounds(bounds.content))
      if (!openRequest.isCurrent(request)) {
        if (result?.ok) window.electronAPI?.closePluginPanelView(result.value.openToken)
        return
      }
      if (!result?.ok) {
        panelViewError.value = result && !result.ok ? result.error : 'plugin_service_unavailable'
        return
      }
      panelViewOpenToken.value = result.value.openToken
      await nextTick()
      sendPluginPanelViewBounds()
    } catch {
      if (!openRequest.isCurrent(request)) return
      panelViewError.value = 'plugin_service_unavailable'
    }
  }

  function closePluginPanelView(): void {
    openRequest.invalidate()
    void restorePluginPanelViewMaximized(true)
    const openToken = panelViewOpenToken.value
    panelViewOpenToken.value = 0
    panelViewPluginId.value = ''
    panelViewError.value = ''
    if (openToken) window.electronAPI?.closePluginPanelView(openToken)
    const returnTo = panelViewReturnFocus
    panelViewReturnFocus = null
    void nextTick(() => {
      if (returnTo?.isConnected) returnTo.focus()
    })
  }

  function reloadPluginPanelView(): void {
    const pluginId = panelViewPluginId.value
    if (pluginId) void openPluginPanelView(pluginId)
  }

  function handlePluginPanelViewClosed(event: PluginPanelViewClosedEvent): void {
    if (!isCurrentPluginPanelViewClose(event, panelViewPluginId.value, panelViewOpenToken.value)) return
    openRequest.invalidate()
    void restorePluginPanelViewMaximized()
    panelViewOpenToken.value = 0
    if (event.reason === 'hidden') {
      panelViewPluginId.value = ''
      return
    }
    panelViewError.value = pluginPanelViewCloseError(event.reason)
  }

  watch(panelViewPluginId, async (pluginId, previousPluginId) => {
    if (shouldResetPluginPanelMaximized(previousPluginId, pluginId)) {
      await restorePluginPanelViewMaximized()
    }
    stopWatchingBounds()
    if (!pluginId) return
    await nextTick()
    const frame = panelViewFrame.value
    const content = panelViewContent.value
    if (!frame || !content) return
    panelViewBoundsObserver = new ResizeObserver(sendPluginPanelViewBounds)
    panelViewBoundsObserver.observe(frame)
    panelViewBoundsObserver.observe(content)
    window.addEventListener('resize', sendPluginPanelViewBounds)
    window.addEventListener('scroll', sendPluginPanelViewBounds, true)
    sendPluginPanelViewBounds()
  }, { flush: 'post' })

  watch(panelViewPlugin, plugin => {
    if (!plugin) void restorePluginPanelViewMaximized()
  })

  onMounted(() => {
    window.addEventListener('keydown', onPluginPanelViewKeydown, true)
    removePanelClosedListener = window.electronAPI?.onPluginPanelViewClosed(handlePluginPanelViewClosed) ?? null
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', onPluginPanelViewKeydown, true)
    removePanelClosedListener?.()
    removePanelClosedListener = null
    stopWatchingBounds()
    openRequest.invalidate()
    if (panelViewOpenToken.value) window.electronAPI?.closePluginPanelView(panelViewOpenToken.value)
  })

  return {
    panelViewPluginId,
    panelViewOpenToken,
    panelViewFrame,
    panelViewContent,
    panelViewMaximized,
    panelViewError,
    panelViewPlugin,
    readPluginPanelViewBounds,
    sendPluginPanelViewBounds,
    openPluginPanelView,
    closePluginPanelView,
    reloadPluginPanelView,
    togglePluginPanelViewMaximized,
    handlePluginPanelViewClosed,
  }
}
