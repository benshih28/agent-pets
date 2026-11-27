import { ref } from 'vue'
import { useAgentStore } from '@/stores/agentStore'
import { getCachedSprite, getCachedTint, loadPetSprite, setCachedTint } from '@/composables/usePetSpriteCache'
import { deriveAuraTint } from '@/utils/pet-aura-tint'

function getSrc(id: string): string {
  const base = import.meta.env.BASE_URL || './'
  return `${base}pets/${id}/spritesheet.webp`
}

function paletteHighlight(): string {
  if (typeof document === 'undefined') return 'transparent'
  return getComputedStyle(document.documentElement).getPropertyValue('--organic-highlight').trim() || 'transparent'
}

export function usePetSpriteLoader(getPetId: () => string, onApplied: () => void) {
  const store = useAgentStore()
  const image = ref<HTMLImageElement | null>(null)
  let auraTint = paletteHighlight()
  let loadSequence = 0

  function applyImage(img: HTMLImageElement, cacheKey: string): void {
    image.value = img
    auraTint = getCachedTint(cacheKey) ?? deriveAuraTint(img, auraTint)
    setCachedTint(cacheKey, auraTint)
    onApplied()
  }

  async function spriteSourceFor(pet: (typeof store.pets)[number] | undefined, targetId: string): Promise<string | null> {
    if (pet?.pluginSkin) return pet.pluginSkin.spriteUrl
    if (pet && !pet.builtIn) return (await window.electronAPI?.getCustomPetSprite(targetId)) ?? null
    return getSrc(targetId)
  }

  async function load(): Promise<void> {
    const sequence = ++loadSequence
    const id = getPetId() || store.defaultPetId
    const pet = store.pets.find(p => p.id === id)

    if (!pet && !store.petsLoaded) return

    const targetId = pet ? id : store.defaultPetId
    const isCustom = Boolean(pet && !pet.builtIn && !pet.pluginSkin)
    // 自訂圖 URL 帶修改時間，當快取鍵才不會在重新匯入後顯示舊圖。
    const source = await spriteSourceFor(pet, targetId)
    if (sequence !== loadSequence) return
    const cacheKey = pet?.pluginSkin?.cacheKey ?? (isCustom && source ? source : targetId)
    const cached = getCachedSprite(cacheKey)
    if (cached) {
      applyImage(cached, cacheKey)
      return
    }
    const loaded = source ? await loadPetSprite(cacheKey, source) : null
    if (sequence !== loadSequence) return
    if (loaded) {
      applyImage(loaded, cacheKey)
      return
    }

    if (targetId !== store.defaultPetId) {
      const fallbackKey = store.defaultPetId
      const fallback = await loadPetSprite(fallbackKey, getSrc(store.defaultPetId))
      if (sequence === loadSequence && fallback) applyImage(fallback, fallbackKey)
    }
  }

  return { image, load, auraTint: () => auraTint }
}
