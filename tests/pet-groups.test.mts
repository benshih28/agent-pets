import assert from 'node:assert/strict'
import test from 'node:test'
import { groupPets, validatePetName } from '../src/utils/pet-groups.ts'

const pets = [
  { id: 'aang', displayName: 'Aang', builtIn: true },
  { id: 'cat', displayName: 'Cat', builtIn: true },
  { id: 'custom-1', displayName: 'Mochi', builtIn: false },
  { id: 'skin', displayName: 'Plugin Skin', builtIn: false, pluginSkin: {} },
]

test('pets are grouped with the selected one first', () => {
  const groups = groupPets(pets, 'cat')
  assert.deepEqual(groups.map(group => [group.id, group.pets.map(pet => pet.id)]), [
    ['current', ['cat']], ['builtIn', ['aang']], ['imported', ['custom-1']], ['plugin', ['skin']],
  ])
  assert.deepEqual(groupPets(pets, 'missing', 'MOC').map(group => group.id), ['imported'])
  assert.deepEqual(groupPets(pets, 'cat', 'zzz'), [])
})

test('rename validation covers empty, duplicate and long names', () => {
  assert.equal(validatePetName('  ', 'custom-1', pets), 'empty')
  assert.equal(validatePetName('cat', 'custom-1', pets), 'duplicate')
  assert.equal(validatePetName('Mochi', 'custom-1', pets), null)
  assert.equal(validatePetName('x'.repeat(65), 'custom-1', pets), 'tooLong')
})
