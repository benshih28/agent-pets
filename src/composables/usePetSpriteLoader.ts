// 載入寵物的 sprite 圖（內建、插件造型、自訂匯入），失敗時退回預設寵物。
// 圖與光暈色都走快取；載入序號讓較新的請求（舊的還在載入時又換了寵物）優先。
import { ref } from 'vue'
import { useAgentStore } from '@/stores/agentStore'
import { getCachedSprite, getCachedTint, loadPetSprite, setCachedTint } from '@/composables/usePetSpriteCache'
import { deriveAuraTint } from '@/utils/pet-aura-tint'

function getSrc(id: string): string {
  const base = import.meta.env.BASE_URL || './'
  return `${base}pets/${id}/spritesheet.webp`
}

// 光暈色算不出來時用色盤的高光色（--organic-highlight），不寫死顏色。
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
    // 自訂圖的 URL 帶有修改時間，直接拿來當快取鍵：重新匯入同一個 id 不會顯示舊圖。
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

    // 圖載入失敗：改顯示預設寵物，而不是空白畫布。
    if (targetId !== store.defaultPetId) {
      const fallbackKey = store.defaultPetId
      const fallback = await loadPetSprite(fallbackKey, getSrc(store.defaultPetId))
      if (sequence === loadSequence && fallback) applyImage(fallback, fallbackKey)
    }
  }

  return { image, load, auraTint: () => auraTint }
}
