// Grouping, filtering and rename validation for the Pets settings list.

export interface PetListItem {
  id: string
  displayName: string
  builtIn: boolean
  pluginSkin?: unknown
}

export type PetGroupId = 'current' | 'builtIn' | 'imported' | 'plugin'

export interface PetGroup<T extends PetListItem> { id: PetGroupId; pets: T[] }

export function groupPets<T extends PetListItem>(pets: readonly T[], selectedId: string, query = ''): PetGroup<T>[] {
  const needle = query.trim().toLocaleLowerCase()
  const matching = needle ? pets.filter(pet => pet.displayName.toLocaleLowerCase().includes(needle)) : [...pets]
  const groups: PetGroup<T>[] = [
    { id: 'current', pets: matching.filter(pet => pet.id === selectedId) },
    { id: 'builtIn', pets: matching.filter(pet => pet.id !== selectedId && pet.builtIn && !pet.pluginSkin) },
    { id: 'imported', pets: matching.filter(pet => pet.id !== selectedId && !pet.builtIn && !pet.pluginSkin) },
    { id: 'plugin', pets: matching.filter(pet => pet.id !== selectedId && !!pet.pluginSkin) },
  ]
  return groups.filter(group => group.pets.length > 0)
}

export const PET_NAME_MAX_LENGTH = 64

export type PetNameError = 'empty' | 'duplicate' | 'tooLong' | null

export function validatePetName(name: string, petId: string, pets: readonly PetListItem[]): PetNameError {
  const trimmed = name.trim()
  if (!trimmed) return 'empty'
  if (trimmed.length > PET_NAME_MAX_LENGTH) return 'tooLong'
  const lowered = trimmed.toLocaleLowerCase()
  if (pets.some(pet => pet.id !== petId && pet.displayName.trim().toLocaleLowerCase() === lowered)) return 'duplicate'
  return null
}
