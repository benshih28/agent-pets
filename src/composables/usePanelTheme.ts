import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { resolvedTheme } from '@/composables/useTheme'
import { isPanelThemeFit, isPanelThemePosition, type PanelThemeCatalogEntry, type PanelThemeFit, type PanelThemeMode, type PanelThemePosition, type PanelThemeState } from '@/types/panel-theme'
import {
  activePanelTheme,
  diffPanelThemeProperties,
  isPanelThemeAssetUrl,
  isPanelThemeFontAlias,
  isPanelThemePropertyValue,
  panelThemeTargetProperties,
  type PanelThemeMediaFlags,
} from '@/utils/panel-theme-css'

// 依解析後的淺色/深色模式，把插件主題套用到面板視窗的 <html>（spec §7.3、§16）：
// tokens.css 的語意層在 :root 由色盤衍生，所以面板、對話框、通知、精靈與
// Project MCP 面板都讀同一組色盤。每個值都由主程序建構，並在此重新驗證；
// 寫入會先做差異比對，並在同一個 frame 內批次完成（每次切換只有一次樣式重算）。

export interface PanelThemeBackdropView {
  url: string
  fit: PanelThemeFit
  position: PanelThemePosition
  opacity: number
  blur: number
  overlayColor: string
  overlayOpacity: number
}

const FONT_LOAD_TIMEOUT_MS = 1500

/** 與 Settings 卡片共用，讓兩者看到相同狀態。 */
export const panelThemeState = shallowRef<PanelThemeState | null>(null)

export function setPanelThemeState(next: PanelThemeState | null): void {
  panelThemeState.value = next
}

let refreshInFlight: Promise<void> | null = null

/** 多個元件會同時掛載；它們共用同一個進行中的請求。 */
export function refreshPanelThemeState(): Promise<void> {
  refreshInFlight ??= (async () => {
    try {
      const result = await window.electronAPI?.getPanelThemeState()
      if (result?.ok) panelThemeState.value = result.value
    } catch {
      // 即時廣播（onPanelThemeChanged）之後仍會更新狀態。
    } finally {
      refreshInFlight = null
    }
  })()
  return refreshInFlight
}

function mediaQuery(query: string): MediaQueryList | null {
  return typeof matchMedia === 'function' ? matchMedia(query) : null
}

export const panelThemeMedia = ref<PanelThemeMediaFlags & { reducedTransparency: boolean }>({
  forcedColors: false,
  highContrast: false,
  reducedTransparency: false,
})

function readMedia(): void {
  panelThemeMedia.value = {
    forcedColors: mediaQuery('(forced-colors: active)')?.matches === true,
    highContrast: mediaQuery('(prefers-contrast: more)')?.matches === true,
    reducedTransparency: mediaQuery('(prefers-reduced-transparency: reduce)')?.matches === true
      || (typeof document !== 'undefined' && document.documentElement.hasAttribute('data-gpu-safe')),
  }
}

