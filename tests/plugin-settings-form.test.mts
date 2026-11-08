import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultSettingsDraft, isSettingsDirty, validateSetting, validateSettings } from '../src/utils/plugin-settings-form.ts'

const properties = {
  interval: { type: 'number', minimum: 1, maximum: 60, default: 10 },
  label: { type: 'string', maxLength: 5, default: 'ab' },
  enabled: { type: 'boolean' },
  mode: { type: 'string', enum: ['a', 'b'], default: 'a' },
  token: { type: 'string', format: 'secret' },
} as const

test('dirty state compares against saved values with defaults filled in', () => {
  const props = properties as never
  assert.equal(isSettingsDirty(props, {}, {}), false)
  assert.equal(isSettingsDirty(props, { interval: 10 }, {}), false)
  assert.equal(isSettingsDirty(props, { interval: 10 }, { interval: 11 }), true)
  assert.equal(isSettingsDirty(props, {}, { enabled: true }), true)
  assert.equal(isSettingsDirty(props, {}, {}, { token: '' }), false)
  assert.equal(isSettingsDirty(props, {}, {}, { token: 'x' }), true)
})

test('defaults draft skips secrets and fills boolean/number fallbacks', () => {
  assert.deepEqual(defaultSettingsDraft(properties as never), { interval: 10, label: 'ab', enabled: false, mode: 'a' })
})

test('validation reports range, length and enum problems per field', () => {
  assert.equal(validateSetting(properties.interval as never, 0), 'range')
  assert.equal(validateSetting(properties.interval as never, Number.NaN), 'required')
  assert.equal(validateSetting(properties.interval as never, 30), null)
  assert.equal(validateSetting(properties.label as never, 'toolong'), 'too_long')
  assert.equal(validateSetting(properties.mode as never, 'z'), 'not_allowed')
  assert.deepEqual(validateSettings(properties as never, { interval: 99, label: 'ok' }), { interval: 'range' })
})
