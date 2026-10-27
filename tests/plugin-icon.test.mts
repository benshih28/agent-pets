import assert from 'node:assert/strict'
import test from 'node:test'
import { resolvePluginIconUrl } from '../src/utils/plugin-icon.ts'

test('plugin icons use the enabled-only secure protocol and fall back when unavailable', () => {
  assert.equal(resolvePluginIconUrl('sample-plugin', 'icons/icon.webp', false, true), null)
  assert.equal(resolvePluginIconUrl('sample-plugin', 'icons/icon.webp', true, false), null)
  assert.equal(resolvePluginIconUrl('sample-plugin', 'icons/icon.webp', true, true, true), null)
  assert.equal(resolvePluginIconUrl('sample-plugin', 'icons/icon.webp', true, true),
    'agent-pets://plugin/sample-plugin/icons/icon.webp')
  assert.equal(resolvePluginIconUrl('sample-plugin', '../outside.png', true, true), null)
  assert.equal(resolvePluginIconUrl('sample-plugin', 'notes.txt', true, true), null)
})
