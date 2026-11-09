import { ref } from 'vue'
import { t, type TranslationKey } from '@/i18n'
import { setPanelThemeState } from '@/composables/usePanelTheme'
import type { PanelThemeIpcResult, PanelThemeMode, PanelThemeRef, PanelThemeUserImageOptions } from '@/types/panel-theme'

// 面板主題控制項（插件詳細區塊與 Appearance 狀態卡片）共用的指令。
// 每次呼叫都經過主程序，由它驗證 payload、取代每個模式唯一的插槽，
// 再廣播新狀態。

const ERROR_KEY: Record<string, TranslationKey> = {
  image_invalid: 'design.panelTheme.error.imageInvalid',
  image_too_large: 'design.panelTheme.error.imageTooLarge',
  image_not_allowed: 'design.panelTheme.error.imageNotAllowed',
  theme_unavailable: 'design.panelTheme.error.themeUnavailable',
}

export function panelThemeErrorText(result: Extract<PanelThemeIpcResult, { ok: false }>): string {
  if (result.reason === 'animated') return t('design.panelTheme.error.imageAnimated')
  return t(ERROR_KEY[result.error] ?? 'design.panelTheme.error.writeFailed')
}

export function usePanelThemeActions() {
  const busy = ref(false)
  const status = ref('')
  const error = ref('')

  async function run(task: () => Promise<PanelThemeIpcResult | undefined>, success = ''): Promise<boolean> {
    if (busy.value) return false
    busy.value = true
    try {
      const result = await task()
      if (!result) return false
      if (result.ok) {
        setPanelThemeState(result.value)
        status.value = success
        error.value = ''
        return true
      }
      if (!result.cancelled) error.value = panelThemeErrorText(result)
      return false
    } catch {
      error.value = t('design.panelTheme.error.writeFailed')
      return false
    } finally {
      busy.value = false
    }
  }

  /** 將一個主題套用到指定模式；每個模式只有一個插槽，因此會取代該處的其他主題。 */
  function applyTheme(ref: PanelThemeRef, modes: readonly PanelThemeMode[]): Promise<boolean> {
    return run(async () => {
      let last: PanelThemeIpcResult | undefined
      for (const mode of modes) {
        last = await window.electronAPI?.setPanelThemeSlot(mode, ref)
        if (!last?.ok) return last
      }
      return last
    }, t('design.panelTheme.applied'))
  }

  function restoreBuiltIn(): Promise<boolean> {
    return run(async () => {
      const light = await window.electronAPI?.setPanelThemeSlot('light', null)
      if (!light?.ok) return light
      return window.electronAPI?.setPanelThemeSlot('dark', null)
    }, t('design.panelTheme.restored'))
  }

  const importImage = (ref: PanelThemeRef, mode: PanelThemeMode) => run(
    () => window.electronAPI?.importPanelThemeUserImage(ref, mode) ?? Promise.resolve(undefined),
    t('design.panelTheme.image.imported'),
  )
  const clearImage = (ref: PanelThemeRef, mode: PanelThemeMode) => run(
    () => window.electronAPI?.clearPanelThemeUserImage(ref, mode) ?? Promise.resolve(undefined),
    t('design.panelTheme.image.removed'),
  )
  const setImageOptions = (ref: PanelThemeRef, mode: PanelThemeMode, options: PanelThemeUserImageOptions) => run(
    () => window.electronAPI?.setPanelThemeUserImageOptions(ref, mode, options) ?? Promise.resolve(undefined),
  )

  return { busy, status, error, applyTheme, restoreBuiltIn, importImage, clearImage, setImageOptions }
}