/** 以封閉的主機格式重新檢查每個背景值。 */
export function validBackdrop(view: PanelThemeBackdropView | null): PanelThemeBackdropView | null {
  if (!view || !isPanelThemeAssetUrl(view.url) || !isPanelThemePropertyValue('--organic-bg', view.overlayColor)) return null
  if (!isPanelThemeFit(view.fit) || !isPanelThemePosition(view.position)) return null
  const inRange = (value: number, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
  if (!inRange(view.opacity, 0.2, 1) || !inRange(view.overlayOpacity, 0.5, 0.95) || !Number.isInteger(view.blur) || !inRange(view.blur, 0, 24)) return null
  return view
}

/** 預覽用的背景圖：使用者圖片優先（遮罩取使用者選的值），否則為主題套件內的圖片。 */
export function panelThemePreviewBackdrop(entry: PanelThemeCatalogEntry | null, mode: PanelThemeMode, forcedColors: boolean): PanelThemeBackdropView | null {
  const modeState = entry?.modes[mode]
  if (!modeState || forcedColors) return null
  const user = modeState.userImage?.current
  if (user) {
    return validBackdrop({ url: user.url, fit: user.fit, position: user.position, opacity: 1, blur: user.blur, overlayColor: modeState.userImage!.overlayColor, overlayOpacity: user.dim })
  }
  const background = modeState.background
  return background.type === 'image'
    ? validBackdrop({ url: background.url, fit: background.fit, position: background.position, opacity: background.opacity, blur: background.blur, overlayColor: background.overlay.color, overlayOpacity: background.overlay.opacity })
    : null
}

function logRejected(names: string[]): void {
  if (names.length === 0) return
  try {
    window.electronAPI?.reportRendererError?.({ message: `panel theme values rejected: ${names.slice(0, 8).join(', ')}`, kind: 'error' })
  } catch {}
}

export function usePanelTheme() {
  const applied = new Map<string, string>()
  const loadedFaces = new Map<string, FontFace>()
  let frame = 0
  let generation = 0
  let unsubscribe: (() => void) | null = null
  const queries: Array<[MediaQueryList, () => void]> = []

  const mode = computed<PanelThemeMode>(() => resolvedTheme.value)
  const entry = computed(() => activePanelTheme(panelThemeState.value, mode.value))

  const backdrop = computed<PanelThemeBackdropView | null>(() => validBackdrop(rawBackdrop()))

  function rawBackdrop(): PanelThemeBackdropView | null {
    const modeState = entry.value?.modes[mode.value]
    if (!modeState || panelThemeMedia.value.forcedColors || panelThemeMedia.value.reducedTransparency) return null
    const user = modeState.userImage?.current
    if (user && isPanelThemeAssetUrl(user.url)) {
      return { url: user.url, fit: user.fit, position: user.position, opacity: 1, blur: user.blur, overlayColor: modeState.userImage!.overlayColor, overlayOpacity: user.dim }
    }
    const background = modeState.background
    if (background.type === 'image' && isPanelThemeAssetUrl(background.url)) {
      return {
        url: background.url,
        fit: background.fit,
        position: background.position,
        opacity: background.opacity,
        blur: background.blur,
        overlayColor: background.overlay.color,
        overlayOpacity: background.overlay.opacity,
      }
    }
    return null
  }

  /** 載入所有已指派到插槽之主題的字型 face；丟棄沒有插槽使用的 face。 */
  async function syncFonts(): Promise<void> {
    if (typeof FontFace === 'undefined' || typeof document === 'undefined') return
    const wanted = new Map<string, { alias: string; url: string; weight: number; style: string }>()
    if (!panelThemeMedia.value.forcedColors) {
      for (const slotMode of ['light', 'dark'] as const) {
        for (const face of activePanelTheme(panelThemeState.value, slotMode)?.shared.fonts ?? []) {
          if (!isPanelThemeFontAlias(face.alias) || !isPanelThemeAssetUrl(face.url)) continue
          wanted.set(`${face.alias}|${face.weight}|${face.style}|${face.url}`, face)
        }
      }
    }
    for (const [key, face] of loadedFaces) {
      if (wanted.has(key)) continue
      document.fonts.delete(face)
      loadedFaces.delete(key)
    }
    const loads: Array<Promise<unknown>> = []
    for (const [key, face] of wanted) {
      if (loadedFaces.has(key)) continue
      const fontFace = new FontFace(face.alias, `url("${face.url}")`, { weight: String(face.weight), style: face.style, display: 'swap' })
      loadedFaces.set(key, fontFace)
      document.fonts.add(fontFace)
      loads.push(fontFace.load())
    }
    if (loads.length === 0) return
    await Promise.race([
      Promise.allSettled(loads),
      new Promise(resolve => setTimeout(resolve, FONT_LOAD_TIMEOUT_MS)),
    ])
  }

  async function apply(): Promise<void> {
    const current = ++generation
    await syncFonts()
    if (current !== generation) return
    const plan = panelThemeTargetProperties(entry.value, mode.value, panelThemeMedia.value)
    logRejected(plan.rejected)
    if (frame) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      frame = 0
      const element = document.documentElement
      if (current !== generation) return
      const { remove, set } = diffPanelThemeProperties(applied, plan.properties)
      for (const name of remove) {
        element.style.removeProperty(name)
        applied.delete(name)
      }
      for (const [name, value] of set) {
        element.style.setProperty(name, value)
        applied.set(name, value)
      }
      if (plan.properties.size > 0) element.dataset.panelTheme = 'plugin'
      else delete element.dataset.panelTheme
    })
  }

  watch([panelThemeState, mode, panelThemeMedia], () => { void apply() }, { deep: false })

  // 主程序據此決定插件主題 API 的 `mode` 與色盤；只在實際生效的值改變時送出。
  watch(
    [mode, () => panelThemeMedia.value.forcedColors],
    ([currentMode, forcedColors]) => {
      try { window.electronAPI?.setPanelThemeAppearance?.({ mode: currentMode, forcedColors }) } catch {}
    },
    { immediate: true },
  )

  onMounted(() => {
    readMedia()
    for (const query of ['(forced-colors: active)', '(prefers-contrast: more)', '(prefers-reduced-transparency: reduce)']) {
      const list = mediaQuery(query)
      if (!list) continue
      list.addEventListener('change', readMedia)
      queries.push([list, readMedia])
    }
    unsubscribe = window.electronAPI?.onPanelThemeChanged?.(state => setPanelThemeState(state)) ?? null
    void refreshPanelThemeState()
  })

  onBeforeUnmount(() => {
    unsubscribe?.()
    for (const [list, listener] of queries) list.removeEventListener('change', listener)
    if (frame) cancelAnimationFrame(frame)
    for (const name of applied.keys()) document.documentElement.style.removeProperty(name)
    applied.clear()
    delete document.documentElement.dataset.panelTheme
    for (const face of loadedFaces.values()) document.fonts.delete(face)
    loadedFaces.clear()
  })

  return { backdrop, entry, mode }
}
