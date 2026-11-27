import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync(new URL('../src/components/status-panel/SettingsDesktop.vue', import.meta.url), 'utf8')

test('the switch-to-app toggle is offered on macOS and Windows', () => {
  const match = source.match(/const canSwitchApp = (\/[^/]+\/i)\.test\(navigator\.platform\)/)
  assert.ok(match, 'SettingsDesktop gates the toggle on navigator.platform')
  const pattern = new RegExp(match[1].slice(1, -2), 'i')
  assert.equal(pattern.test('MacIntel'), true)
  assert.equal(pattern.test('Win32'), true)
  assert.equal(pattern.test('Linux x86_64'), false)
  assert.match(source, /v-if="canSwitchApp"[\s\S]{0,120}sessionJumpSwitchAppEnabled/)
})
