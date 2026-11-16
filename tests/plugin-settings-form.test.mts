import assert from 'node:assert/strict'
import test from 'node:test'
import type { PluginSettingDefinition } from '../src/types/plugin.ts'
import { defaultSettingsDraft, isSettingsDirty, validateSetting, validateSettings } from '../src/utils/plugin-settings-form.ts'

const properties = {
  interval: { type: 'number', minimum: 1, maximum: 60, default: 10 },
  label: { type: 'string', maxLength: 5, default: 'ab' },
  enabled: { type: 'boolean' },
  mode: { type: 'string', enum: ['a', 'b'], default: 'a' },
  token: { type: 'string', format: 'secret' },
} satisfies Record<string, PluginSettingDefinition>

test('dirty state compares against saved values with defaults filled in', () => {
  const props: Record<string, PluginSettingDefinition> = properties
  assert.equal(isSettingsDirty(props, {}, {}), false)
  assert.equal(isSettingsDirty(props, { interval: 10 }, {}), false)
  assert.equal(isSettingsDirty(props, { interval: 10 }, { interval: 11 }), true)
  assert.equal(isSettingsDirty(props, {}, { enabled: true }), true)
  assert.equal(isSettingsDirty(props, {}, {}, { token: '' }), false)
  assert.equal(isSettingsDirty(props, {}, {}, { token: 'x' }), true)
})

test('defaults draft skips secrets and fills boolean/number fallbacks', () => {
  assert.deepEqual(defaultSettingsDraft(properties), { interval: 10, label: 'ab', enabled: false, mode: 'a' })
})

test('validation reports range, length and enum problems per field', () => {
  assert.equal(validateSetting(properties.interval, 0), 'range')
  assert.equal(validateSetting(properties.interval, Number.NaN), 'required')
  assert.equal(validateSetting(properties.interval, 30), null)
  assert.equal(validateSetting(properties.label, 'toolong'), 'too_long')
  assert.equal(validateSetting(properties.mode, 'z'), 'not_allowed')
  assert.deepEqual(validateSettings(properties, { interval: 99, label: 'ok' }), { interval: 'range' })
})
