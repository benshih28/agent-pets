import { computed, ref } from 'vue'
import { isAgentFamilyKey } from '@/types/agent'
import type { PetBehaviorManifest, PluginSkinPetSource } from '@/types/pet'
import { readStored, writeStored } from '@/utils/local-storage'
import { isPluginSkinPetId } from '@/utils/pet-id'
import { DEFAULT_PET_ID, STORAGE_KEYS } from '@/utils/storage-keys'

export interface PetEntry {
  id: string
  displayName: string
  folder: string
  builtIn: boolean
  behaviorManifest?: PetBehaviorManifest
  pluginSkin?: PluginSkinPetSource
}

export interface PetsDeps {
  /** 選了新寵物後同步主程序的成長進度；進度模組在寵物之後才建立。 */
  onPetSelected: (petId: string) => void
  refreshProjectPets: () => Promise<unknown>
  routedPetId: () => string | undefined
}

export function usePets(deps: PetsDeps) {
  const selectedPet = ref<string>(readStored(STORAGE_KEYS.petId))
  const pets = ref<PetEntry[]>([])
  const petsLoaded = ref(false)
  // Built-in pets are bundled assets, so "removing" one only hides it.
  const hiddenBuiltinIds = ref<string[]>(readStored(STORAGE_KEYS.hiddenBuiltinPets))
  const visiblePets = computed(() => {
    const hidden = new Set(hiddenBuiltinIds.value)
    return pets.value.filter(p => !hidden.has(p.id))
  })
  const visiblePetIds = computed(() => new Set(visiblePets.value.map(p => p.id)))
  const petsById = computed(() => new Map(pets.value.map(pet => [pet.id, pet])))

  // 以 AgentFamilyKey 為 key；localStorage 的既有格式，key 不能改名。
  const familyPetIds = ref<Record<string, string>>(readStored(STORAGE_KEYS.familyPetIds))

  function syncFamilyPetIds(value: Record<string, string>): void {
    familyPetIds.value = value
  }

  // 寫入路徑跟讀取用同一個白名單：不是家族 registry 裡的 key 一律忽略。
  function setFamilyPet(familyKey: string, petId: string | null) {
    if (!isAgentFamilyKey(familyKey)) return
    const next = { ...familyPetIds.value }
    if (petId) {
      next[familyKey] = petId
    } else {
      delete next[familyKey]
    }
    familyPetIds.value = next
    writeStored(STORAGE_KEYS.familyPetIds, next)
  }

  function getPetForFamily(familyKey: string): string {
    const override = Object.hasOwn(familyPetIds.value, familyKey) ? familyPetIds.value[familyKey] : undefined
    if (override && visiblePetIds.value.has(override)) {
      return override
    }
    return selectedPet.value
  }
  function setPet(petId: string) {
    selectedPet.value = petId
    writeStored(STORAGE_KEYS.petId, petId)
    deps.onPetSelected(petId)
  }

  async function handlePluginSkinsChanged(removedPetIds: unknown): Promise<void> {
    const removed = new Set(Array.isArray(removedPetIds)
      ? removedPetIds.filter((petId): petId is string => isPluginSkinPetId(petId)).slice(0, 250)
      : [])
    const selectedPetId = selectedPet.value
    const selectedWasRemoved = removed.has(selectedPetId)
    const removedFamilyEntries = Object.entries(familyPetIds.value)
      .filter(([, petId]) => removed.has(petId))
    const routedPetId = deps.routedPetId()
    const routedWasRemoved = Boolean(routedPetId && removed.has(routedPetId))
    const activeRemovedIds = new Set<string>()
    if (selectedWasRemoved) activeRemovedIds.add(selectedPetId)
    for (const [, petId] of removedFamilyEntries) activeRemovedIds.add(petId)
    if (routedPetId && routedWasRemoved) activeRemovedIds.add(routedPetId)

    await loadPets()
    if (selectedWasRemoved || routedWasRemoved) setPet(DEFAULT_PET_ID)
    for (const [familyKey] of removedFamilyEntries) setFamilyPet(familyKey, DEFAULT_PET_ID)

    if (activeRemovedIds.size > 0) {
      void window.electronAPI?.notifyPluginSkinFallback([...activeRemovedIds])
    }
  }

  async function loadPets() {
    try {
      const list = await window.electronAPI?.loadPets()
      if (list) {
        pets.value = list
      }
    } finally {
      petsLoaded.value = true
    }
  }

  async function renamePet(petId: string, newName: string) {
    const ok = await window.electronAPI?.renameCustomPet(petId, newName)
    if (ok) {
      const pet = petsById.value.get(petId)
      if (pet) pet.displayName = newName
    }
  }

  async function removePet(petId: string) {
    if (petId === DEFAULT_PET_ID) return

    const pet = petsById.value.get(petId)
    if (pet?.builtIn) {
      if (!hiddenBuiltinIds.value.includes(petId)) {
        hiddenBuiltinIds.value = [...hiddenBuiltinIds.value, petId]
        writeStored(STORAGE_KEYS.hiddenBuiltinPets, hiddenBuiltinIds.value)
      }
    } else {
      await window.electronAPI?.removeCustomPet(petId)
      pets.value = pets.value.filter(p => p.id !== petId)
    }

    if (selectedPet.value === petId) {
      setPet(visiblePets.value[0]?.id || DEFAULT_PET_ID)
    }

    for (const [familyKey, assignedId] of Object.entries(familyPetIds.value)) {
      if (assignedId === petId) {
        setFamilyPet(familyKey, null)
      }
    }
    void deps.refreshProjectPets()
  }

  return {
    selectedPet,
    pets,
    petsLoaded,
    hiddenBuiltinIds,
    visiblePets,
    visiblePetIds,
    petsById,
    familyPetIds,
    syncFamilyPetIds,
    setFamilyPet,
    getPetForFamily,
    setPet,
    loadPets,
    renamePet,
    removePet,
    handlePluginSkinsChanged,
  }
}
