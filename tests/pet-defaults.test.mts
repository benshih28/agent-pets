import assert from 'node:assert/strict'
import test from 'node:test'
import { readBooleanPref, readPetFeedbackDefaults } from '../src/utils/pet-defaults.ts'
import { isDesktopEffectActive } from '../src/utils/desktop-effects.ts'

const store = (entries: Record<string, string>) => ({
  getItem: (key: string) => (key in entries ? entries[key] : null),
})

test('never-touched settings follow the new key-event defaults', () => {
  assert.deepEqual(readPetFeedbackDefaults(store({})), {
    reactions: true,
    bubble: true,
    ambient: false,
    activity: false,
  })
})

test('an explicit off choice is never overridden', () => {
  const defaults = readPetFeedbackDefaults(store({ 'agent-pet-fx': '0', 'agent-pet-bubble': '0' }))
  assert.equal(defaults.reactions, false)
  assert.equal(defaults.bubble, false)
  assert.equal(defaults.ambient, false)
  assert.equal(defaults.activity, false)
})

test('legacy opt-in users keep ambient motion and the activity bubble', () => {
  const defaults = readPetFeedbackDefaults(store({ 'agent-pet-fx': '1', 'agent-pet-bubble': '1' }))
  assert.equal(defaults.ambient, true)
  assert.equal(defaults.activity, true)
  const split = readPetFeedbackDefaults(store({ 'agent-pet-fx': '1', 'agent-pet-ambient': '0' }))
  assert.equal(split.ambient, false)
})

test('storage failures fall back to the default', () => {
  const broken = { getItem: () => { throw new Error('denied') } }
  assert.equal(readBooleanPref(broken, 'x', true), true)
  assert.equal(readBooleanPref(broken, 'x', false), false)
})

test('DND and an unready preference snapshot still suppress effects', () => {
  assert.equal(isDesktopEffectActive(true, false, true), true)
  assert.equal(isDesktopEffectActive(true, true, true), false)
  assert.equal(isDesktopEffectActive(false, false, true), false)
  assert.equal(isDesktopEffectActive(true, false, false), false)
})
