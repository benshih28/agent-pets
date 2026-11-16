// 寵物清單與選擇：全域選的寵物、各家族的覆寫、內建寵物的隱藏清單，以及自訂寵物的改名／移除與插件造型被移除時的退回。
//
// - 事件輸入：`loadPets()`（啟動與主程序通知清單變動）、`setPet`／`setFamilyPet`／`removePet`／`renamePet`
//   （設定面板）、`handlePluginSkinsChanged()`（插件造型移除）、`syncFamilyPetIds()`（App.vue 轉交其他視窗的改動）。
// - 計時器：無。
// - storage：`petId`、`familyPetIds`（經家族 registry 白名單解析）、`hiddenBuiltinPets`（見 STORAGE_KEYS）。
// - 跨視窗同步：`selectedPet`／`familyPetIds` 由 App.vue 的 storage 事件寫回；familyPetIds 經 `syncFamilyPetIds`。
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
  /** 目前最需要處理的 session 被路由到的寵物 id。 */
  routedPetId: () => string | undefined
}

export function usePets(deps: PetsDeps) {
  const selectedPet = ref<string>(readStored(STORAGE_KEYS.petId))
  const pets = ref<PetEntry[]>([])
  const petsLoaded = ref(false)
  // Built-in pets ship as bundled assets, so "removing" one just hides it
  // from your own picker rather than deleting a file — persisted the same
  // way custom-pet deletion is, just via a local id list instead of disk.
  const hiddenBuiltinIds = ref<string[]>(readStored(STORAGE_KEYS.hiddenBuiltinPets))
  const visiblePets = computed(() => {
    const hidden = new Set(hiddenBuiltinIds.value)
    return pets.value.filter(p => !hidden.has(p.id))
  })
  // familyLines／activePetId 在每個 agent 事件都會重算，所以 id 查找走快取的 Set／Map，
  // 只有寵物清單本身改變時才重建。
  const visiblePetIds = computed(() => new Set(visiblePets.value.map(p => p.id)))
  const petsById = computed(() => new Map(pets.value.map(pet => [pet.id, pet])))

  // Per-family skin overrides (e.g. Codex looks like the cat, Claude looks
  // like the monkey king) — a family with no entry here just falls back to
  // the global `selectedPet`. Keyed by AgentFamilyKey（localStorage 的既有格式，key 不能改名）.
  // 啟動與跨視窗同步都經過 registry 的同一個解析（STORAGE_KEYS.familyPetIds），只收家族 key 與字串值。
  const familyPetIds = ref<Record<string, string>>(readStored(STORAGE_KEYS.familyPetIds))

  /** 另一個視窗改了家族對應時，App.vue 把 registry 解析後的值交給這裡。 */
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

  // Falls back to the global default if the family has no override, or its
  // override points at a pet that's since been removed/hidden.
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
