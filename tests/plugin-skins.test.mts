import assert from 'node:assert/strict'
import test from 'node:test'
import { availablePluginSkinPetIds } from '../electron/plugin-skins.ts'
import { createPluginSkinPetId, isPluginSkinPetId, isValidPetId, parsePluginSkinPetId } from '../src/utils/pet-id.ts'

test('plugin skin pet ids use a dedicated, bounded format without broadening ordinary ids', () => {
  assert.equal(createPluginSkinPetId('skin-pack', 'winter-fox'), 'plugin:skin-pack:winter-fox')
  assert.deepEqual(parsePluginSkinPetId('plugin:skin-pack:winter-fox'), {
    pluginId: 'skin-pack',
    skinId: 'winter-fox',
  })
  assert.equal(isPluginSkinPetId('plugin:UPPER:fox'), false)
  assert.equal(isPluginSkinPetId('plugin:skin-pack:../fox'), false)
  assert.equal(isPluginSkinPetId('plugin:ab:fox'), false)
  assert.equal(isValidPetId('plugin:skin-pack:winter-fox'), true)
  assert.equal(isValidPetId('custom.pet_1'), true)
  assert.equal(isValidPetId('custom..pet'), false)
  assert.equal(isValidPetId('plugin:skin-pack:winter-fox', 64), true)
})

test('available plugin skin ids follow global and per-plugin enabled state', () => {
  const plugins = [
    { pluginId: 'skin-pack', enabled: true, skinIds: ['winter-fox', 'snow-cat'] },
    { pluginId: 'disabled-pack', enabled: false, skinIds: ['fox'] },
  ]
  assert.deepEqual([...availablePluginSkinPetIds(plugins, true)], [
    'plugin:skin-pack:winter-fox',
    'plugin:skin-pack:snow-cat',
  ])
  assert.deepEqual([...availablePluginSkinPetIds(plugins, false)], [])
})
