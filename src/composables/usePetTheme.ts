import { onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'
import { resolvedPetTheme } from '@/composables/useTheme'
import type { PetThemeState } from '@/types/panel-theme'
import { diffPanelThemeProperties, petThemeTargetProperties } from '@/utils/panel-theme-css'

export function usePetTheme() {
  const state = shallowRef<PetThemeState | null>(null)
  const flags = shallowRef({ forcedColors: false, highContrast: false })
  const applied = new Map<string, string>()
  let frame = 0
  let unsubscribe: (() => void) | null = null
  const queries = typeof matchMedia === 'function'
    ? { forced: matchMedia('(forced-colors: active)'), contrast: matchMedia('(prefers-contrast: more)') }
    : null
  const readMedia = () => {
    flags.value = { forcedColors: queries?.forced.matches === true, highContrast: queries?.contrast.matches === true }
  }

  function apply(): void {
    const next = petThemeTargetProperties(state.value, resolvedPetTheme.value, flags.value)
    if (frame) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      frame = 0
      const element = document.documentElement
      const { remove, set } = diffPanelThemeProperties(applied, next)
      for (const name of remove) {
        element.style.removeProperty(name)
        applied.delete(name)
      }
      for (const [name, value] of set) {
        element.style.setProperty(name, value)
        applied.set(name, value)
      }
      if ([...next.keys()].some(name => name.startsWith('--pet-status-'))) element.dataset.petStatusTheme = 'plugin'
      else delete element.dataset.petStatusTheme
    })
  }

  watch([state, resolvedPetTheme, flags], apply)

  onMounted(() => {
    readMedia()
    queries?.forced.addEventListener('change', readMedia)
    queries?.contrast.addEventListener('change', readMedia)
    unsubscribe = window.electronAPI?.onPetStatusThemeChanged?.(next => { state.value = next }) ?? null
    void window.electronAPI?.getPetStatusTheme?.().then(next => { state.value = next }).catch(() => {})
  })

  onBeforeUnmount(() => {
    unsubscribe?.()
    queries?.forced.removeEventListener('change', readMedia)
    queries?.contrast.removeEventListener('change', readMedia)
    if (frame) cancelAnimationFrame(frame)
  })
}
